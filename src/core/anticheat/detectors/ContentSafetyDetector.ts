import { createHash } from "node:crypto";
import type { Message } from "discord.js";
import { config } from "../../../config.js";
import type { Detector, DetectionContext, DetectionResult } from "../types.js";
import {
  resolveContentMedia,
  prepareContentMedia,
  extractContentUrls,
} from "../ContentMedia.js";
import {
  ContentVerdictCache,
  similarityInput,
} from "../ContentVerdictCache.js";
import { getMediaAttachments, isVisualAttachment } from "./MediaSafetyUtils.js";
import { normalizeContentExplanation } from "../ContentExplanation.js";
import { contentFailureReason } from "../ContentScanFailure.js";
import { Logger } from "../../../utils/Logger.js";
import { classifyWithLfm, buildLfmInstructions, LFM3_MODEL } from "../LfmContentClassifier.js";

export const CONTENT_CATEGORIES = [
  "suggestive",
  "explicit",
  "harassment",
  "hate",
  "threat",
  "violence",
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];
export type ContentVerdict = Record<ContentCategory, number> & {
  explanation?: string;
  suggestedPoints?: number;
  pointsReason?: string;
  customRuleViolations?: string[];
};
export interface ContentScoringPolicy {
  maxPoints: number;
  categories: ContentCategory[];
}
export const CONTENT_LABELS: Record<ContentCategory, string> = {
  suggestive: "軽度の性的表現・H系",
  explicit: "強度の性的表現・R18",
  harassment: "暴言・嫌がらせ",
  hate: "差別・憎悪",
  threat: "脅迫",
  violence: "残虐・暴力表現",
};
export const CONTENT_DEFAULT_CONFIG = {
  similarCache: 1,
  similarityThreshold: 0.9,
  cacheTtlMinutes: 129600,
  action: "spoiler",
  awardScore: 0,
  maxAiScore: 10,
  imageThreshold: 0.7,
  textThreshold: 0.8,
  imageSuggestiveThreshold: 0.65,
  textSuggestiveThreshold: 0.7,
  suggestive: 1,
  explicit: 1,
  harassment: 1,
  hate: 1,
  threat: 1,
  violence: 1,
  scanImages: 1,
  scanText: 1,
  scanUrls: 1,
  maxSampleFrames: 6,
  maxFileSizeMb: 8,
  maxImages: 4,
  timeoutMs: 600000,
  customRulesChannelId: "",
  customRulesMessageId: "1381971374947438703",
};
export const CONTENT_SAFETY_MODEL = config.pexAi.contentSafetyModel || 'lfm3';
export function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}
export function matchingContentCategories(
  verdict: ContentVerdict,
  image: boolean,
  overrides: Record<string, any> = {},
): ContentCategory[] {
  const options = { ...CONTENT_DEFAULT_CONFIG, ...overrides };
  const threshold = boundedNumber(
    image ? options.imageThreshold : options.textThreshold,
    image ? 0.7 : 0.8,
    0.1,
    1,
  );
  return CONTENT_CATEGORIES.filter((category) => {
    const categoryThreshold =
      category === "suggestive"
        ? boundedNumber(
            image
              ? options.imageSuggestiveThreshold
              : options.textSuggestiveThreshold,
            image ? 0.65 : 0.7,
            0.1,
            1,
          )
        : threshold;
    return options[category] === 1 && verdict[category] >= categoryThreshold;
  });
}
export function parseContentVerdict(content: string): ContentVerdict {
  const result = JSON.parse(
    content
      .trim()
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, ""),
  );
  const parsed = result.scores || result;
  if (
    Object.keys(parsed).filter(
      (key) =>
        !["explanation", "suggestedPoints", "pointsReason", "customRuleViolations"].includes(key),
    ).length !== CONTENT_CATEGORIES.length
  )
    throw new Error("Invalid moderation verdict");
  for (const key of CONTENT_CATEGORIES) {
    if (
      typeof parsed[key] !== "number" ||
      !Number.isFinite(parsed[key]) ||
      parsed[key] < 0 ||
      parsed[key] > 1
    ) {
      throw new Error("Invalid moderation verdict");
    }
  }
  const explanation = parsed.explanation ?? result.explanation;
  if (explanation !== undefined && typeof explanation !== "string")
    throw new Error("Invalid moderation explanation");
  const suggestedPoints = parsed.suggestedPoints ?? result.suggestedPoints;
  const pointsReason = parsed.pointsReason ?? result.pointsReason;
  const customRuleViolations = parsed.customRuleViolations ?? result.customRuleViolations;
  if (
    suggestedPoints !== undefined &&
    (!Number.isInteger(suggestedPoints) ||
      suggestedPoints < 0 ||
      suggestedPoints > 100)
  )
    throw new Error("Invalid moderation points");
  if (
    pointsReason !== undefined &&
    (typeof pointsReason !== "string" || !pointsReason.trim())
  )
    throw new Error("Invalid moderation explanation");
  if (customRuleViolations !== undefined && (!Array.isArray(customRuleViolations) ||
      customRuleViolations.some((item: unknown) => typeof item !== "string" || !item.trim())))
    throw new Error("Invalid moderation verdict");
  return {
    ...Object.fromEntries(CONTENT_CATEGORIES.map((key) => [key, parsed[key]])),
    ...(suggestedPoints !== undefined ? { suggestedPoints } : {}),
    ...(pointsReason
      ? { pointsReason: normalizeContentExplanation(pointsReason) }
      : {}),
    ...(explanation
      ? { explanation: normalizeContentExplanation(explanation) }
      : {}),
    ...(customRuleViolations ? { customRuleViolations: customRuleViolations.map((item: string) => normalizeContentExplanation(item)).slice(0, 20) } : {}),
  } as ContentVerdict;
}

