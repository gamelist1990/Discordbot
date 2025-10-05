import { PermissionLevel, DynamicCommandOptions } from '../../types/enhanced-command.js';
import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

const command: DynamicCommandOptions = {
    name: 'ping',
    description: 'Bot の応答速度を確認します',
    permissionLevel: PermissionLevel.ANY,
    
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const sent = await interaction.reply({ content: '計測中...', fetchReply: true });
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

export default command;
