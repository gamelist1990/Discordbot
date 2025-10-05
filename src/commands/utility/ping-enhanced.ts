import { PermissionLevel, DynamicCommandOptions, CommandBuilderCallback } from '../../types/enhanced-command.js';
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

const command: DynamicCommandOptions = {
    name: 'ping',
    description: 'Bot の応答速度を確認します',
    permissionLevel: PermissionLevel.ANY,
    
    builder: ((eb: SlashCommandBuilder) => {
        return eb.addBooleanOption(option =>
            option
                .setName('detailed')
                .setDescription('詳細情報を表示')
                .setRequired(false)
        );
    }) as CommandBuilderCallback,
    
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const detailed = interaction.options.getBoolean('detailed') ?? false;
        const sent = await interaction.reply({ content: '計測中...', fetchReply: true });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(interaction.client.ws.ping);

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🏓 Pong!')
            .addFields(
                { name: 'レイテンシ', value: `${latency}ms`, inline: true },
                { name: 'API レイテンシ', value: `${apiLatency}ms`, inline: true }
            );

        if (detailed) {
            const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            const uptime = Math.floor(process.uptime() / 60);
            
            embed.addFields(
                { name: 'メモリ使用量', value: `${memoryUsage} MB`, inline: true },
                { name: '稼働時間', value: `${uptime} 分`, inline: true }
            );
        }

        embed.setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });
    }
};

export default command;
