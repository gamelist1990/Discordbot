import { AttachmentBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { OpenAITool, ToolHandler } from '../../../../types/openai.js';
import { CHAT_AI_TEXT_FILE_MAX_BYTES, normalizeChatAITextFilename } from '../../../../core/ChatAIChannel/tools/textFilePolicy.js';

export const staffOutputFileDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'output_file',
        description: '/staff aiからDiscordへテキストファイルを直接出力・添付します。HTML/MD/JSON/CSV/Python/ソースコードなどをfilenameとUTF-8 contentの1回の呼び出しで作成し、実際の添付URLを返します。成功確認前に送信済みと説明しないでください。',
        parameters: {
            type: 'object',
            properties: {
                filename: { type: 'string', description: '例: index.html, report.md, example.py, data.json。拡張子必須。' },
                content: { type: 'string', description: 'ファイル全体のUTF-8テキスト。実際にファイルとして出力する内容。' },
            },
            required: ['filename', 'content'],
        },
    },
};

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
    try {
        // Use the existing deferred slash interaction, without saving the file to global disk.
        const reply = await interaction.followUp({
            content: filename + ' をファイルとして出力しました。',
            files: [new AttachmentBuilder(bytes, { name: filename })],
            allowedMentions: { parse: [] },
        });
        const attachment = reply.attachments?.find(entry => entry.name === filename);
        if (!attachment?.url) return 'FILE_ERROR: Discord送信後の添付URLを取得できません。送信状態を確認してください。';
        return 'FILE_UPLOADED: ' + JSON.stringify({ filename, bytes: bytes.length, url: attachment.url });
    } catch (error) {
        return 'FILE_ERROR: Discordへのアップロードが失敗しました: ' + (error instanceof Error ? error.message : 'unknown').slice(0, 160);
    }
};

export function isStaffFileOutputRequest(text: string): boolean {
    return /(?:ファイル|添付|ダウンロード|HTML|JSON|CSV|Markdown|マークダウン|\.md\b|\.txt\b|\.html?\b|\.json\b|\.csv\b|\.py\b|\.js\b|README|ソースコード|コード).{0,25}(?:作|生成|出力|保存|送|添付|書いて|ください|ほしい)|(?:作|生成|出力|保存|送|添付|書いて).{0,25}(?:ファイル|HTML|JSON|CSV|Markdown|マークダウン|コード|README|\.md\b|\.txt\b|\.html?\b|\.py\b)/i.test(text);
}
