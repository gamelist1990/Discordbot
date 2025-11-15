import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { SlashCommand } from '../../types/command.js';
import { antiCheatManager } from '../../core/anticheat/AntiCheatManager.js';

/**
 * /check コマンド
 * 自分の信頼スコアと設定されている処罰ルールを確認できます（エフェメラル返信）
 */
const checkCommand: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('check')
        .setDescription('あなたの信頼スコアと今後の処罰ルールを表示します')
        .setDMPermission(false) as SlashCommandBuilder,
    permissionLevel: 0,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
            return;
        }

        const guildId = interaction.guild.id;
        const userId = interaction.user.id;

        try {
            const trust = await antiCheatManager.getUserTrust(guildId, userId);
            const settings = await antiCheatManager.getSettings(guildId);

            const currentScore = trust?.score ?? 0;
            const lastUpdated = trust?.lastUpdated ? `<t:${Math.floor(new Date(trust.lastUpdated).getTime() / 1000)}:F>` : '不明';

            // Prepare punishment summary
            const punishments = settings.punishments || [];
            const sorted = punishments.slice().sort((a, b) => a.threshold - b.threshold);

            let nextPunishmentText = '設定されていません';
            for (const p of sorted) {
                if (p.threshold > currentScore) {
                    const remaining = p.threshold - currentScore;
                    const actionDesc = p.actions.map(a => a.type + (a.durationSeconds ? ` (${a.durationSeconds}s)` : '')).join(', ');
                    nextPunishmentText = `しきい値 ${p.threshold} （あと ${remaining} ポイント） → ${actionDesc}`;
                    break;
                }
            }
            if (nextPunishmentText === '設定されていません' && sorted.length > 0) {
                // If all thresholds are at or below current score, show highest
                const top = sorted[sorted.length - 1];
                nextPunishmentText = `既にしきい値 ${top.threshold} に到達しています → ${top.actions.map(a => a.type).join(', ')}`;
            }

            const punishList = sorted.length > 0
                ? sorted.map(p => `しきい値 ${p.threshold}: ${p.actions.map(a => a.type + (a.durationSeconds ? ` (${a.durationSeconds}s)` : '')).join(', ')}`).join('\n')
                : 'なし';

            const embed = new EmbedBuilder()
                .setTitle('🛡️ AntiCheat — 信頼スコア確認')
                .setColor('#ffcc00')
                .addFields(
                    { name: '👤 ユーザー', value: `${interaction.user.tag} (<@${userId}>)`, inline: false },
                    { name: '📊 現在の信頼スコア', value: `${currentScore}`, inline: true },
                    { name: '最終更新', value: `${lastUpdated}`, inline: true },
                    { name: '⚠️ 次の処罰', value: nextPunishmentText, inline: false },
                    { name: '📜 処罰一覧', value: punishList, inline: false }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('Error in /check command:', error);
            await interaction.reply({ content: '信頼スコアの取得中にエラーが発生しました。', ephemeral: true });
        }
    }
};

export default checkCommand;
