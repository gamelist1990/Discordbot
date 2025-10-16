import { ChatInputCommandInteraction, PermissionFlagsBits, MessageFlags, EmbedBuilder } from 'discord.js';

export default {
    name: 'timeout',
    description: 'ユーザーをタイムアウトまたは解除します',

    builder: (subcommand: any) => {
        return subcommand
            .setName('timeout')
            .setDescription('ユーザーをタイムアウト/解除します')
            .addUserOption((opt: any) =>
                opt.setName('target')
                    .setDescription('対象のユーザー')
                    .setRequired(true)
            )
            .addStringOption((opt: any) =>
                opt.setName('duration')
                    .setDescription('時間（例: 1s, 5m, 2h, 1d）または "clear" で解除')
                    .setRequired(false)
            )
            .addStringOption((opt: any) =>
                opt.setName('reason')
                    .setDescription('理由（任意）')
                    .setRequired(false)
            );
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: '❌ このコマンドはサーバー内でのみ使用できます。', flags: MessageFlags.Ephemeral });
            return;
        }

        // 権限チェック: 実行者
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            await interaction.reply({ content: '❌ このコマンドを実行する権限がありません（Moderate Members）。', flags: MessageFlags.Ephemeral });
            return;
        }

        // Bot の権限チェック
        const me = interaction.guild.members.me;
        if (!me || !me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            await interaction.reply({ content: '❌ ボットに必要な権限がありません（Moderate Members）。', flags: MessageFlags.Ephemeral });
            return;
        }

        const user = interaction.options.getUser('target', true);
        const durationStr = interaction.options.getString('duration', false);
        const reason = interaction.options.getString('reason', false) || `Command by ${interaction.user.tag}`;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!member) {
                await interaction.editReply({ content: '❌ 指定されたユーザーはサーバーに存在しません。' });
                return;
            }

            // clear または 未指定 -> 解除
            if (!durationStr || durationStr.toLowerCase() === 'clear') {
                // timeout を解除
                // discord.js v14: member.timeout(null) で解除
                try {
                    // @ts-ignore - 一部環境では型が厳密に合わない場合があるため安全に呼び出す
                    await member.timeout(null, reason);

                    const embed = new EmbedBuilder()
                        .setTitle('タイムアウトを解除しました')
                        .setDescription(`${user} のタイムアウトを解除しました。`)
                        .setColor(0x57F287)
                        .addFields([{ name: '対象', value: `${user.tag} (${user.id})`, inline: true }, { name: '実行者', value: `${interaction.user.tag}`, inline: true }]);

                    await interaction.editReply({ embeds: [embed] });
                } catch (err) {
                    console.error('Timeout clear error:', err);
                    await interaction.editReply({ content: '❌ タイムアウトの解除に失敗しました。権限や対象の状態を確認してください。' });
                }
                return;
            }

            // durationStr をパース
            const durationMs = parseDurationToMs(durationStr);
            if (durationMs === null) {
                await interaction.editReply({ content: '❌ duration の形式が不明です。例: 1s, 5m, 2h, 1d または "clear" を指定してください。' });
                return;
            }

            const maxMs = 28 * 24 * 60 * 60 * 1000; // Discord の最大 28 日
            if (durationMs > maxMs) {
                await interaction.editReply({ content: '❌ 指定した時間が長すぎます。最大は 28 日です。' });
                return;
            }

            try {
                // @ts-ignore
                await member.timeout(durationMs, reason);

                const embed = new EmbedBuilder()
                    .setTitle('ユーザーをタイムアウトしました')
                    .setColor(0xED4245)
                    .setDescription(`${user} を ${durationStr} 間タイムアウトしました。`)
                    .addFields([
                        { name: '対象', value: `${user.tag} (${user.id})`, inline: true },
                        { name: '時間', value: `${durationStr}`, inline: true },
                        { name: '実行者', value: `${interaction.user.tag}`, inline: true },
                        { name: '理由', value: `${reason}`, inline: false }
                    ]);

                await interaction.editReply({ embeds: [embed] });
            } catch (err) {
                console.error('Timeout set error:', err);
                await interaction.editReply({ content: '❌ タイムアウトの設定に失敗しました。権限や対象のロール階層を確認してください。' });
            }
        } catch (err) {
            console.error('Staff timeout command error:', err);
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ content: `❌ コマンド実行中にエラーが発生しました: ${err instanceof Error ? err.message : '不明なエラー'}` });
            } else {
                await interaction.reply({ content: `❌ コマンド実行中にエラーが発生しました: ${err instanceof Error ? err.message : '不明なエラー'}`, flags: MessageFlags.Ephemeral });
            }
        }
    }
};

/**
 * 簡易的な時間文字列パーサ
 * サポート: 数値 + s|m|h|d
 * 例: 30s, 5m, 2h, 1d
 */
function parseDurationToMs(input: string): number | null {
    if (!input) return null;
    const trimmed = input.trim().toLowerCase();
    const match = /^([0-9]+)\s*(s|m|h|d)$/.exec(trimmed);
    if (!match) return null;

    const value = Number(match[1]);
    const unit = match[2];

    if (isNaN(value)) return null;

    switch (unit) {
        case 's':
            return value * 1000;
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        case 'd':
            return value * 24 * 60 * 60 * 1000;
        default:
            return null;
    }
}
