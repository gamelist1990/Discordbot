import type { GuildTextBasedChannel } from 'discord.js';
import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIToolContext, ChatAIToolRegistrar } from './types.js';

// 全ギルドで確実に許容される保守的な上限を採用する。
// Nitroやサーバーブースト由来の上限には依存しない。
export const MAX_DISCORD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES_PER_CALL = 4;

const uploadImageDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'upload_image',
        description: 'youtube_detailsで抽出した静止画、またはimage_editorで作成した画像をDiscordチャンネルへ添付します。ユーザーへ完成画像を渡す場合に使います。',
        parameters: {
            type: 'object',
            properties: {
                image_indices: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '送信するアップロード候補画像番号の配列。生成された順番の1始まり。最大4枚。',
                },
                caption: {
                    type: 'string',
                    description: '画像と一緒に送る短い説明。省略可。',
                },
            },
            required: ['image_indices'],
        },
    },
};

export const uploadImageHandler: ToolHandler = async (args, context?: ChatAIToolContext) => {
    const requested: unknown[] = Array.isArray(args?.image_indices) ? args.image_indices : [];
    const indices: number[] = Array.from(new Set<number>(
        requested
            .map((value: unknown) => Math.trunc(Number(value)))
            .filter((value: number) => Number.isFinite(value) && value >= 1),
    )).slice(0, MAX_IMAGES_PER_CALL);

    if (indices.length === 0) return 'UPLOAD_IMAGE_ERROR: 有効な画像番号を指定してください。';
    const generatedImages = context?.generatedImages ?? [];
    if (generatedImages.length === 0) {
        return 'UPLOAD_IMAGE_ERROR: アップロード候補がありません。先にyoutube_detailsのcaptureまたはimage_editorで画像を用意してください。';
    }

    const uploadedImageIndices = context?.uploadedImageIndices ?? new Set<number>();
    const duplicates = indices.filter(index => uploadedImageIndices.has(index));
    if (duplicates.length > 0) {
        return `UPLOAD_IMAGE_ERROR: 画像 ${duplicates.join(', ')} はこの応答中に送信済みです。重複送信はしません。`;
    }

    const selected = indices.map(index => ({ index, image: generatedImages[index - 1] }));
    const missing = selected.filter(entry => !entry.image).map(entry => entry.index);
    if (missing.length > 0) {
        return `UPLOAD_IMAGE_ERROR: 画像 ${missing.join(', ')} は存在しません。利用可能範囲は1～${generatedImages.length}です。`;
    }

    const oversized = selected.filter(entry => entry.image.data.byteLength > MAX_DISCORD_FILE_BYTES);
    if (oversized.length > 0) {
        return `UPLOAD_IMAGE_ERROR: 画像 ${oversized.map(entry => entry.index).join(', ')} がDiscordの安全なファイル上限10MiBを超えています。抽出幅を小さくして再取得してください。`;
    }

    const totalBytes = selected.reduce((sum, entry) => sum + entry.image.data.byteLength, 0);
    if (totalBytes > MAX_DISCORD_FILE_BYTES) {
        return `UPLOAD_IMAGE_ERROR: 選択画像の合計がDiscord送信用の安全上限10MiBを超えています。枚数を減らすか抽出幅を小さくしてください。`;
    }

    const client = context?.client;
    const channelId = typeof context?.channelId === 'string' ? context.channelId : '';
    if (!client || !channelId) return 'UPLOAD_IMAGE_ERROR: Discordチャンネル情報を取得できません。';

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
        return 'UPLOAD_IMAGE_ERROR: 送信先のDiscordテキストチャンネルを取得できません。';
    }

    const caption = String(args?.caption ?? '').trim().slice(0, 1_900);
    const files = selected.map(entry => ({
        attachment: entry.image.data,
        name: entry.image.filename,
        description: entry.image.description.slice(0, 1_024),
    }));
    try {
        await (channel as GuildTextBasedChannel).send({
            content: caption || undefined,
            files,
        });
        for (const index of indices) uploadedImageIndices.add(index);
        if (context) context.uploadedImageIndices = uploadedImageIndices;
        return `UPLOAD_IMAGE_SUCCESS: ${files.length}枚をDiscordへ送信しました（合計${totalBytes}バイト）。`;
    } catch (error) {
        return `UPLOAD_IMAGE_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
};

export const registerUploadImageTool: ChatAIToolRegistrar = (manager) => {
    manager.registerTool(uploadImageDefinition, uploadImageHandler);
};
