import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { PrivateChatManager } from '../../../core/PrivateChatManager';

/**
 * /staff stats サブコマンド（動的ロードの例）
 * プライベートチャットの統計情報を表示
 */
export default {
    name: 'stats',
    description: 'プライベートチャットの統計情報を表示',
    
    // サブコマンドビルダー（オプション）
    builder: (subcommand: any) => {
        return subcommand
            .setName('stats')
            .setDescription('プライベートチャットの統計情報を表示');
    },
    
    // 実行関数
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ このコマンドはサーバー内でのみ使用できます。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const stats = await PrivateChatManager.getStats(interaction.guild.id);
            const chats = await PrivateChatManager.getChatsByGuild(interaction.guild.id);

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('📊 プライベートチャット統計')
                .setDescription(`サーバー: ${interaction.guild.name}`)
                .addFields(
                    { 
                        name: '📈 合計チャット数', 
                        value: `${stats.total} 件`, 
                        inline: true 
                    },
                    { 
                        name: '📅 今日', 
                        value: `${stats.today} 件`, 
                        inline: true 
                    },
                    { 
                        name: '📅 今週', 
                        value: `${stats.thisWeek} 件`, 
                        inline: true 
                    },
                    { 
                        name: '📅 今月', 
                        value: `${stats.thisMonth} 件`, 
                        inline: true 
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'プライベートチャット管理システム' });

            // アクティブなチャットの内訳
            if (chats.length > 0) {
                const staffCounts = new Map<string, number>();
                chats.forEach(chat => {
                    staffCounts.set(chat.staffId, (staffCounts.get(chat.staffId) || 0) + 1);
                });

                const topStaff = Array.from(staffCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([staffId, count]) => `<@${staffId}>: ${count}件`)
                    .join('\n');

                if (topStaff) {
                    embed.addFields({
                        name: '👥 スタッフ別チャット数（上位5名）',
                        value: topStaff,
                        inline: false
                    });
                }
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Stats command error:', error);
            await interaction.editReply({
                content: '❌ 統計情報の取得中にエラーが発生しました。'
            });
        }
    }
};
