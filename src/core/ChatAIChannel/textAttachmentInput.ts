import fs from 'node:fs/promises';
import path from 'node:path';
import type { Attachment } from 'discord.js';
import { CHAT_AI_TEXT_FILE_MAX_BYTES, normalizeChatAITextFilename } from './tools/textFilePolicy.js';

export const MAX_CHAT_AI_TEXT_ATTACHMENTS = 3;
export const MAX_CHAT_AI_TEXT_ATTACHMENT_TOTAL_CHARS = 24_000;

export interface LoadedChatAITextAttachment {
    filename: string;
    text: string;
    byteLength: number;
    relativePath: string;
    truncated: boolean;
}

export interface ChatAITextAttachmentFailure {
    filename: string;
    reason: string;
}

export function isSupportedChatAITextAttachment(attachment: Attachment): boolean {
    return normalizeChatAITextFilename(attachment.name) !== null;
}

export async function loadChatAITextAttachment(
    attachment: Attachment,
    directory: string,
    remainingCharacters: number,
): Promise<LoadedChatAITextAttachment | ChatAITextAttachmentFailure> {
    const filename = normalizeChatAITextFilename(attachment.name);
    if (!filename) return { filename: attachment.name.slice(0, 120), reason: '対応していないテキスト形式です' };
    if (attachment.size > CHAT_AI_TEXT_FILE_MAX_BYTES) {
        return { filename, reason: '1ファイルあたり256KiBの上限を超えています' };
    }

    let url: URL;
    try {
        url = new URL(attachment.url);
    } catch {
        return { filename, reason: '添付ファイルのURLが不正です' };
    }
    if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) {
        return { filename, reason: 'Discordのファイル配信元ではありません' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'user-agent': 'PexisChatAI/1.0' },
            redirect: 'error',
        });
        if (!response.ok || !response.body) return { filename, reason: `取得に失敗しました (HTTP ${response.status})` };

        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > CHAT_AI_TEXT_FILE_MAX_BYTES) {
            return { filename, reason: '1ファイルあたり256KiBの上限を超えています' };
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let byteLength = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            byteLength += value.byteLength;
            if (byteLength > CHAT_AI_TEXT_FILE_MAX_BYTES) {
                await reader.cancel().catch(() => undefined);
                return { filename, reason: '1ファイルあたり256KiBの上限を超えています' };
            }
            chunks.push(value);
        }

        const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), byteLength);
        let text: string;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
        } catch {
            return { filename, reason: 'UTF-8テキストとして読み込めませんでした' };
        }
        if (text.includes('\0')) return { filename, reason: 'テキスト以外のデータが含まれています' };

        const truncated = text.length > remainingCharacters;
        const promptText = text.slice(0, Math.max(0, remainingCharacters));
        await fs.mkdir(directory, { recursive: true });
        const fileDirectory = path.join(directory, attachment.id.replace(/[^0-9]/g, '').slice(0, 24) || 'attachment');
        await fs.mkdir(fileDirectory, { recursive: true });
        await fs.writeFile(path.join(fileDirectory, filename), buffer, { flag: 'w' });

        return {
            filename,
            text: promptText,
            byteLength,
            relativePath: path.posix.join(path.basename(directory), path.basename(fileDirectory), filename),
            truncated,
        };
    } catch (error) {
        return {
            filename,
            reason: error instanceof Error && error.name === 'AbortError' ? '取得がタイムアウトしました' : '読み込みに失敗しました',
        };
    } finally {
        clearTimeout(timeout);
    }
}
