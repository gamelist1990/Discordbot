import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    PermissionFlagsBits 
} from 'discord.js';
import { SlashCommand } from '../../types/command.js';
import { handleHelpSubcommand } from './help.js';
import { handlePrivateChatSubcommand } from './privatechat.js';

/**
 * /staff コマンド
 * スタッフ向けの管理機能を提供する拡張可能なモジュール構造のコマンド
 */
const staffCommand: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('staff')
        .setDescription('スタッフ向けの管理機能')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('help')
                .setDescription('スタッフコマンドのヘルプを表示')
                .addIntegerOption(option =>
                    option
                        .setName('page')
                        .setDescription('表示するページ番号')
                        .setRequired(false)
                        .setMinValue(1)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('privatechat')
                .setDescription('プライベートチャット機能を管理')
                .addStringOption(option =>
                    option
                        .setName('action')
                        .setDescription('実行するアクション')
                        .setRequired(true)
                        .addChoices(
                            { name: '作成 (Create)', value: 'create' },
                            { name: '一覧表示 (List)', value: 'list' },
                            { name: '削除 (Delete)', value: 'delete' },
                            { name: 'Web UI管理 (Manage)', value: 'manage' }
                        )
                )
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('対象ユーザー（作成・削除時に必要）')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('chat_id')
                        .setDescription('チャットID（削除時に必要）')
                        .setRequired(false)
                )
        ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'help':
                    await handleHelpSubcommand(interaction);
                    break;
                case 'privatechat':
                    await handlePrivateChatSubcommand(interaction);
                    break;
                default:
                    await interaction.reply({
                        content: `❌ 不明なサブコマンド: ${subcommand}`,
                        ephemeral: true
                    });
            }
        } catch (error) {
            console.error(`Staff command error (${subcommand}):`, error);
            
            const errorMessage = error instanceof Error ? error.message : '不明なエラー';
            const replyOptions = {
                content: `❌ コマンドの実行中にエラーが発生しました: ${errorMessage}`,
                ephemeral: true
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.editReply(replyOptions);
            } else {
                await interaction.reply(replyOptions);
            }
        }
    }
};

export default staffCommand;