export function normalizeModerationText(text: string): string {
  // Keep visible separators for contextual interpretation, but remove invisible
  // format characters and normalize full-width forms used to evade matching.
  return text.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
}

export const CONTENT_SAFETY_PROMPT = 'lfm3-moderation-v1: classify current post only; preserve negation and quoted context.';
export const CONTENT_SAFETY_POLICY_REFERENCE = CONTENT_SAFETY_PROMPT;

export interface AiRequestMetrics {
  model: string;
  frames: number;
  retry: boolean;
  elapsedMs?: number;
  status?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  tokensPerSecond?: number;
}

export async function classifyContent(
  text: string, frames: string[] = [], timeoutMs = 300000, formatRetry = false,
  scoring?: ContentScoringPolicy, _model = CONTENT_SAFETY_MODEL,
  requests: AiRequestMetrics[] = [], customRules = "",
): Promise<ContentVerdict> {
  const uniqueFrames = [...new Set(frames)];
  // LFM3 on HomePC handles every moderation request, text and media alike.
  return classifyWithLfm(text, uniqueFrames, timeoutMs, formatRetry, scoring, requests, customRules);
}

export class ContentSafetyDetector implements Detector {
  name = "contentSafety";
  constructor(
    private readonly readImage: typeof resolveContentMedia = resolveContentMedia,
    private readonly cache = new ContentVerdictCache(),
  ) {}
  private active = 0;
  private waiting: Array<() => void> = [];
  private inFlight = new Map<string, Promise<ContentVerdict>>();
  clearCache(guildId: string) {
    return this.cache.clear(guildId);
  }

