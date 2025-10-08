import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { SlashCommand } from '../../types/command.js';

/**
 * /settings コマンド
 * サーバー設定用の一時URLを生成します（OP権限保持者のみ）
 */
const settingsCommand: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('サーバー設定用の一時URLを生成します')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),
    
    async execute(interaction: ChatInputCommandInteraction) {
        try {
            // ギルドコマンドでない場合は拒否
            if (!interaction.guildId) {
                await interaction.reply({
                    content: '❌ このコマンドはサーバー内でのみ使用できます。',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            // 管理者権限チェック
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                await interaction.reply({
                    content: '❌ このコマンドを実行するには管理者権限が必要です。',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            // Webの/settingsページURLを返す
            const settingsUrl = `http://localhost:3000/settings`;
            await interaction.reply({
                content: `🔧 **サーバー設定画面**\n\n` +
                         `以下のURLから管理サーバー一覧・設定画面にアクセスできます：\n` +
                         `${settingsUrl}\n\n` +
                         `※このURLは常時有効です。Discordアカウントで認証後、管理権限のあるサーバーのみ設定できます。`,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            console.error('設定コマンドエラー:', error);
            await interaction.reply({
                content: '❌ 設定URLの生成中にエラーが発生しました。',
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};

export default settingsCommand;
