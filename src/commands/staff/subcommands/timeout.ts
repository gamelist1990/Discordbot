import { ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { SlashCommandSubcommandBuilder, SlashCommandUserOption, SlashCommandStringOption } from 'discord.js';

export default {
    name: 'timeout',
    description: 'ユーザーをタイムアウトまたは解除します',

    builder: (subcommand: SlashCommandSubcommandBuilder) => {
        const targetOption = new SlashCommandUserOption()
            .setName('target')
            .setDescription('対象のユーザー')
            .setRequired(true);

        const durationOption = new SlashCommandStringOption()
            .setName('duration')
            .setDescription('時間（例: 1s, 5m, 2h, 1d, 1h30m）または "clear" で解除')
            .setRequired(false);

        const reasonOption = new SlashCommandStringOption()
            .setName('reason')
            .setDescription('理由（任意）')
            .setRequired(false);

        return subcommand
            .setName('timeout')
            .setDescription('ユーザーをタイムアウト/解除します')
            .addUserOption(targetOption)
            .addStringOption(durationOption)
            .addStringOption(reasonOption);
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: '❌ このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
            return;
        }

        // 権限チェック: 実行者
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            await interaction.reply({ content: '❌ このコマンドを実行する権限がありません（Moderate Members）。', ephemeral: true });
            return;
        }

        // Bot の権限チェック
        const me = interaction.guild.members.me;
        if (!me || !me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            await interaction.reply({ content: '❌ ボットに必要な権限がありません（Moderate Members）。', ephemeral: true });
            return;
        }

        const user = interaction.options.getUser('target', true);
        const durationStr = interaction.options.getString('duration', false);
        const reason = interaction.options.getString('reason', false) || `Command by ${interaction.user.tag}`;

        await interaction.deferReply({ ephemeral: true });

        try {
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!member) {
                await interaction.editReply({ content: '❌ 指定されたユーザーはサーバーに存在しません。' });
                return;
            }

            // 操作可能チェック
            if (!member.manageable) {
                await interaction.editReply({ content: '❌ このユーザーに対して操作できません。ロール階層や権限を確認してください。' });
                return;
            }
            if (!member.moderatable) {
                await interaction.editReply({ content: '❌ このユーザーのタイムアウトを操作できません。ボットの権限を確認してください。' });
                return;
            }
            if (member.id === interaction.user.id) {
                await interaction.editReply({ content: '❌ 自分自身をタイムアウトすることはできません。' });
                return;
            }
            if (member.id === interaction.guild.ownerId) {
                await interaction.editReply({ content: '❌ サーバー所有者をタイムアウトすることはできません。' });
                return;
            }
            if (member.permissions?.has(PermissionFlagsBits.Administrator)) {
                await interaction.editReply({ content: '❌ 管理者権限を持つユーザーをタイムアウトすることはできません。' });
                return;
            }

            // clear または 未指定 -> 解除
            if (!durationStr || durationStr.toLowerCase() === 'clear') {
                // timeout を解除
                // discord.js v14: member.timeout(null) で解除
                try {
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
                await interaction.reply({ content: `❌ コマンド実行中にエラーが発生しました: ${err instanceof Error ? err.message : '不明なエラー'}`, ephemeral: true });
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

    if (isNaN(value) || value <= 0) return null;

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

