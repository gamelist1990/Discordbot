import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp as makeTempDir, writeFile as writeTempFile, readFile as readTempFile, readdir as readDir, rm as removeTempDir } from 'node:fs/promises';
import { tmpdir as osTmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { promisify as promisifyFn } from 'node:util';
import { config } from '../../config.js';
import { Logger } from '../../utils/Logger.js';
import { recordAIUsage } from './AIUsageMetrics.js';

const execFileAsync = promisifyFn(execFileCallback);

/**
 * dot常駐（StaffAIDotAmbient）用の添付メディア理解。
 *
 * 方針: 判定・生成のたびに画像そのものをモデルへ渡すのではなく、メディア付き発言を
 * 1回だけ Qwen3.6とHomePCのメディア解析で「説明文」に変換してキャッシュし、会話バッファや文脈には
 * `[画像: 説明]` の形でテキストとして載せる。これにより
 * - 参加判定（30〜90秒おきに回る）がテキストだけで完結し、写真の話題を写真として認識できる
 * - 呼びかけ応答・返信生成も同じ説明を再利用でき、メディア1件あたりの視覚呼び出しが1回で済む
 * というコストと確実性のバランスを取る。説明できなかったメディアは「内容未確認」の
 * プレースホルダで存在だけは伝える（見えないまま本文だけで誤読する事故を防ぐ）。
 *
 * 経路は本番稼働中のものと同じ: EndPoint（config.pexAi.endpoint）経由の gemma-4-12B-it。
 * 実リクエストで確認済み（2026-11-07）: 画像=image_url、動画=video_url、音声=input_audio(wav)
 * の3形式とも現行スタック（EndPoint→A8ゲートウェイのカスタムビルド+mmproj）で処理できる。
 * 音声は OGG/Opus 等のデコード可否がランタイム依存のため、ffmpeg で 16kHz mono WAV に
 * 正規化してから送る（ffmpeg は ContentSafety の動画フレーム抽出でも本番使用中）。
 *
 * 動画の注意（2026-11-08 の実インシデントで判明）: video_url は動画をフレーム列の
 * トークンに展開するため、長さ×解像度に比例してプロンプトが膨らむ。27秒・1918x1078 の
 * 画面録画は 96,237 トークンになり、ゲートウェイの 32,768 トークン枠を超えて 400 になった。
 * そのため動画の映像は原則として「ffmpeg でフレームを切り出して画像として説明する」経路を
 * 使い、ネイティブ video_url は小さく短い動画のときだけ先に試す。どちらか一方が失敗したら
 * もう一方へフォールバックする。
 *
 * 説明の厚み（2026-11-08、ユーザー指示で予算拡大）: 「ちゃんと中身を読ませる」ため、
 * 説明の出力予算を引き上げ（画像1,000／動画・音声1,500トークン）、フレームは長さに応じて
 * 約3.5秒に1枚（推定トークンの上限管理つき・最大1024px）に増やした。動画に音声トラックが
 * あれば音声も抽出して説明し、映像の説明と統合する。長尺の音声は5分ごとに分割して順に
 * 説明する。フレーム数と音声分割はどちらも推定トークンで枠（32,768）超えを防ぐ設計で、
 * 「トークン爆発で説明が丸ごと失敗する」事故を再発させないことを優先する。
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
    /** 説明リクエストのタイムアウト。厚い説明（最大1,500トークン出力＋大きなプロンプト処理）に合わせる。 */
    describeTimeoutMs: 240_000,
    nativeVideoTimeoutMs: 90_000,
    /** 説明の出力トークン予算（種別ごと）。中身を具体的に書かせるための厚み。 */
    imageDescribeMaxTokens: 1_000,
    videoDescribeMaxTokens: 1_500,
    audioDescribeMaxTokens: 1_500,
    /** 説明文を文脈へ載せるときの保持上限（文字数）。映像＋音声の統合説明が収まる量にする。 */
    descriptionMaxLength: 2_000,
    cacheMaxKeys: 160,
    /** フレーム切り出しの目安間隔（秒）。長さ ÷ 間隔 が素のフレーム数になる。 */
    videoFrameIntervalSec: 3.5,
    videoFrameMinCount: 6,
    videoFrameMaxCount: 48,
    /** フレーム画像の最大辺（px）。 */
    videoFrameMaxEdge: 1_024,
    /** フレーム群の推定プロンプトトークン上限（枠 32,768 に出力分と余裕を残す）。 */
    videoFrameTokenBudget: 16_000,
    /** 音声を分割する単位（秒）と最大分割数（これを超える分は末尾を未確認として明記する）。 */
    audioChunkSec: 300,
    audioMaxChunks: 8,
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

/**
 * 画像1枚がプロンプトで占めるトークン数の経験係数（トークン / ピクセル）と固定分。
 * 実測（2026-11-08）: 768x432 のフレーム6枚＋指示文で 2,234 トークンだったことから算出。
 */
export const IMAGE_TOKENS_PER_PIXEL = 0.0011;
export const IMAGE_TOKEN_OVERHEAD = 48;

/** 音声1秒あたりのプロンプトトークン数の経験値（input_audio、16kHz mono）。 */
export const AUDIO_TOKENS_PER_SECOND = 25;

export interface VideoProbeInfo {
    durationSec: number;
    width: number;
    height: number;
    /** 音声トラックがあるか（ffprobe で判明した場合）。 */
    hasAudio?: boolean;
}

/** 動画が video_url で何トークンに展開されるかの見積もり。寸法・長さが不明なら無限大（安全側）。 */
export function estimateVideoPromptTokens(info: VideoProbeInfo): number {
    if (!(info.durationSec > 0) || !(info.width > 0) || !(info.height > 0)) return Number.POSITIVE_INFINITY;
    return Math.round(info.durationSec * info.width * info.height * VIDEO_TOKENS_PER_PIXEL_SECOND);
}

/** 画像1枚（切り出し後の寸法）の推定プロンプトトークン数。 */
export function estimateImagePromptTokens(width: number, height: number): number {
    if (!(width > 0) || !(height > 0)) return Number.POSITIVE_INFINITY;
    return Math.ceil(width * height * IMAGE_TOKENS_PER_PIXEL) + IMAGE_TOKEN_OVERHEAD;
}

export interface VideoFramePlan {
    count: number;
    intervalSec: number;
}

/**
 * 動画の長さと寸法から、説明用フレームの枚数と間隔を決める（純粋関数）。
 * 約 videoFrameIntervalSec 秒に1枚を基本にしつつ、フレーム群の推定トークンが
 * videoFrameTokenBudget を超えないよう枚数を絞る（枠超えで説明が丸ごと失敗する事故の防止）。
 */
export function planVideoFrames(info: VideoProbeInfo): VideoFramePlan {
    const durationSec = info.durationSec > 0 ? info.durationSec : 0;
    if (durationSec <= 0) return { count: DOT_MEDIA_LIMITS.videoFrameMinCount, intervalSec: 0 };
    const scale = Math.min(1, DOT_MEDIA_LIMITS.videoFrameMaxEdge / Math.max(info.width, info.height));
    const frameWidth = Math.max(1, Math.round(info.width * scale));
    const frameHeight = Math.max(1, Math.round(info.height * scale));
    const perFrameTokens = estimateImagePromptTokens(frameWidth, frameHeight);
    const byBudget = Math.max(1, Math.floor(DOT_MEDIA_LIMITS.videoFrameTokenBudget / Math.max(1, perFrameTokens)));
    const byInterval = Math.ceil(durationSec / DOT_MEDIA_LIMITS.videoFrameIntervalSec);
    const count = Math.max(1, Math.min(
        DOT_MEDIA_LIMITS.videoFrameMaxCount,
        byBudget,
        Math.max(DOT_MEDIA_LIMITS.videoFrameMinCount, byInterval),
    ));
    return { count, intervalSec: durationSec / count };
}

export interface AudioChunkPlan {
    startSec: number;
    /** 0 は「末尾まで」（長さ不明のときの単一チャンク）。 */
    durationSec: number;
}

/**
 * 音声を説明用に分割する計画（純粋関数）。1チャンクは audioChunkSec 秒以内
 * （推定トークンでも枠に十分収まる長さ）とし、分割数は audioMaxChunks で打ち切る。
 * 長さ不明なら全体を1チャンクとして扱う。
 */
export function planAudioChunks(durationSec: number): AudioChunkPlan[] {
    if (!(durationSec > 0)) return [{ startSec: 0, durationSec: 0 }];
    const chunks: AudioChunkPlan[] = [];
    for (let start = 0; start < durationSec && chunks.length < DOT_MEDIA_LIMITS.audioMaxChunks; start += DOT_MEDIA_LIMITS.audioChunkSec) {
        chunks.push({ startSec: start, durationSec: Math.min(DOT_MEDIA_LIMITS.audioChunkSec, durationSec - start) });
    }
    return chunks;
}

/** 秒を m:ss 表記にする（音声チャンクの範囲表示用）。 */
export function formatClock(totalSec: number): string {
    const sec = Math.max(0, Math.floor(totalSec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** 映像と音声の説明を1つの説明文に統合する（純粋関数）。どちらか欠けても残りで成立させる。 */
export function mergeMediaDescriptions(visual: string | null, audio: string | null): string | null {
    const v = (visual ?? '').trim();
    const a = (audio ?? '').trim();
    if (v && a) return `${v} 音声: ${a}`;
    if (v) return v;
    if (a) return `（映像は確認できなかった）音声: ${a}`;
    return null;
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
    image: 'この画像の内容を日本語で具体的に説明してください。写っている物・人・場面・状況を詳しく書き、読み取れる文字や数値があれば含めてください。写真ならどんな場面か、スクリーンショットなら何の画面で何が表示されているかまで書いてください。',
    video: 'この動画の内容を日本語で具体的に説明してください。最初から最後まで時間の流れに沿って、何が映っていて何が起きるかを詳しく書き、画面に読み取れる文字や数値（通知の件数など）があれば含めてください。見た人がツッコミたくなるポイントがあれば一言添えてください。',
    audio: 'この音声は実際に添付されています。聞こえる内容を日本語で具体的に説明してください。話し声があれば誰が何を話しているか要点を書き、音楽・効果音・環境音があればその特徴を書いてください。発言の内容は、はっきり聞き取れた場合だけ書き、聞き取れない発言を推測で作らないでください。はっきりした発言や音が確認できない場合（無音・ノイズのみ等）は、断定しすぎずにその旨を書いてください。「音声が提供されていない」「再生できない」といった表現は使わないでください。',
};

/** 音声説明が「提供されていない」等の誤った拒否になったときの再試行用プロンプト（短く直接的に）。 */
const AUDIO_FALLBACK_PROMPT = 'この音声で聞こえる音や声について、日本語で具体的に書いてください。聞き取れない発言を推測で作らないでください。';

/**
 * メディアが実際に渡っているのに「提供されていない」「再生できない」と返す誤拒否の検出（純粋関数）。
 * 実測（2026-11-08）: 発言のない音声（音楽・環境音）に対し、発言中心の長い指示文だと
 * E4B がこの誤拒否に倒れることがあった。無音・ノイズへの正当な言及は拒否に含めない。
 */
export function looksLikeMediaRefusal(text: string): boolean {
    return /(提供|添付)されてい(ない|ません)|再生でき(ない|ません)|ご提供いただけ|アップロード(して|していただけ)/.test(text);
}

/** 発言の書き起こし検証用プロンプト。実測で安定して正確だった形（発言が無ければ「発言なし」）。 */
const AUDIO_TRANSCRIBE_PROMPT = 'この音声に人の発言が含まれている場合、その発言をできるだけそのまま書き起こしてください。発言が含まれていない場合は「発言なし」とだけ書いてください。発言を創作しないでください。';

/**
 * 説明文が具体的な発言内容を主張しているかの検出（純粋関数）。
 * 引用つきの発言や「話し声」への言及がある場合に、書き起こし検証の対象にする。
 */
export function claimsSpeechContent(text: string): boolean {
    return /「[^」]{2,}」/.test(text) || /話し声|声が聞こえ|の声が|と話し|と述べ|と言い/.test(text);
}

/** 書き起こし検証の結果が「発言なし」を示しているかの検出（純粋関数）。 */
export function saysNoSpeech(text: string): boolean {
    return /発言なし|発言は(含まれてい)?ない|発言は確認でき(ない|ません)|話し声は(聞こえ|確認でき)(ない|ません)|人の声は(聞こえ|確認でき)(ない|ません)/.test(text);
}

/** フレーム列（画像群）として動画を説明するときのプロンプト。 */
const VIDEO_FRAMES_PROMPT = '次の画像は、1本の動画から等間隔に切り出したフレームです（時系列順）。この動画の内容を日本語で具体的に説明してください。最初のフレームから最後のフレームまで、時間の流れに沿って何が映っていて何が起きているかを詳しく書き、画面に読み取れる文字や数値（通知の件数など）があれば含めてください。見た人がツッコミたくなるポイントがあれば一言添えてください。';

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

/** ダウンロードしたメディアを一時ファイルに置き、処理後に必ず消す。 */
async function withTempMediaFile<T>(data: Buffer, prefix: string, fn: (sourcePath: string, folder: string) => Promise<T>): Promise<T | null> {
    const folder = await makeTempDir(joinPath(osTmpdir(), prefix));
    try {
        const source = joinPath(folder, 'input.bin');
        await writeTempFile(source, data);
        return await fn(source, folder);
    } catch {
        return null;
    } finally {
        await removeTempDir(folder, { recursive: true, force: true }).catch(() => undefined);
    }
}

/** メディアファイルの長さ・寸法・音声トラック有無を ffprobe で取得する（動画・音声共通）。 */
async function probeMediaFile(sourcePath: string): Promise<VideoProbeInfo | null> {
    try {
        const { stdout } = await execFileAsync('ffprobe', ['-v', 'error',
            '-show_entries', 'stream=codec_type,width,height', '-show_entries', 'format=duration', '-of', 'json', sourcePath], { timeout: 15_000 });
        const parsed = JSON.parse(String(stdout)) as {
            streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
            format?: { duration?: string };
        };
        const streams = parsed.streams ?? [];
        const video = streams.find(stream => stream.codec_type === 'video');
        return {
            durationSec: Number(parsed.format?.duration ?? 0),
            width: Number(video?.width ?? 0),
            height: Number(video?.height ?? 0),
            hasAudio: streams.some(stream => stream.codec_type === 'audio'),
        };
    } catch {
        return null;
    }
}

/** 動画から計画どおりのフレーム（JPEG・最大辺 videoFrameMaxEdge px）を1パスの抽出で切り出す。 */
async function extractVideoFramesFromFile(sourcePath: string, folder: string, plan: VideoFramePlan): Promise<Buffer[]> {
    if (!(plan.intervalSec > 0) || plan.count < 1) return [];
    try {
        const fps = (1 / plan.intervalSec).toFixed(5);
        const scale = `scale=${DOT_MEDIA_LIMITS.videoFrameMaxEdge}:${DOT_MEDIA_LIMITS.videoFrameMaxEdge}:force_original_aspect_ratio=decrease`;
        await execFileAsync('ffmpeg', ['-v', 'error', '-i', sourcePath,
            '-vf', `fps=${fps},${scale}`, '-frames:v', String(plan.count), '-q:v', '3', '-y', joinPath(folder, 'frame-%03d.jpg')],
            { timeout: 90_000 });
        const names = (await readDir(folder)).filter(name => /^frame-\d+\.jpg$/.test(name)).sort();
        const frames: Buffer[] = [];
        for (const name of names) {
            const frame = await readTempFile(joinPath(folder, name)).catch(() => null);
            if (frame && frame.byteLength > 0) frames.push(frame);
        }
        return frames;
    } catch {
        return [];
    }
}

/** 音声の1チャンクを 16kHz mono WAV で切り出す（動画の音声トラックにも同じ処理を使う）。 */
async function extractAudioChunkWav(sourcePath: string, folder: string, index: number, chunk: AudioChunkPlan): Promise<Buffer | null> {
    try {
        const target = joinPath(folder, `audio-${index}.wav`);
        const args = ['-v', 'error'];
        if (chunk.startSec > 0) args.push('-ss', String(chunk.startSec));
        args.push('-i', sourcePath);
        if (chunk.durationSec > 0) args.push('-t', String(chunk.durationSec));
        args.push('-vn', '-ar', '16000', '-ac', '1', '-y', target);
        await execFileAsync('ffmpeg', args, { timeout: 45_000 });
        const wav = await readTempFile(target);
        return wav.byteLength > 0 ? wav : null;
    } catch {
        return null;
    }
}

/** 説明リクエストを EndPoint 経由で Gemma に投げる共通処理。失敗時は理由をログに残して null。 */
async function requestMediaDescription(parts: Array<Record<string, unknown>>, timeoutMs: number, kind: DotMediaKind, maxTokens: number): Promise<string | null> {
    try {
        // Strata handles images/video via HomePC; keep the legacy model for audio processing.
        const mediaModel = config.pexAi.visionModel || config.pexAi.model;
        const response = await fetch(`${config.pexAi.endpoint.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(config.pexAi.apiKey ? { authorization: `Bearer ${config.pexAi.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: mediaModel,
                messages: [{ role: 'user', content: parts }],
                temperature: 0.2,
                max_tokens: maxTokens,
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
            purpose: 'media', model: mediaModel,
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

/** 音声1チャンクを説明する。誤拒否への再試行と、発言主張に対する書き起こし検証つき。 */
async function describeAudioChunk(wav: Buffer, rangeNote: string): Promise<string | null> {
    const audioPart = { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } };
    const call = (prompt: string, maxTokens: number) => requestMediaDescription(
        [{ type: 'text', text: rangeNote + prompt }, audioPart],
        DOT_MEDIA_LIMITS.describeTimeoutMs, 'audio', maxTokens,
    );
    let text = await call(DESCRIBE_PROMPTS.audio, DOT_MEDIA_LIMITS.audioDescribeMaxTokens);
    if (text && looksLikeMediaRefusal(text)) {
        // 音声は実際に渡っているのに「提供されていない」と返す誤拒否。短い指示で1回だけ再試行する。
        Logger.debug('[DotAmbient] media describe audio refusal, retrying with fallback prompt');
        const retry = await call(AUDIO_FALLBACK_PROMPT, DOT_MEDIA_LIMITS.audioDescribeMaxTokens);
        text = retry && !looksLikeMediaRefusal(retry) ? retry : null;
    }
    if (!text) return null;
    if (claimsSpeechContent(text)) {
        // 発言の具体を主張する説明は書き起こしで裏取りする。E4B は静かな音楽・環境音にも
        // 発言を創作することがある（実測 2026-11-08: 無発言の録画音声に議事発言や女性の声を創作）。
        // 検証が「発言なし」なら、発言に触れない説明へ作り直す（作り直しも主張する場合は固定文）。
        const verdict = await call(AUDIO_TRANSCRIBE_PROMPT, 600);
        if (verdict && saysNoSpeech(verdict)) {
            Logger.debug('[DotAmbient] media describe audio speech claim rejected by transcription check');
            const redo = await call('検証の結果、この音声に明瞭な発言は含まれていませんでした。発言の内容には触れず、聞こえる音（音楽・効果音・環境音など）の特徴だけを具体的に書いてください。聞き取れない発言を推測で作らないでください。', DOT_MEDIA_LIMITS.audioDescribeMaxTokens);
            if (redo && !looksLikeMediaRefusal(redo) && !claimsSpeechContent(redo)) return redo;
            return '明瞭な発言は確認できなかった';
        }
    }
    return text;
}

/**
 * 音声トラック（または音声ファイル全体）を説明する。長い場合は planAudioChunks の
 * 分割ごとに説明し、時刻範囲つきで順に連結する。分割上限を超えた分は未確認と明記する。
 */
async function describeAudioTrack(sourcePath: string, folder: string, durationSec: number): Promise<string | null> {
    const chunks = planAudioChunks(durationSec);
    const parts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const wav = await extractAudioChunkWav(sourcePath, folder, i, chunk);
        if (!wav) continue;
        const rangeNote = chunks.length > 1
            ? `この音声は全体の ${i + 1}/${chunks.length} 部分（${formatClock(chunk.startSec)}〜${formatClock(chunk.startSec + chunk.durationSec)}）です。`
            : '';
        const text = await describeAudioChunk(wav, rangeNote);
        if (text) parts.push(chunks.length > 1 ? `${formatClock(chunk.startSec)}〜 ${text}` : text);
    }
    if (parts.length === 0) return null;
    let combined = parts.join(' ');
    const last = chunks[chunks.length - 1];
    const coveredEnd = last.durationSec > 0 ? last.startSec + last.durationSec : durationSec;
    if (durationSec > coveredEnd + 1) {
        combined += `（長いため ${formatClock(coveredEnd)} 以降の音声は未確認）`;
    }
    return combined;
}

/**
 * 動画1件を説明する。映像は、小さく短い動画ならネイティブ video_url を先に試し、
 * それ以外はフレーム列（画像）として説明する（一方が失敗したらもう一方へフォールバック）。
 * 音声トラックがあれば音声も別途説明し、映像の説明と統合する。
 * （video_url は長さ×解像度でトークンが膨らみ、枠を超えると 400 になるため。）
 */
async function describeVideoWithGemma(item: DotMediaItem, data: Buffer): Promise<string | null> {
    return withTempMediaFile(data, 'dot-video-', async (source, folder) => {
        const probe = await probeMediaFile(source);
        const probeInfo: VideoProbeInfo | null = probe && probe.durationSec > 0 && probe.width > 0 && probe.height > 0 ? probe : null;
        const mime = item.contentType.startsWith('video/') ? item.contentType : 'video/mp4';
        let nativeTried = false;
        const tryNative = async (): Promise<string | null> => {
            nativeTried = true;
            return requestMediaDescription([
                { type: 'text', text: DESCRIBE_PROMPTS.video },
                { type: 'video_url', video_url: { url: `data:${mime};base64,${data.toString('base64')}` } },
            ], DOT_MEDIA_LIMITS.nativeVideoTimeoutMs, 'video', DOT_MEDIA_LIMITS.videoDescribeMaxTokens);
        };
        const tryFrames = async (): Promise<string | null> => {
            // 長さ・寸法が不明だとフレーム計画が立てられないため、プローブ無しでは抽出できない
            if (!probeInfo) return null;
            const plan = planVideoFrames(probeInfo);
            const frames = await extractVideoFramesFromFile(source, folder, plan);
            if (frames.length === 0) return null;
            Logger.debug(`[DotAmbient] media describe via frames kind=video frames=${frames.length} plan=${plan.count}`);
            const describeWithFrames = (selected: Buffer[]) => requestMediaDescription([
                { type: 'text', text: VIDEO_FRAMES_PROMPT },
                ...selected.map(frame => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame.toString('base64')}` } })),
            ], DOT_MEDIA_LIMITS.describeTimeoutMs, 'video', DOT_MEDIA_LIMITS.videoDescribeMaxTokens);
            const described = await describeWithFrames(frames);
            if (described) return described;
            // フレームが多いと視覚処理＋生成がタイムアウトしうる（実測: 32枚で150秒超）。
            // 1回だけ、フレームを半分に間引いて再試行する（間隔が粗くなっても説明は成立する）。
            if (frames.length >= 8) {
                const thinned = frames.filter((_, index) => index % 2 === 0);
                Logger.debug(`[DotAmbient] media describe via frames retry thinned=${thinned.length}`);
                return describeWithFrames(thinned);
            }
            return null;
        };

        let visual: string | null = null;
        if (shouldTryNativeVideoFirst(probeInfo, data.byteLength)) {
            visual = await tryNative();
        }
        if (!visual) visual = await tryFrames();
        if (!visual && !nativeTried) visual = await tryNative();

        let audio: string | null = null;
        if (probe?.hasAudio) {
            audio = await describeAudioTrack(source, folder, probe.durationSec);
        }
        return mergeMediaDescriptions(visual, audio);
    });
}

/** 音声ファイル1件を説明する（長尺は分割して順に説明する）。 */
async function describeAudioWithGemma(data: Buffer): Promise<string | null> {
    return withTempMediaFile(data, 'dot-audio-', async (source, folder) => {
        const probe = await probeMediaFile(source);
        return describeAudioTrack(source, folder, probe?.durationSec ?? 0);
    });
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
    if (item.kind === 'audio') return describeAudioWithGemma(data);

    const mime = item.contentType.startsWith('image/') && item.contentType !== 'image/*' ? item.contentType : 'image/jpeg';
    return requestMediaDescription(
        [
            { type: 'text', text: DESCRIBE_PROMPTS.image },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${data.toString('base64')}` } },
        ],
        DOT_MEDIA_LIMITS.describeTimeoutMs,
        'image',
        DOT_MEDIA_LIMITS.imageDescribeMaxTokens,
    );
}

/** 本番用ストア（説明は Gemma で行う）。 */
export const dotMediaStore = new DotMediaDescriptionStore(describeDotMediaWithGemma);
