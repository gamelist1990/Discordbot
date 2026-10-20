import { createHash } from 'node:crypto';
import { stripToolProtocolText } from '../../../../core/ai/ToolProtocolTextFilter.js';
import { AttachmentBuilder, type ChatInputCommandInteraction, type Message } from 'discord.js';
import type { OpenAITool, ToolHandler } from '../../../../types/openai.js';
import { CHAT_AI_TEXT_FILE_MAX_BYTES, normalizeChatAITextFilename } from '../../../../core/ChatAIChannel/tools/textFilePolicy.js';

export const staffOutputFileDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'output_file',
        description: '/staff aiからDiscordへテキストファイルを直接出力・添付します。HTML/MD/JSON/CSV/Python/ソースコードなどをfilenameとUTF-8 contentの1回の呼び出しで作成し、実際の添付URLを返します。成功確認前に送信済みと説明しないでください。同じ内容の同じファイルは1度だけ送信し、成功後は返されたURLで案内して本文やコードを再掲しないでください。',
        parameters: {
            type: 'object',
            properties: {
                filename: { type: 'string', description: '例: index.html, report.md, example.py, data.json。拡張子必須。' },
                content: { type: 'string', description: 'Markdownのコードフェンスや説明を含めない、完成したファイル全体のUTF-8テキスト。HTMLの末尾や必要な機能まで省略せず入れる。' },
            },
            required: ['filename', 'content'],
        },
    },
};

export interface StaffUploadedFile { filename: string; bytes: number; url: string }
type OutputState = { requests: Map<string, { hash: string; promise: Promise<string> }>; uploaded: Map<string, StaffUploadedFile>; messages: Map<string, Message>; uncertain: Set<string> };
const outputStates = new WeakMap<object, OutputState>();

/** Same interaction, filename and bytes share one in-flight upload and its outcome. */
export function staffFileOutputResponse(context: object, response = ''): string | null {
    const uploaded = outputStates.get(context)?.uploaded;
    if (!uploaded?.size) return null;
    const body = stripToolProtocolText(response).replace(/```[\s\S]*?(?:```|$)/g, '').replace(/^\s*\d+[.)]\s*$/, '').trim();
    const links = [...uploaded.values()].filter(file => !body.includes(file.url))
        .map(file => `[${file.filename.replace(/[\[\]\\]/g, '\\$&')}](${file.url})`);
    return [body, ...links].filter(Boolean).join('\n');
}

export const staffOutputFileHandler: ToolHandler = async (args, context) => {
    const filename = normalizeChatAITextFilename(args?.filename);
    if (!filename || filename !== args?.filename || /[/\\:]/.test(filename)) {
        return 'FILE_ERROR: ファイル名が安全でないか、対応していない拡張子です。';
    }
    if (typeof args?.content !== 'string') return 'FILE_ERROR: contentにはテキストを指定してください。';
    const content = args.content;
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > CHAT_AI_TEXT_FILE_MAX_BYTES || bytes.includes(0)) {
        return 'FILE_ERROR: 256KiBを超えるファイル、またはバイナリには対応していません。';
    }
    const interaction = context as ChatInputCommandInteraction | undefined;
    if (!interaction?.guildId || !interaction.channelId || !interaction.followUp) {
        return 'FILE_ERROR: Discordの/staff ai応答先が確認できません。';
    }
    let state = outputStates.get(interaction);
    if (!state) { state = { requests: new Map(), uploaded: new Map(), messages: new Map(), uncertain: new Set() }; outputStates.set(interaction, state); }
    const key = createHash('sha256').update(filename).update('\0').update(bytes).digest('hex');
    const existing = state.requests.get(filename);
    if (existing?.hash === key) return existing.promise;
    // Install the promise before followUp starts, including concurrent tool calls.
    // Keep uncertain/failed outcomes too: blindly retrying can duplicate a message
    // which Discord accepted before a network error or missing attachment metadata.
    const upload = Promise.resolve(existing?.promise).then(async () => {
        try {
            // Use the existing deferred slash interaction, without saving the file to global disk.
            const previous = state.messages.get(filename);
            if (!previous && state.uncertain.has(filename)) return 'FILE_ERROR: 先の送信状態が不明なため同名ファイルを自動再送しません。Discord上の送信状態を確認してください。';
            const payload = {
                content: filename + ' をファイルとして出力しました。',
                files: [new AttachmentBuilder(bytes, { name: filename })],
                allowedMentions: { parse: [] as [] },
            };
            const reply = previous
                ? await previous.edit({ ...payload, attachments: [] })
                : await interaction.followUp(payload);
            state.messages.set(filename, reply);
            const attachment = reply.attachments?.find(entry => entry.name === filename);
            if (!attachment?.url) return 'FILE_ERROR: Discord送信後の添付URLを取得できません。送信状態を確認してください。';
            const file = { filename, bytes: bytes.length, url: attachment.url };
            state.uploaded.set(filename, file);
            return 'FILE_UPLOADED: ' + JSON.stringify(file);
        } catch (error) {
            if (!state.messages.has(filename)) state.uncertain.add(filename);
            return 'FILE_ERROR: Discordへのアップロードが失敗しました: ' + (error instanceof Error ? error.message : 'unknown').slice(0, 160);
        }
    });
    state.requests.set(filename, { hash: key, promise: upload });
    return upload;
};

export function isStaffFileOutputRequest(text: string): boolean {
    return /(?:ファイル|添付|ダウンロード|HTML|JSON|CSV|Markdown|マークダウン|\.md\b|\.txt\b|\.html?\b|\.json\b|\.csv\b|\.py\b|\.js\b|README|ソースコード|コード).{0,25}(?:作|生成|出力|保存|送|添付|書いて|ください|ほしい)|(?:作|生成|出力|保存|送|添付|書いて).{0,25}(?:ファイル|HTML|JSON|CSV|Markdown|マークダウン|コード|README|\.md\b|\.txt\b|\.html?\b|\.py\b)/i.test(text);
}
