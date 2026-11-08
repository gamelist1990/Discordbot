import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp as makeTempDir, writeFile as writeTempFile, readFile as readTempFile, rm as removeTempDir } from 'node:fs/promises';
import { tmpdir as osTmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { promisify as promisifyFn } from 'node:util';
import { config, GEMMA_MODEL } from '../../config.js';
import { Logger } from '../../utils/Logger.js';
import { recordAIUsage } from './AIUsageMetrics.js';

const execFileAsync = promisifyFn(execFileCallback);

/**
 * dot常駐（StaffAIDotAmbient）用の添付メディア理解。
 *
 * 方針: 判定・生成のたびに画像そのものをモデルへ渡すのではなく、メディア付き発言を
 * 1回だけ Gemma の視覚/聴覚で「説明文」に変換してキャッシュし、会話バッファや文脈には
 * `[画像: 説明]` の形でテキストとして載せる。これにより
 * - 参加判定（30〜90秒おきに回る）がテキストだけで完結し、写真の話題を写真として認識できる
 * - 呼びかけ応答・返信生成も同じ説明を再利用でき、メディア1件あたりの視覚呼び出しが1回で済む
 * というコストと確実性のバランスを取る。説明できなかったメディアは「内容未確認」の
 * プレースホルダで存在だけは伝える（見えないまま本文だけで誤読する事故を防ぐ）。
 *
 * 経路は本番稼働中のものと同じ: EndPoint（config.pexAi.endpoint）経由の gemma-4-E4B-it。
 * 実リクエストで確認済み（2026-11-07）: 画像=image_url、動画=video_url、音声=input_audio(wav)
 * の3形式とも現行スタック（EndPoint→A8ゲートウェイのカスタムビルド+mmproj）で処理できる。
 * 音声は OGG/Opus 等のデコード可否がランタイム依存のため、ffmpeg で 16kHz mono WAV に
 * 正規化してから送る（ffmpeg は ContentSafety の動画フレーム抽出でも本番使用中）。
 *
 * 動画の注意（2026-11-08 の実インシデントで判明）: video_url は動画をフレーム列の
 * トークンに展開するため、長さ×解像度に比例してプロンプトが膨らむ。27秒・1918x1078 の
 * 画面録画は 96,237 トークンになり、ゲートウェイの 32,768 トークン枠を超えて 400 になった。
 * そのため動画は原則として「ffmpeg で等間隔フレームを切り出して画像として説明する」経路を
 * 使い（実測: 同動画6フレームで 2,234 トークン・内容も正確）、ネイティブ video_url は
 * 小さく短い動画のときだけ先に試す。どちらか一方が失敗したらもう一方へフォールバックする。
 */

export type DotMediaKind = 'image' | 'video' | 'audio';

export type DotMediaState = 'pending' | 'described' | 'failed';

export interface DotMediaItem {
    /** messageId:attachmentId（同一メディアの再説明を防ぐキー） */
    key: string;
    messageId: string;
    kind: DotMediaKind;
    url: string;
    contentType: string;
    name: string;
    size: number;
    state: DotMediaState;
    description: string;
}

export const DOT_MEDIA_LIMITS = {
    maxItemsPerMessage: 4,
    imageMaxBytes: 8 * 1024 * 1024,
    videoMaxBytes: 10 * 1024 * 1024,
    audioMaxBytes: 10 * 1024 * 1024,
    downloadTimeoutMs: 20_000,
    describeTimeoutMs: 45_000,
    nativeVideoTimeoutMs: 30_000,
    describeMaxTokens: 400,
    descriptionMaxLength: 300,
    cacheMaxKeys: 160,
    /** 動画をフレーム列で説明するときの切り出し枚数（ContentSafety と同じ流儀）。 */
    videoFrameCount: 6,
} as const;

/**
 * video_url が展開するプロンプトトークン数の経験係数（トークン / (秒 × ピクセル)）。
 * 実測（2026-11-08）: 27.27秒・1918x1078 の mp4 が 96,237 トークンだったことから算出。
 */
export const VIDEO_TOKENS_PER_PIXEL_SECOND = 0.0017;
/** ネイティブ video_url を先に試してよい推定トークン数の上限（枠 32,768 に対して十分な余裕）。 */
export const NATIVE_VIDEO_MAX_ESTIMATED_TOKENS = 10_000;
export const NATIVE_VIDEO_MAX_DURATION_SEC = 8;
export const NATIVE_VIDEO_MAX_BYTES = 4 * 1024 * 1024;

export interface VideoProbeInfo {
    durationSec: number;
    width: number;
    height: number;
}

/** 動画が video_url で何トークンに展開されるかの見積もり。寸法・長さが不明なら無限大（安全側）。 */
export function estimateVideoPromptTokens(info: VideoProbeInfo): number {
    if (!(info.durationSec > 0) || !(info.width > 0) || !(info.height > 0)) return Number.POSITIVE_INFINITY;
    return Math.round(info.durationSec * info.width * info.height * VIDEO_TOKENS_PER_PIXEL_SECOND);
}

/**
 * ネイティブ video_url を先に試してよいのは、小さく短い動画だけ。
 * それ以外（実世界の画面録画など）はフレーム説明経路を使う（純粋関数）。
 */
export function shouldTryNativeVideoFirst(info: VideoProbeInfo | null, sizeBytes: number): boolean {
    if (!info) return false;
    if (info.durationSec > NATIVE_VIDEO_MAX_DURATION_SEC) return false;
    if (sizeBytes > NATIVE_VIDEO_MAX_BYTES) return false;
    return estimateVideoPromptTokens(info) <= NATIVE_VIDEO_MAX_ESTIMATED_TOKENS;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)(?:\?|$)/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv)(?:\?|$)/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|opus|m4a|flac|aac)(?:\?|$)/i;

