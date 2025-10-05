import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { SlashCommand } from '../../types/command.js';

/**
 * /ping コマンド
 * Bot の応答速度を確認します
 */
const pingCommand: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Bot の応答速度を確認します'),
    
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.reply({ content: '計測中...' });
        const sent = await interaction.fetchReply();
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(interaction.client.ws.ping);

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🏓 Pong!')
            .addFields(
                { name: 'レイテンシ', value: `${latency}ms`, inline: true },
                { name: 'API レイテンシ', value: `${apiLatency}ms`, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });
    }
};

export default pingCommand;
