import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIToolContext, ChatAIToolRegistrar } from './types.js';
import { config } from '../../../config.js';

const youtubeDetailsDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'youtube_details',
        description: 'PEX Serverを使ってYouTube動画の公開メタデータ、チャプター、字幕を取得します。必要な場合は指定区間の静止画も抽出できます。',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '解析するYouTube動画URL' },
                include_transcript: { type: 'boolean', description: '字幕本文を取得するか。既定はtrue。' },
                languages: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '字幕の優先言語。既定はja、en。',
                },
                max_transcript_chars: { type: 'number', description: '字幕本文の最大文字数。1～100000、既定は30000。' },
                capture: {
                    type: 'object',
                    description: '指定時間範囲から静止画を抽出する設定。不要な場合は省略。',
                    properties: {
                        start_seconds: { type: 'number', description: '抽出開始位置（秒）' },
                        end_seconds: { type: 'number', description: '抽出終了位置（秒）' },
                        interval_seconds: { type: 'number', description: 'フレーム間隔（秒）。既定10、最小1。' },
                        max_frames: { type: 'number', description: '最大画像数。既定6、上限12。' },
                        width: { type: 'number', description: '最大幅。既定640、160～1280。' },
                    },
                    required: ['start_seconds', 'end_seconds'],
                },
            },
            required: ['url'],
        },
    },
};

interface YoutubeDetailsResponse {
    video_id: string;
    canonical_url: string;
    title: string;
    description?: string | null;
    duration_seconds?: number | null;
    uploader?: string | null;
    uploader_url?: string | null;
    upload_date?: string | null;
    view_count?: number | null;
    like_count?: number | null;
    live_status?: string | null;
    chapters: Array<{ title: string; start_seconds: number; end_seconds: number }>;
    subtitle_tracks: Array<{ language: string; automatic: boolean; formats: string[] }>;
    transcript?: {
        language: string;
        automatic: boolean;
        truncated: boolean;
        text: string;
        segments: Array<{ start_seconds: number; duration_seconds: number; text: string }>;
    } | null;
    captures: Array<{ timestamp_seconds: number; mime_type: string; width: number; data_base64: string }>;
    extractor: string;
    cache_hit: boolean;
    ai_used: boolean;
}

export const youtubeDetailsHandler: ToolHandler = async (args, context?: ChatAIToolContext) => {
    const url = String(args?.url ?? '').trim();
    if (!url) return 'YouTube動画URLが空です。';

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return 'YOUTUBE_ERROR: URL形式が不正です。';
    }
    const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
    if (!['youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'].includes(hostname)) {
        return 'YOUTUBE_ERROR: YouTubeのURLを指定してください。';
    }

    const body: Record<string, unknown> = {
        url,
        include_transcript: args?.include_transcript !== false,
        languages: Array.isArray(args?.languages)
            ? args.languages.filter((language: unknown): language is string => typeof language === 'string' && language.trim().length > 0)
            : ['ja', 'en'],
        max_transcript_chars: Math.min(Math.max(Math.trunc(Number(args?.max_transcript_chars ?? 30_000)) || 30_000, 1), 100_000),
    };

    if (args?.capture && typeof args.capture === 'object') {
        body.capture = {
            start_seconds: Number(args.capture.start_seconds),
            end_seconds: Number(args.capture.end_seconds),
            interval_seconds: Math.max(Number(args.capture.interval_seconds ?? 10), 1),
            max_frames: Math.min(Math.max(Math.trunc(Number(args.capture.max_frames ?? 6)) || 6, 1), 12),
            width: Math.min(Math.max(Math.trunc(Number(args.capture.width ?? 640)) || 640, 160), 1280),
        };
    }

    const endpoint = `${config.pexAi.endpoint.replace(/\/$/, '')}/youtube/details`;
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(config.pexAi.apiKey ? { authorization: `Bearer ${config.pexAi.apiKey}` } : {}),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 500);
            return `YOUTUBE_ERROR: PEX Server HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
        }

        const data = await response.json() as YoutubeDetailsResponse;
        const lines = [
            `タイトル: ${data.title}`,
            `URL: ${data.canonical_url}`,
            `動画ID: ${data.video_id}`,
            `投稿者: ${data.uploader ?? '不明'}`,
            `長さ: ${data.duration_seconds ?? '不明'}秒`,
            `公開日: ${data.upload_date ?? '不明'}`,
            `再生数: ${data.view_count ?? '不明'}`,
            `高評価数: ${data.like_count ?? '不明'}`,
            `ライブ状態: ${data.live_status ?? '不明'}`,
        ];
        if (data.description) lines.push(`説明:\n${data.description}`);
        if (data.chapters?.length) {
            lines.push(`チャプター:\n${data.chapters.map(chapter =>
                `- ${chapter.start_seconds}～${chapter.end_seconds}秒: ${chapter.title}`,
            ).join('\n')}`);
        }
        if (data.transcript) {
            lines.push(`字幕 (${data.transcript.language}${data.transcript.automatic ? '・自動生成' : ''}${data.transcript.truncated ? '・省略あり' : ''}):\n${data.transcript.text}`);
        } else {
            lines.push('字幕: 取得できませんでした。');
        }
        if (data.captures?.length) {
            const generatedImages = context?.generatedImages ?? [];
            for (const [index, capture] of data.captures.entries()) {
                if (capture.mime_type !== 'image/jpeg' || !capture.data_base64) continue;
                const image = Buffer.from(capture.data_base64, 'base64');
                if (image.length === 0) continue;
                generatedImages.push({
                    source: 'youtube',
                    data: image,
                    mimeType: 'image/jpeg',
                    filename: `youtube-${data.video_id}-${Math.round(capture.timestamp_seconds * 1000)}ms-${index + 1}.jpg`,
                    description: `${data.title} の ${capture.timestamp_seconds}秒地点`,
                });
            }
            if (context) context.generatedImages = generatedImages;
            lines.push(`静止画: ${generatedImages.length}枚をアップロード候補として用意しました。ユーザーが画像を求めている場合はupload_imageを呼び出してください。`);
        }
        lines.push(`取得元: ${data.extractor} / キャッシュ: ${data.cache_hit ? '使用' : '未使用'} / AI使用: ${data.ai_used ? 'あり' : 'なし'}`);
        return lines.join('\n');
    } catch (error) {
        return `YOUTUBE_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
};

export const registerYoutubeDetailsTool: ChatAIToolRegistrar = (manager) => {
    manager.registerTool(youtubeDetailsDefinition, youtubeDetailsHandler);
};