/** contentType を優先し、無ければファイル名の拡張子で画像/動画/音声を判別する（純粋関数）。 */
export function classifyDotMedia(contentType: string | null | undefined, name: string | null | undefined): DotMediaKind | null {
    const type = (contentType ?? '').toLowerCase().split(';')[0].trim();
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    const target = name ?? '';
    if (IMAGE_EXT.test(target)) return 'image';
    if (VIDEO_EXT.test(target)) return 'video';
    if (AUDIO_EXT.test(target)) return 'audio';
    return null;
}

export interface DotMediaAttachmentLike {
    id: string;
    url: string;
    proxyURL?: string | null;
    contentType?: string | null;
    name?: string | null;
    size?: number | null;
}

export interface DotMediaMessageLike {
    id: string;
    attachments?: Iterable<DotMediaAttachmentLike> | null;
    messageSnapshots?: Iterable<{ attachments?: Iterable<DotMediaAttachmentLike> | null }> | null;
    embeds?: Iterable<{
        image?: { url: string } | null;
        thumbnail?: { url: string } | null;
    }> | null;
}

/** メッセージ（転送スナップショット・埋め込み画像を含む）からメディアを取り出す（純粋関数）。 */
export function extractDotMedia(message: DotMediaMessageLike): DotMediaItem[] {
    const items: DotMediaItem[] = [];
    const push = (att: DotMediaAttachmentLike) => {
        if (items.length >= DOT_MEDIA_LIMITS.maxItemsPerMessage) return;
        const kind = classifyDotMedia(att.contentType, att.name ?? att.url);
        if (!kind) return;
        items.push({
            key: `${message.id}:${att.id}`,
            messageId: message.id,
            kind,
            url: att.proxyURL || att.url,
            contentType: (att.contentType ?? '').toLowerCase(),
            name: att.name ?? '',
            size: att.size ?? 0,
            state: 'pending',
            description: '',
        });
    };
    if (message.attachments) for (const att of message.attachments) push(att);
    if (message.messageSnapshots) {
        for (const snapshot of message.messageSnapshots) {
            if (snapshot.attachments) for (const att of snapshot.attachments) push(att);
        }
    }
    if (message.embeds) {
        let index = 0;
        for (const embed of message.embeds) {
            const url = embed.image?.url || embed.thumbnail?.url;
            if (!url) continue;
            push({ id: `embed-${index++}`, url, contentType: 'image/*', name: url });
        }
    }
    return items;
}

export function mediaKindLabel(kind: DotMediaKind): string {
    return kind === 'image' ? '画像' : kind === 'video' ? '動画' : '音声';
}

/** 1件のメディアを会話文脈用の注記にする。説明済みなら内容、未確認なら存在だけを伝える。 */
export function formatMediaNote(item: DotMediaItem): string {
    const label = mediaKindLabel(item.kind);
    if (item.state === 'described' && item.description) {
        const text = item.description.replace(/\s+/g, ' ').trim().slice(0, DOT_MEDIA_LIMITS.descriptionMaxLength);
        if (text) return `[${label}: ${text}]`;
    }
    return `[${label}が添付されています（内容未確認）]`;
}

export function formatMediaNotes(items: readonly DotMediaItem[] | undefined): string {
    if (!items || items.length === 0) return '';
    return items.map(formatMediaNote).join(' ');
}

