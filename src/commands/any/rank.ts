import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { SlashCommand } from '../../types/command.js';
import { PermissionLevel } from '../../web/types/permission.js';
import { rankManager } from '../../core/RankManager.js';

/**
 * /rank コマンド
 * ユーザーの現在のXP、ランク、進捗を表示します
 */
const rankCommand: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('あなたのランク情報を表示します')
        .setDMPermission(false)
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('ランク情報を表示するユーザー（省略時は自分）')
                .setRequired(false)
        ) as SlashCommandBuilder,
    permissionLevel: PermissionLevel.ANY,
    
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ 
                content: 'このコマンドはサーバー内でのみ使用できます。', 
                flags: MessageFlags.Ephemeral 
            });
            return;
        }

        await interaction.deferReply();

        try {
            const targetUser = interaction.options.getUser('user') ?? interaction.user;
            const guildId = interaction.guild.id;

            // ランキングデータを取得
            const data = await rankManager.getRankingData(guildId);
            const userData = data.users[targetUser.id];

            if (!userData || userData.xp === 0) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('📊 ランク情報')
                    .setDescription(`${targetUser.tag} はまだランキングに登録されていません。`)
                    .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
                    .setFooter({ text: 'メッセージを送信するかVCに参加してXPを獲得しよう！' });

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            // 現在のランクを取得
            const currentRank = rankManager.getUserRank(data, userData.xp);
            const nextRank = rankManager.getNextRank(data, userData.xp);

            // 総ユーザー数とランキング順位を計算
            const allUsers = Object.entries(data.users)
                .sort(([, a], [, b]) => b.xp - a.xp);
            const userRanking = allUsers.findIndex(([id]) => id === targetUser.id) + 1;

            // 次のランクまでの必要XP
            const xpToNext = nextRank ? nextRank.minXp - userData.xp : 0;
            const progress = nextRank 
                ? Math.round((userData.xp / nextRank.minXp) * 100)
                : 100;

            // 進捗バーを作成（より見やすい文字を使用）
            const progressBarLength = 20;
            const filledLength = Math.round((progress / 100) * progressBarLength);
            const emptyLength = progressBarLength - filledLength;
            const progressBar = '█'.repeat(filledLength) + '□'.repeat(emptyLength);

            const embed = new EmbedBuilder()
                .setColor((currentRank?.color as any) || '#4A90E2')
                .setTitle(`📊 ${targetUser.tag} のランク情報`)
                .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
                .addFields(
                    { 
                        name: '🏅 現在のランク', 
                        value: currentRank?.name || '未定', 
                        inline: true 
                    },
                    { 
                        name: '✨ 現在のXP', 
                        value: `${userData.xp.toLocaleString()} XP`, 
                        inline: true 
                    },
                    { 
                        name: '📈 サーバー順位', 
                        value: `${userRanking} / ${allUsers.length}`, 
                        inline: true 
                    }
                );

            if (nextRank && xpToNext > 0) {
                embed.addFields({
                    name: `🎯 次のランク: ${nextRank.name}`,
                    value: `${progressBar} ${progress}%\n次のランクまで **${xpToNext.toLocaleString()}** XP 必要`,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: '🎉 最高ランク達成！',
                    value: 'おめでとうございます！最高ランクに到達しました。',
                    inline: false
                });
            }

            // 日次XP情報（上限がある場合のみ表示）
            if (data.settings.xpRates.dailyXpCap > 0) {
                const dailyXp = userData.dailyXp || 0;
                const remainingDaily = Math.max(0, data.settings.xpRates.dailyXpCap - dailyXp);
                embed.addFields({
                    name: '📅 本日の獲得XP',
                    value: `${dailyXp.toLocaleString()} / ${data.settings.xpRates.dailyXpCap.toLocaleString()} XP\n残り: ${remainingDaily.toLocaleString()} XP`,
                    inline: false
                });
            }

            embed.setFooter({ text: 'メッセージ送信とVC参加でXPを獲得できます' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in rank command:', error);
            
            const errorMessage = error instanceof Error ? error.message : '不明なエラー';
            await interaction.editReply({
                content: `❌ ランク情報の取得中にエラーが発生しました: ${errorMessage}`
            });
        }
    }
};

export default rankCommand;
