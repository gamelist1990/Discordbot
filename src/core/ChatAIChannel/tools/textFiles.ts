import fs from 'node:fs/promises';
import path from 'node:path';
import { AttachmentBuilder, type Message } from 'discord.js';
import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAISandboxPaths } from '../types.js';
import type { ChatAIToolContext, ChatAIToolRegistrar, ChatAIToolRegisterContext } from './types.js';
import { CHAT_AI_TEXT_FILE_MAX_BYTES, normalizeChatAITextFilename } from './textFilePolicy.js';
import { stripDiscordStreamMetadata } from '../../ai/AIConversationHistory.js';

export { CHAT_AI_TEXT_FILE_MAX_BYTES } from './textFilePolicy.js';

function getSessionDirectory(paths: ChatAISandboxPaths, context?: ChatAIToolContext): string | null {
    const sessionId = typeof context?.uploadSessionId === 'string' ? context.uploadSessionId : '';
    if (!/^\d{1,24}$/.test(sessionId)) return null;
    return path.join(paths.uploads, sessionId);
}

export const createTextFileDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'create_text_file',
        description: 'ユーザーへ渡す軽量なテキスト成果物を作成します。uploadsへ隔離して保存され、Discordへ送るには続けてupload_filesを呼びます。対応形式: txt, md, html, css, json, csv, xml, yaml, js, ts, pyなど。1ファイル最大256KiB。',
        parameters: {
            type: 'object',
            properties: {
                filename: { type: 'string', description: '添付名。フォルダ名を含めず、対応するテキスト拡張子を付ける。例: code_1.txt' },
                content: { type: 'string', description: 'ファイルに書き込むUTF-8テキスト。' },
            },
            required: ['filename', 'content'],
        },
    },
};

export const uploadFilesDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'upload_files',
        description: 'create_text_fileで作成したテキストファイルを、このDiscordチャンネルへ添付します。ファイルを作成・送信したと説明する前に、必ず成功結果を確認してください。',
        parameters: {
            type: 'object',
            properties: {
                filenames: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' }, description: 'この応答中にcreate_text_fileで作ったファイル名。' },
            },
            required: ['filenames'],
        },
    },
};

export function createTextFileHandler(paths: ChatAISandboxPaths): ToolHandler {
    return async (args, context?: ChatAIToolContext) => {
        const filename = normalizeChatAITextFilename(args?.filename);
        if (!filename) return 'FILE_ERROR: 対応していない拡張子、または安全でないファイル名です。';
        if (typeof args?.content !== 'string') return 'FILE_ERROR: contentは文字列で指定してください。';

        const cleanContent = stripDiscordStreamMetadata(args.content);
        const buffer = Buffer.from(cleanContent, 'utf8');
        if (buffer.byteLength > CHAT_AI_TEXT_FILE_MAX_BYTES) {
            return `FILE_ERROR: ファイルは${CHAT_AI_TEXT_FILE_MAX_BYTES / 1024}KiB以内にしてください。`;
        }
        if (buffer.includes(0)) return 'FILE_ERROR: バイナリデータは作成できません。テキストとして作成してください。';

        const directory = getSessionDirectory(paths, context);
        if (!directory) return 'FILE_ERROR: この応答用の保存先がありません。';
        await fs.mkdir(directory, { recursive: true });
        const filePath = path.join(directory, filename);
        try {
            await fs.writeFile(filePath, buffer, { flag: 'wx' });
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
                return `FILE_ERROR: ${filename} はすでに作成されています。別のファイル名を使ってください。`;
            }
            throw error;
        }
        return `TEXT_FILE_CREATED: ${filename} (${buffer.byteLength} bytes)。Discordへ添付するにはupload_filesを呼び出してください。`;
    };
}

export function createUploadFilesHandler(paths: ChatAISandboxPaths): ToolHandler {
    return async (args, context?: ChatAIToolContext) => {
        const filenames = Array.isArray(args?.filenames) ? args.filenames : [];
        if (filenames.length < 1 || filenames.length > 5) return 'UPLOAD_ERROR: 1〜5個のファイル名を指定してください。';
        const directory = getSessionDirectory(paths, context);
        if (!directory) return 'UPLOAD_ERROR: この応答用の保存先がありません。';

        const client = context?.client;
        const guildId = typeof context?.guildId === 'string' ? context.guildId : '';
        const channelId = typeof context?.channelId === 'string' ? context.channelId : '';
        if (!client || !guildId || !channelId) return 'UPLOAD_ERROR: Discordチャンネルを確認できません。';

        const channel = client.channels.cache.get(channelId)
            ?? await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !('guildId' in channel) || channel.guildId !== guildId || !channel.isTextBased() || !('send' in channel)) {
            return 'UPLOAD_ERROR: 送信先のDiscordテキストチャンネルが見つかりません。';
        }

        const files: AttachmentBuilder[] = [];
        const seen = new Set<string>();
        let totalBytes = 0;
        for (const requestedName of filenames) {
            const filename = normalizeChatAITextFilename(requestedName);
            if (!filename) return `UPLOAD_ERROR: 安全でない名前、または非対応形式です (${String(requestedName).slice(0, 100)})。`;
            if (seen.has(filename)) return `UPLOAD_ERROR: ${filename} が重複しています。`;
            seen.add(filename);
            const filePath = path.join(directory, filename);
            const file = await fs.readFile(filePath).catch(() => null);
            if (!file) return `UPLOAD_ERROR: ${filename} が見つかりません。この応答中にcreate_text_fileで作成してください。`;
            if (file.byteLength > CHAT_AI_TEXT_FILE_MAX_BYTES || file.includes(0)) {
                return `UPLOAD_ERROR: ${filename} はサイズ上限を超えているか、テキストではありません。`;
            }
            totalBytes += file.byteLength;
            if (totalBytes > 5 * CHAT_AI_TEXT_FILE_MAX_BYTES) return 'UPLOAD_ERROR: 合計サイズが上限を超えています。';
            files.push(new AttachmentBuilder(file, { name: filename }));
        }

        const sendable = channel as typeof channel & { send: (payload: unknown) => Promise<Message> };
        let sentMessage: Message;
        try {
            sentMessage = await sendable.send({
                files,
                allowedMentions: { parse: [], repliedUser: false },
            });
        } catch (error) {
            await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
            throw error;
        }
        const links = files.map(file => {
            const filename = file.name ?? 'file.txt';
            const attachment = sentMessage.attachments?.find(entry => entry.name === filename);
            return attachment ? `[${filename}](${attachment.url})` : filename;
        });
        await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
        return `FILES_UPLOADED: ${links.join(', ')} をDiscordへ添付しました。`;
    };
}

export function isChatAITextFileRequest(text: string): boolean {
    const artifact = '(?:ファイル|コード(?:ファイル)?|HTML|HTM|TXT|テキスト|Markdown|\\.md\\b|\\.txt\\b|\\.html?\\b|\\.json\\b|\\.csv\\b|\\.css\\b|\\.js\\b|\\.ts\\b|\\.py\\b)';
    const create = '(?:作って|作成して|書いて|生成して|用意して|出力して|添付して|アップロードして|にして|にしてください)';
    return new RegExp(`${artifact}.{0,15}${create}|${create}.{0,15}${artifact}`, 'i').test(text);
}

export const registerTextFileTools: ChatAIToolRegistrar = (manager, { sandboxPaths }: ChatAIToolRegisterContext) => {
    manager.registerTool(createTextFileDefinition, createTextFileHandler(sandboxPaths));
    manager.registerTool(uploadFilesDefinition, createUploadFilesHandler(sandboxPaths));
};
