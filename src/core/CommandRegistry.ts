import { SlashCommandBuilder, ChatInputCommandInteraction, Collection } from 'discord.js';
import { BotClient } from './BotClient.js';
import {
    DynamicCommandOptions,
    EnhancedSlashCommand
} from '../types/enhanced-command.js';
import { SlashCommand } from '../types/command.js';
import { database } from './Database.js';
import { Logger } from '../utils/Logger.js';
import { PermissionLevel } from '../web/types/permission.js';

/**
 * コマンドレジストリ
 * Builder パターンで動的にコマンドを登録
 */
export class CommandRegistry {
    private static instance: CommandRegistry | null = null;
    private botClient: BotClient;

    constructor(botClient: BotClient) {
        this.botClient = botClient;
        CommandRegistry.instance = this;
    }

    /**
     * シングルトンインスタンスを取得
     */
    static getInstance(): CommandRegistry {
        if (!CommandRegistry.instance) {
            throw new Error('CommandRegistry is not initialized');
        }
        return CommandRegistry.instance;
    }

    /**
     * 登録されているコマンド一覧を取得
     */
    getCommands(): Collection<string, SlashCommand> {
        return this.botClient.getCommands();
    }

    /**
     * 動的にコマンドを登録
     * @param options コマンドオプション
     * 
     * @example
     * Core.registerCommand({
     *   name: 'hello',
     *   description: '挨拶します',
     *   permissionLevel: PermissionLevel.ANY,
     *   builder: (eb) => eb.addStringOption(opt => 
     *     opt.setName('name').setDescription('名前').setRequired(true)
     *   ),
     *   execute: async (interaction) => {
     *     const name = interaction.options.getString('name', true);
     *     await interaction.reply(`こんにちは、${name}さん！`);
     *   }
     * });
     */
    registerCommand(options: DynamicCommandOptions): void {
        try {
            // SlashCommandBuilder を作成
            let builder: SlashCommandBuilder | import('discord.js').SlashCommandOptionsOnlyBuilder = new SlashCommandBuilder()
                .setName(options.name)
                .setDescription(options.description);

            // カスタムビルダーが指定されている場合は実行
            if (options.builder) {
                builder = options.builder(builder as SlashCommandBuilder);
            }

            // ギルド専用の場合は設定
            if (options.guildOnly) {
                builder.setDMPermission(false);
            }

            // 拡張コマンドオブジェクトを作成
            const command: EnhancedSlashCommand = {
                data: builder as SlashCommandBuilder,
                execute: options.execute,
                permissionLevel: options.permissionLevel || PermissionLevel.ANY,
                cooldown: options.cooldown,
                guildOnly: options.guildOnly,
            };

            // BotClient に登録
            this.botClient.commands.set(options.name, command as any);
            Logger.success(`✅ コマンド登録: /${options.name} (権限: ${command.permissionLevel})`);
        } catch (error) {
            Logger.error(`❌ コマンド登録エラー [${options.name}]:`, error);
            throw error;
        }
    }

    /**
     * 複数のコマンドを一括登録
     */
    registerCommands(commandsArray: DynamicCommandOptions[]): void {
        for (const options of commandsArray) {
            this.registerCommand(options);
        }
    }

    /**
     * ユーザーの権限レベルをチェック
     */
    async checkPermission(
        interaction: ChatInputCommandInteraction, 
        requiredLevel: PermissionLevel
    ): Promise<boolean> {
        // ANY は誰でも実行可能
        if (requiredLevel === PermissionLevel.ANY) {
            return true;
        }

        // ギルド外では ANY のみ実行可能
        if (!interaction.guild) {
            return false;
        }

        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const member = interaction.guild.members.cache.get(userId);

        if (!member) return false;

        // OWNER レベル: サーバーオーナー
        if (requiredLevel === PermissionLevel.OWNER) {
            return interaction.guild.ownerId === userId;
        }

        // ギルド設定を取得
        const guildSettings = await database.get<any>(guildId, 'guild_settings', {
            adminRoleId: null,
            staffRoleId: null,
        });

        // ADMIN レベル: 管理者ロールまたは OWNER
        if (requiredLevel === PermissionLevel.ADMIN) {
            if (guildSettings.adminRoleId) {
                const hasAdminRole = member.roles.cache.has(guildSettings.adminRoleId);
                if (hasAdminRole) return true;
            }
            const isOwner = interaction.guild.ownerId === userId;
            return isOwner;
        }

        // STAFF レベル: スタッフロール、管理者ロール、または OWNER
        if (requiredLevel === PermissionLevel.STAFF) {
            if (guildSettings.staffRoleId) {
                const hasStaffRole = member.roles.cache.has(guildSettings.staffRoleId);
                if (hasStaffRole) return true;
            }
            if (guildSettings.adminRoleId) {
                const hasAdminRole = member.roles.cache.has(guildSettings.adminRoleId);
                if (hasAdminRole) return true;
            }
            const isOwner = interaction.guild.ownerId === userId;
            return isOwner;
        }

        return false;
    }

    /**
     * コマンドの数を取得
     */
    getCommandCount(): number {
        return this.botClient.commands.size;
    }
}
