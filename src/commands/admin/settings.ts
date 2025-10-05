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

            // SettingsServer インスタンスを取得
            const settingsServer = (interaction.client as any).settingsServer;

            if (!settingsServer) {
                await interaction.reply({
                    content: '❌ 設定サーバーが起動していません。',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            // セッションを作成
            const token = settingsServer.createSession(interaction.guildId, interaction.user.id);
            const settingsUrl = `http://localhost:3000/settings/${token}`;

            await interaction.reply({
                content: `🔧 **サーバー設定URL**\n\n` +
                         `以下のURLから設定画面にアクセスできます：\n` +
                         `${settingsUrl}\n\n` +
                         `⚠️ このURLは30分間有効です。\n` +
                         `⚠️ このURLは他の人と共有しないでください。`,
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
