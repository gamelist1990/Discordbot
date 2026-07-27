import {
    ApplicationCommandType,
    ContextMenuCommandBuilder,
    MessageContextMenuCommandInteraction,
    MessageFlags,
} from 'discord.js';
import { SlashCommand } from '../../types/command.js';
import { downloadXMedia, extractXStatusUrl } from '../../core/media/XMediaDownloader.js';

const xMediaCommand: SlashCommand = {
    data: new ContextMenuCommandBuilder()
        .setName('Xのメディアを取得')
        .setType(ApplicationCommandType.Message),

    async execute(baseInteraction): Promise<void> {
        if (!baseInteraction.isMessageContextMenuCommand()) return;
        const interaction = baseInteraction as MessageContextMenuCommandInteraction;
        const sourceUrl = extractXStatusUrl(interaction.targetMessage.content);

        if (!sourceUrl) {
            await interaction.reply({
                content: '選択したメッセージにX（Twitter）の投稿リンクがありません。',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply('投稿の画像・動画を取得しています…');

       
        const attachmentLimit = (interaction as MessageContextMenuCommandInteraction & {
            attachmentSizeLimit?: number;
        }).attachmentSizeLimit ?? 10 * 1024 * 1024;
        const result = await downloadXMedia(sourceUrl, attachmentLimit);
        try {
            await interaction.editReply({
                content: 'メディアを取得しました。',
                files: result.files,
            });
        } finally {
            await result.cleanup();
        }
    },
};

export default xMediaCommand;