  async detect(
    message: Message,
    context: DetectionContext,
  ): Promise<DetectionResult> {
    const settings = context.settings.detectors[this.name];
    if (!settings?.enabled || context.isMessageDeleted?.())
      return { scoreDelta: 0, reasons: [] };
    if (this.active >= 2) {
      if (this.waiting.length >= 32)
        throw new Error("Moderation queue full; message not scanned");
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          this.waiting = this.waiting.filter((entry) => entry !== resume);
          reject(new Error("Moderation queue timeout; message not scanned"));
        }, 600000);
        this.waiting.push(resume);
      });
    } else this.active++;
    try {
      return await this.scan(
        message,
        settings.config || {},
        context.guildId || "default",
        context.isMessageDeleted,
      );
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  private async scan(
    message: Message,
    overrides: Record<string, any>,
    guildId: string,
    isMessageDeleted?: () => boolean,
  ): Promise<DetectionResult> {
    const scanStarted = Date.now();
    let auditMetadata: Record<string, any> = {};
    const stopped = (): DetectionResult => ({ scoreDelta: 0, reasons: [], metadata: {
      ...auditMetadata, model: CONTENT_SAFETY_MODEL, elapsedMs: Date.now() - scanStarted, stoppedBecauseDeleted: true,
    } });
    if (isMessageDeleted?.()) return stopped();
    const options = { ...CONTENT_DEFAULT_CONFIG, ...overrides };
    if (!CONTENT_CATEGORIES.some((category) => options[category] === 1))
      return { scoreDelta: 0, reasons: [] };
    const scoring: ContentScoringPolicy | undefined =
      options.awardScore === 1
        ? {
            maxPoints: Math.floor(
              boundedNumber(options.maxAiScore, 10, 1, 100),
            ),
            categories: CONTENT_CATEGORIES.filter(
              (category) => options[category] === 1,
            ),
          }
        : undefined;
    const content = message.content;
    let replyContext = "";
    if (options.scanText === 1 && message.reference?.messageId) {
      try {
        const referenced = await message.fetchReference();
        if (isMessageDeleted?.()) return stopped();
        const referencedText = referenced.content?.trim();
        if (referencedText)
          replyContext = referencedText.slice(0, 1000);
      } catch {
        // A deleted or inaccessible reply target must not make moderation fail.
      }
    }
    const contextualContent = replyContext
      ? `現在の投稿:\n${content}\n\n返信先（解釈用・採点対象外）:\n${replyContext}`
      : content;
    let customRules = "";
    if (/^[1-9]\d{0,19}$/.test(String(options.customRulesChannelId || "")) &&
        /^[1-9]\d{0,19}$/.test(String(options.customRulesMessageId || ""))) {
      try {
        const channel = await message.guild?.channels.fetch(String(options.customRulesChannelId));
        if (channel?.isTextBased() && "messages" in channel) {
          const ruleMessage = await channel.messages.fetch(String(options.customRulesMessageId));
          customRules = ruleMessage.content.trim().slice(0, 6000);
        }
      } catch (error) {
        Logger.warn(`[ContentSafety] custom rules unavailable guild=${guildId}: ${contentFailureReason(error)}`);
      }
    }
    const started = Date.now();
    const trace = (event: string) =>
      Logger.info(
        `[ContentSafety] guild=${guildId} message=${message.id} ${event}`,
      );
    trace("scan-start");
    const expected = {
      content,
      editedTimestamp: message.editedTimestamp,
      attachmentIds: [...message.attachments.keys()].join(),
    };
    const hits = new Set<ContentCategory>();
    const customRuleHits = new Set<string>();
    const analyses: Array<{
      source: string;
      scores: ContentVerdict;
      cache: string;
      similarity: number;
      frames: number;
      elapsedMs: number;
      requests: AiRequestMetrics[];
      matchedCategories: ContentCategory[];
    }> = [];
    const files: Array<{ data: Buffer; name: string; sourceUrl: string }> = [];
    const errors: string[] = [];
    const allRequests: AiRequestMetrics[] = [];
    auditMetadata = { analyses, errors, requests: allRequests };
    let stage = "cache";
    const check = async (text: string, frames: string[], source: string): Promise<boolean> => {
      if (isMessageDeleted?.()) return false;
      const analysisStarted = Date.now();
      const requests: AiRequestMetrics[] = [];
      let shared = false;
      stage = "cache";
      text = normalizeModerationText(text);
      frames = [...new Set(frames)];
      trace(`analysis-start source=${source} frames=${frames.length}`);
      const classifierModel = LFM3_MODEL;
      const policy = buildLfmInstructions(customRules);
      const policyScope = createHash("sha256").update(JSON.stringify([classifierModel, CONTENT_SAFETY_PROMPT, policy, scoring])).digest("hex");
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            classifierModel,
            "moderation-routing-v3",
            CONTENT_SAFETY_PROMPT,
            policyScope,
            scoring,
            customRules,
            text,
            frames,
          ]),
        )
        .digest("hex");
      const input = await similarityInput(text, frames);
      input.guard = `moderation-v2:${policyScope}:${input.guard}`;
      const revision = this.cache.revision(guildId);
      const requestKey = `${guildId}:${revision}:${key}`;
      const cached = this.cache.get(
        guildId,
        key,
        input,
        options.similarCache === 1 &&
          options.action !== "delete" &&
          options.awardScore !== 1
          ? boundedNumber(options.similarityThreshold, 0.9, 0.9, 1)
          : 2,
        (value) =>
          matchingContentCategories(value, frames.length > 0, options).length > 0 ||
          Boolean(value.customRuleViolations?.length),
      );
      let verdict: ContentVerdict;
      if (cached) verdict = cached.verdict;
      else {
        stage = "ai";
        let pending = this.inFlight.get(requestKey);
        shared = !!pending;
        if (!pending) {
          const aiDeadline = Date.now() + boundedNumber(options.timeoutMs, 600000, 5000, 600000);
          const requestVerdict = (retry: boolean) => classifyContent(
            text, frames, Math.max(1, aiDeadline - Date.now()), retry, scoring,
            CONTENT_SAFETY_MODEL, requests, customRules,
          );
          pending = requestVerdict(false).catch((error) => {
            const reason = contentFailureReason(error);
            const retryable = ["Invalid JSON response", "Truncated moderation response",
              "Invalid moderation verdict", "Invalid moderation explanation", "Invalid moderation points"].includes(reason);
            if (!retryable || aiDeadline - Date.now() < 5000) throw error;
            trace(`analysis-retry source=${source} reason=${reason}`);
            return requestVerdict(true);
          })
            .then((result) => {
              this.cache.set(
                guildId,
                key,
                input,
                result,
                boundedNumber(options.cacheTtlMinutes, 129600, 1, 129600) * 60 * 1000,
                revision,
              );
              return result;
            })
            .finally(() => {
              allRequests.push(...requests);
              this.inFlight.delete(requestKey);
            });
          this.inFlight.set(requestKey, pending);
        }
        verdict = await pending;
      }
      if (isMessageDeleted?.()) return false;
      analyses.push({
        source,
        scores: verdict,
        cache: cached?.cache || (shared ? "shared" : "miss"),
        frames: frames.length,
        elapsedMs: Date.now() - analysisStarted,
        requests,
        matchedCategories: matchingContentCategories(verdict, frames.length > 0, options),
        similarity: cached?.similarity || 0,
      });
      trace(
        `analysis-ok source=${source} cache=${cached?.cache || "miss"} scores=${JSON.stringify(Object.fromEntries(CONTENT_CATEGORIES.map((key) => [key, verdict[key]])))}`,
      );
      trace(
        `analysis-reason source=${source} explanation=${JSON.stringify(verdict.explanation)} suggestedPoints=${verdict.suggestedPoints ?? "off"} pointsReason=${JSON.stringify(verdict.pointsReason ?? "")}`,
      );
      for (const category of matchingContentCategories(
        verdict,
        frames.length > 0,
        options,
      ))
        hits.add(category);
      for (const rule of verdict.customRuleViolations || []) customRuleHits.add(rule);
      return true;
    };
    const urlOnly =
      /https?:\/\//i.test(content) &&
      !content.replace(/https?:\/\/[^\s<>|]+/gi, "").replace(/[\s<>|]/g, "");
    if (
      options.scanText === 1 &&
      content.trim() &&
      !(urlOnly && options.scanImages === 1 && options.scanUrls === 1)
    ) {
      try {
        if (!(await check(contextualContent, [], "text"))) return stopped();
      } catch (error) {
        errors.push(
          `text-analysis-failed stage=${stage}: ${contentFailureReason(error)}`,
        );
      }
    }
    const urls = new Set<string>();
    if (options.scanImages === 1) {
      for (const attachment of getMediaAttachments(message).filter(
        isVisualAttachment,
      ))
        urls.add(attachment.url);
      if (options.scanUrls === 1) {
        for (const url of extractContentUrls(content)) urls.add(url);
        for (const embed of message.embeds || []) {
          if (embed.image?.url) urls.add(embed.image.url);
          if (embed.thumbnail?.url) urls.add(embed.thumbnail.url);
          if (embed.video?.url) urls.add(embed.video.url);
        }
      }
    }
    const limit = Math.floor(boundedNumber(options.maxImages, 4, 1, 10));
    if (urls.size > limit) errors.push("image-limit-exceeded");
    for (const [index, url] of [...urls].slice(0, limit).entries()) {
      if (isMessageDeleted?.()) return stopped();
      // Scan ALL referenced media before any destructive action. An earlier text
      // match must never cause a later attachment to disappear from a repost.
      let bytes = 0;
      let frameCount = 0;
      stage = "download-or-image-validation";
      trace(
        `media-start source=image-${index + 1} urlHash=${createHash("sha256").update(url).digest("hex").slice(0, 12)}`,
      );
      try {
        const media = await this.readImage(
          url,
          boundedNumber(options.maxFileSizeMb, 8, 1, 10) * 1024 * 1024,
        );
        if (isMessageDeleted?.()) return stopped();
        bytes = media.data.length;
        stage = "frame-extraction";
        const frames = await prepareContentMedia(
          media.data,
          media.type,
          boundedNumber(options.maxSampleFrames, 6, 1, 12),
        );
        if (isMessageDeleted?.()) return stopped();
        frameCount = frames.length;
        if (!frameCount) throw new Error("No decodable media frames");
        trace(
          `frames-ready source=image-${index + 1} bytes=${bytes} frames=${frameCount}`,
        );
        // Include the same post's text so the model can interpret visual context.
        // Respect text opt-out; URL-only posts need no duplicate URL text.
        if (!(await check(
          options.scanText === 1 && !urlOnly ? contextualContent : "",
          frames,
          `image-${index + 1}`,
        ))) return stopped();
        files.push({
          data: media.data,
          name: `image-${files.length + 1}.${media.type}`,
          sourceUrl: url,
        });
      } catch (error) {
        // scanUrls also accepts ordinary web-page URLs. A page without an
        // Open Graph/Twitter preview simply has no image to moderate; it is
        // not a failed image scan. Actual downloads, decodes, and AI failures
        // remain fail-open errors and are reported below.
        if (contentFailureReason(error) === "No preview image") {
          trace(`media-skip source=image-${index + 1} reason=no-preview-image`);
          continue;
        }
        errors.push(
          `image-analysis-failed source=image-${index + 1} stage=${stage} bytes=${bytes} frames=${frameCount}: ${contentFailureReason(error)}`,
        );
      }
    }
    trace(
      `scan-end matched=${[...hits].join(",") || "none"} errors=${errors.length} ms=${Date.now() - started}`,
    );
    // Incomplete scans are never permission to delete or replace the original,
    // even if another part of the same message was positively classified.
    if (errors.length) {
      const primaryFailure = errors[0]?.replace(/^.*?: /, "") || "Content safety processing failed";
      throw Object.assign(new Error(
        `ContentSafety incomplete: guild=${guildId} message=${message.id}; ${errors.join("; ")}`,
      ), {
        contentFailureReason: primaryFailure,
        auditMetadata: { model: allRequests.at(-1)?.model || CONTENT_SAFETY_MODEL, analyses, errors, requests: allRequests, elapsedMs: Date.now() - started },
      });
    }
    const explained = analyses
      .filter(
        (item) =>
          item.scores.explanation &&
          (matchingContentCategories(
            item.scores,
            item.source !== "text",
            options,
          ).length > 0 || Boolean(item.scores.customRuleViolations?.length)),
      )
      .sort(
        (a, b) => {
          const strength = (item: typeof a) => {
            const categories = matchingContentCategories(
              item.scores, item.source !== "text", options,
            );
            return Math.max(item.scores.customRuleViolations?.length ? 1 : 0,
              ...categories.map((key) => item.scores[key]));
          };
          return strength(b) - strength(a);
        },
      )[0];
    let aiExplanation = hits.size || customRuleHits.size
      ? explained
        ? `${explained.cache === "similar" ? "類似投稿の判定理由：" : ""}${explained.scores.explanation}`
        : "AIから短い説明が返されませんでした。"
      : undefined;
    const scored = scoring
      ? analyses
          .filter(
            (item) =>
              matchingContentCategories(
                item.scores,
                item.source !== "text",
                options,
              ).length,
          )
          .sort(
            (a, b) =>
              (b.scores.suggestedPoints ?? 0) - (a.scores.suggestedPoints ?? 0),
          )[0]
      : undefined;
    const scoreDelta =
      scoring && scored
        ? Math.min(
            scoring.maxPoints,
            Math.max(0, scored.scores.suggestedPoints ?? 0),
          )
        : 0;
    if (aiExplanation && scored)
      aiExplanation += ` 加算${scoreDelta}点：${scored.scores.pointsReason}`;
    trace(
      `scan-score appliedPoints=${scoreDelta} pointsReason=${JSON.stringify(scored?.scores.pointsReason ?? (scoring ? "検知閾値に達した対象カテゴリなし" : "スコア加算OFF"))}`,
    );
    return {
      ...(aiExplanation ? { aiExplanation } : {}),
      scoreDelta,
      reasons: [...hits].map((category) => CONTENT_LABELS[category]).concat([...customRuleHits].map(rule => `独自ルール: ${rule}`)),
      ...(hits.size || customRuleHits.size
        ? options.action === "delete"
          ? { contentDeletion: expected }
          : {
              spoilerRepost: {
                files,
                categories: [...hits].map(
                  (category) => CONTENT_LABELS[category],
                ).concat([...customRuleHits].map(rule => `独自ルール: ${rule}`)),
                expected,
                aiExplanation,
              },
            }
        : {}),
      metadata: {
        model: allRequests.at(-1)?.model || CONTENT_SAFETY_MODEL,
        elapsedMs: Date.now() - started,
        thresholds: { image: options.imageThreshold, text: options.textThreshold, imageSuggestive: options.imageSuggestiveThreshold, textSuggestive: options.textSuggestiveThreshold },
        enabledCategories: CONTENT_CATEGORIES.filter(category => options[category] === 1),
        action: options.action === "delete" ? "delete" : "spoiler",
        aiExplanation,
        analyses,
        requests: allRequests,
        errors,
        scoring,
        appliedPoints: scoreDelta,
        pointsReason: scored?.scores.pointsReason,
        stoppedAfterMatch: hits.size > 0,
        customRulesEnabled: Boolean(customRules),
        customRuleViolations: [...customRuleHits],
      },
    };
  }
}
