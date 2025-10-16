import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { SlashCommand } from '../../types/command.js';
import { PermissionLevel } from '../../web/types/permission.js';
import { config } from '../../config.js';

/**
 * /web コマンド
 * Web インターフェースのホームページ URL を提供します
 */
const webCommand: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('web')
        .setDescription('Web インターフェースのホームページ URL を提供します'),
    permissionLevel: PermissionLevel.ANY,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const button = new ButtonBuilder()
            .setLabel('🌐 Webインターフェースにアクセス')
            .setStyle(ButtonStyle.Link)
            .setURL(config.BASE_URL);

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(button);

        await interaction.reply({ 
            content: '以下のボタンからWebインターフェースにアクセスできます：',
            components: [row],
            flags: MessageFlags.Ephemeral 
        });
    }
};

export default webCommand;