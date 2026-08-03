import {
    ApplicationCommandType,
    AttachmentBuilder,
    ContextMenuCommandBuilder,
    MessageContextMenuCommandInteraction,
    MessageFlags,
} from 'discord.js';
import { renderQuoteCard } from '../../core/media/QuoteCardRenderer.js';
import { SlashCommand } from '../../types/command.js';

const quoteCardCommand: SlashCommand = {
    data: new ContextMenuCommandBuilder()
        .setName('名言画像にする')
        .setType(ApplicationCommandType.Message),

    async execute(baseInteraction): Promise<void> {
        if (!baseInteraction.isMessageContextMenuCommand()) return;

        const interaction = baseInteraction as MessageContextMenuCommandInteraction;
        const message = interaction.targetMessage;
        const quote = message.content.trim();

        if (!quote) {
            await interaction.reply({
                content: '❌ テキストが含まれているメッセージを選択してください。',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply();

        try {
            const author = message.author;
            const member = message.member;
            const authorName = member?.displayName ?? author.displayName ?? author.username;

            const image = renderQuoteCard({
                quote,
                authorName,
                authorHandle: author.username,
                style: 'random',
                seed: message.id,
            });

            const attachment = new AttachmentBuilder(image, {
                name: `quote-${message.id}.png`,
                description: `${authorName} のメッセージを装飾した名言画像`,
            });

            await interaction.editReply({
                files: [attachment],
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            await interaction.editReply(
                `❌ 名言画像の生成に失敗しました: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    },
};

export default quoteCardCommand;