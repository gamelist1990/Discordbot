import { 
    ChatInputCommandInteraction, 
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder 
} from 'discord.js';

/**
 * 権限レベル
 */
export enum PermissionLevel {
    ANY = 'any',           // 誰でも実行可能
    STAFF = 'staff',       // スタッフロール（サーバー設定で指定）
    ADMIN = 'admin',       // 管理者ロール（サーバー設定で指定）
    OP = 'op',             // サーバー管理者権限を持つユーザー
}

/**
 * コマンドビルダーのコールバック型
 * SlashCommandBuilder または SlashCommandOptionsOnlyBuilder を返す
 */
export type CommandBuilderCallback = (
    builder: SlashCommandBuilder
) => SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;

/**
 * コマンド実行コールバック型（厳密な型定義）
 */
export type CommandExecuteCallback = (interaction: ChatInputCommandInteraction) => Promise<void>;

/**
 * 動的登録用のコマンドオプション
 */
export interface DynamicCommandOptions {
    name: string;
    description: string;
    permissionLevel?: PermissionLevel;
    cooldown?: number;
    guildOnly?: boolean;
    builder?: CommandBuilderCallback;
    execute: CommandExecuteCallback;
}

/**
 * 拡張されたスラッシュコマンドインターフェース
 */
export interface EnhancedSlashCommand {
    data: SlashCommandBuilder;
    execute: CommandExecuteCallback;
    permissionLevel: PermissionLevel;
    cooldown?: number;
    guildOnly?: boolean;
    category?: string;
}