export type DotMediaDescribeFn = (item: DotMediaItem) => Promise<string | null>;

/**
 * メディア説明のキャッシュと生成管理。
 * 同一メディア（key）は1回だけ説明し、結果は item 自体に書き込む（バッファ保持分と共有される）。
 * 失敗したメディアは failed にして再試行しない（ループ防止）。保持は直近キー数の上限で古い順に落とす。
 */
export class DotMediaDescriptionStore {
    private readonly byKey = new Map<string, DotMediaItem>();
    private readonly byMessage = new Map<string, DotMediaItem[]>();
    private readonly inflight = new Map<string, Promise<void>>();

    constructor(
        private readonly describeFn: DotMediaDescribeFn,
        private readonly maxKeys: number = DOT_MEDIA_LIMITS.cacheMaxKeys,
    ) {}

    /** 抽出したメディアをキャッシュの正規オブジェクトへ寄せて返す（説明済みの状態を引き継ぐ）。 */
    register(items: DotMediaItem[]): DotMediaItem[] {
        return items.map(item => {
            const existing = this.byKey.get(item.key);
            if (existing) return existing;
            this.byKey.set(item.key, item);
            const list = this.byMessage.get(item.messageId) ?? [];
            list.push(item);
            this.byMessage.set(item.messageId, list);
            this.trim();
            return item;
        });
    }

    private trim(): void {
        while (this.byKey.size > this.maxKeys) {
            const oldestKey = this.byKey.keys().next().value as string | undefined;
            if (!oldestKey) break;
            const item = this.byKey.get(oldestKey);
            this.byKey.delete(oldestKey);
            if (!item) continue;
            const list = this.byMessage.get(item.messageId);
            if (list) {
                const next = list.filter(entry => entry.key !== oldestKey);
                if (next.length) this.byMessage.set(item.messageId, next);
                else this.byMessage.delete(item.messageId);
            }
        }
    }

    itemsForMessage(messageId: string): DotMediaItem[] {
        return this.byMessage.get(messageId) ?? [];
    }

    notesForMessage(messageId: string): string {
        return formatMediaNotes(this.itemsForMessage(messageId));
    }

    /** pending なメディアを最大 limit 件まで（新しい順の入力を想定し先頭から）説明する。 */
    async ensure(items: readonly DotMediaItem[], limit: number): Promise<void> {
        let budget = Math.max(0, Math.floor(limit));
        for (const item of items) {
            if (budget <= 0) break;
            if (item.state !== 'pending') continue;
            budget -= 1;
            await this.ensureOne(item).catch(() => undefined);
        }
    }

    private ensureOne(item: DotMediaItem): Promise<void> {
        const running = this.inflight.get(item.key);
        if (running) return running;
        const task = (async () => {
            try {
                const text = await this.describeFn(item);
                const cleaned = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, DOT_MEDIA_LIMITS.descriptionMaxLength);
                if (cleaned) {
                    item.description = cleaned;
                    item.state = 'described';
                } else {
                    item.state = 'failed';
                }
            } catch {
                item.state = 'failed';
            } finally {
                this.inflight.delete(item.key);
            }
        })();
        this.inflight.set(item.key, task);
        return task;
    }
}

const DESCRIBE_PROMPTS: Record<DotMediaKind, string> = {
    image: 'この画像の内容を日本語で簡潔に説明してください（2文以内）。写っている物・人・場面を具体的に書き、読み取れる文字があれば含めてください。',
    video: 'この動画の内容を日本語で具体的に説明してください（3文以内）。何が映っているか、何が起きているか（途中の変化も含む）を書き、画面に読み取れる文字や数値（通知の件数など）があれば含めてください。見た人がツッコミたくなるポイントがあれば一言添えてください。',
    audio: 'この音声の内容を日本語で簡潔に説明してください（2文以内）。話し声なら内容の要点を書き、音楽や効果音ならその特徴を書いてください。無音やノイズだけの場合はその旨を書いてください。',
};

/** フレーム列（画像群）として動画を説明するときのプロンプト。 */
const VIDEO_FRAMES_PROMPT = '次の画像は、1本の動画から等間隔に切り出したフレームです（時系列順）。この動画の内容を日本語で具体的に説明してください（3文以内）。何が映っているか、時間とともに何が起きているかを書き、画面に読み取れる文字や数値（通知の件数など）があれば含めてください。見た人がツッコミたくなるポイントがあれば一言添えてください。';

