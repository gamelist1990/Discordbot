import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
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
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🌐 Web インターフェース')
            .setDescription('以下のリンクから Web インターフェースにアクセスできます：')
            .addFields(
                { name: 'ホームページ', value: `[${config.BASE_URL}](${config.BASE_URL})`, inline: false }
            )
            .setFooter({ text: 'Discord Bot Web Interface' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};

export default webCommand;