async function downloadMedia(url: string, maxBytes: number): Promise<Buffer | null> {
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(DOT_MEDIA_LIMITS.downloadTimeoutMs),
            headers: { 'user-agent': 'PEXServer DotAmbient/1.0' },
        });
        if (!response.ok) return null;
        const declared = Number(response.headers.get('content-length') ?? 0);
        if (declared > maxBytes) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) return null;
        return buffer;
    } catch {
        return null;
    }
}

/** 音声を 16kHz mono WAV に正規化する（OGG/Opus 等、ランタイムのデコーダ依存を避けるため）。 */
async function convertAudioToWav(data: Buffer): Promise<Buffer | null> {
    const folder = await makeTempDir(joinPath(osTmpdir(), 'dot-audio-'));
    try {
        const source = joinPath(folder, 'input.bin');
        const target = joinPath(folder, 'output.wav');
        await writeTempFile(source, data);
        await execFileAsync('ffmpeg', ['-v', 'error', '-i', source, '-ar', '16000', '-ac', '1', '-y', target], { timeout: 20_000 });
        const wav = await readTempFile(target);
        return wav.byteLength > 0 ? wav : null;
    } catch {
        return null;
    } finally {
        await removeTempDir(folder, { recursive: true, force: true }).catch(() => undefined);
    }
}

/** 動画の長さと寸法を ffprobe で取得する（フレーム切り出し位置と経路判断に使う）。 */
async function probeVideo(data: Buffer): Promise<VideoProbeInfo | null> {
    const folder = await makeTempDir(joinPath(osTmpdir(), 'dot-video-probe-'));
    try {
        const source = joinPath(folder, 'input.bin');
        await writeTempFile(source, data);
        const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height', '-show_entries', 'format=duration', '-of', 'json', source], { timeout: 15_000 });
        const parsed = JSON.parse(String(stdout)) as {
            streams?: Array<{ width?: number; height?: number }>;
            format?: { duration?: string };
        };
        const durationSec = Number(parsed.format?.duration ?? 0);
        const width = Number(parsed.streams?.[0]?.width ?? 0);
        const height = Number(parsed.streams?.[0]?.height ?? 0);
        if (!(durationSec > 0) || !(width > 0) || !(height > 0)) return null;
        return { durationSec, width, height };
    } catch {
        return null;
    } finally {
        await removeTempDir(folder, { recursive: true, force: true }).catch(() => undefined);
    }
}

/** 動画から等間隔のフレーム（JPEG・最大768px）を切り出す。ContentSafety の抽出と同じ流儀。 */
async function extractVideoFramesForDescribe(data: Buffer, durationSec: number): Promise<Buffer[]> {
    const folder = await makeTempDir(joinPath(osTmpdir(), 'dot-video-frames-'));
    try {
        const source = joinPath(folder, 'input.bin');
        await writeTempFile(source, data);
        const total: number = DOT_MEDIA_LIMITS.videoFrameCount;
        const frames: Buffer[] = [];
        for (let i = 0; i < total; i++) {
            const target = joinPath(folder, `frame-${i}.jpg`);
            try {
                await execFileAsync('ffmpeg', ['-v', 'error', '-ss', String(total === 1 ? 0 : durationSec * i / total), '-i', source, '-frames:v', '1',
                    '-vf', 'scale=768:768:force_original_aspect_ratio=decrease', '-q:v', '3', '-y', target], { timeout: 20_000 });
                const frame = await readTempFile(target);
                if (frame.byteLength > 0) frames.push(frame);
            } catch {
                // 1フレーム取れなくても残りで続行する
            }
        }
        return frames;
    } catch {
        return [];
    } finally {
        await removeTempDir(folder, { recursive: true, force: true }).catch(() => undefined);
    }
}

/** 説明リクエストを EndPoint 経由で Gemma に投げる共通処理。失敗時は理由をログに残して null。 */
async function requestMediaDescription(parts: Array<Record<string, unknown>>, timeoutMs: number, kind: DotMediaKind): Promise<string | null> {
    try {
        const response = await fetch(`${config.pexAi.endpoint.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(config.pexAi.apiKey ? { authorization: `Bearer ${config.pexAi.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: GEMMA_MODEL,
                messages: [{ role: 'user', content: parts }],
                temperature: 0.2,
                max_tokens: DOT_MEDIA_LIMITS.describeMaxTokens,
                chat_template_kwargs: { enable_thinking: false },
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            // ゲートウェイ側の理由（例: exceed_context_size_error）は本文にしか出ないため、切り分け用に残す。
            const bodyText = await response.text().catch(() => '');
            Logger.debug(`[DotAmbient] media describe failed kind=${kind} status=${response.status} body=${bodyText.slice(0, 300)}`);
            return null;
        }
        const json = await response.json() as {
            choices?: Array<{ message?: { content?: unknown } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null };
            timings?: { predicted_ms?: number };
        };
        // 利用統計: この経路はギルド文脈を持たない（メディア説明はメッセージ単位で
        // キャッシュされ、複数ギルド経路から共有され得る）ため全体統計にだけ記録する。
        void recordAIUsage({
            purpose: 'media', model: GEMMA_MODEL,
            inputTokens: json?.usage?.prompt_tokens, outputTokens: json?.usage?.completion_tokens,
            cachedTokens: json?.usage?.prompt_tokens_details?.cached_tokens ?? null,
            generatedSeconds: json?.timings?.predicted_ms ? json.timings.predicted_ms / 1000 : undefined,
        }).catch(() => undefined);
        const text = json?.choices?.[0]?.message?.content;
        return typeof text === 'string' && text.trim() ? text.trim() : null;
    } catch (error) {
        Logger.debug('[DotAmbient] media describe error:', error);
        return null;
    }
}

/**
 * 動画1件を説明する。小さく短い動画はネイティブ video_url を先に試し、それ以外は
 * フレーム列（画像）として説明する。一方が失敗したらもう一方へフォールバックする。
 * （video_url は長さ×解像度でトークンが膨らみ、枠を超えると 400 になるため。）
 */
async function describeVideoWithGemma(item: DotMediaItem, data: Buffer): Promise<string | null> {
    const probe = await probeVideo(data);
    const mime = item.contentType.startsWith('video/') ? item.contentType : 'video/mp4';
    let nativeTried = false;
    const tryNative = async (): Promise<string | null> => {
        nativeTried = true;
        return requestMediaDescription([
            { type: 'text', text: DESCRIBE_PROMPTS.video },
            { type: 'video_url', video_url: { url: `data:${mime};base64,${data.toString('base64')}` } },
        ], DOT_MEDIA_LIMITS.nativeVideoTimeoutMs, 'video');
    };
    const tryFrames = async (): Promise<string | null> => {
        // 長さ不明のときはフレーム位置が決められないため、プローブ無しでは抽出できない
        if (!probe) return null;
        const frames = await extractVideoFramesForDescribe(data, probe.durationSec);
        if (frames.length === 0) return null;
        Logger.debug(`[DotAmbient] media describe via frames kind=video frames=${frames.length}`);
        return requestMediaDescription([
            { type: 'text', text: VIDEO_FRAMES_PROMPT },
            ...frames.map(frame => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame.toString('base64')}` } })),
        ], DOT_MEDIA_LIMITS.describeTimeoutMs, 'video');
    };

    if (shouldTryNativeVideoFirst(probe, data.byteLength)) {
        const native = await tryNative();
        if (native) return native;
        return tryFrames();
    }
    const framed = await tryFrames();
    if (framed) return framed;
    if (!nativeTried) return tryNative();
    return null;
}

/** Gemma（EndPoint 経由）でメディア1件を説明する。失敗時は null（呼び出し側で failed 扱い）。 */
export async function describeDotMediaWithGemma(item: DotMediaItem): Promise<string | null> {
    const maxBytes = item.kind === 'image'
        ? DOT_MEDIA_LIMITS.imageMaxBytes
        : item.kind === 'video'
            ? DOT_MEDIA_LIMITS.videoMaxBytes
            : DOT_MEDIA_LIMITS.audioMaxBytes;
    const data = await downloadMedia(item.url, maxBytes);
    if (!data) return null;

    if (item.kind === 'video') return describeVideoWithGemma(item, data);

    let part: Record<string, unknown>;
    if (item.kind === 'image') {
        const mime = item.contentType.startsWith('image/') && item.contentType !== 'image/*' ? item.contentType : 'image/jpeg';
        part = { type: 'image_url', image_url: { url: `data:${mime};base64,${data.toString('base64')}` } };
    } else {
        const wav = await convertAudioToWav(data);
        if (!wav) return null;
        part = { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } };
    }
    return requestMediaDescription(
        [{ type: 'text', text: DESCRIBE_PROMPTS[item.kind] }, part],
        DOT_MEDIA_LIMITS.describeTimeoutMs,
        item.kind,
    );
}

/** 本番用ストア（説明は Gemma で行う）。 */
export const dotMediaStore = new DotMediaDescriptionStore(describeDotMediaWithGemma);
