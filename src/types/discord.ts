import { 
    ChatInputCommandInteraction, 
    SlashCommandBuilder,
    Client,
    Guild,
    GuildMember,
    User,
    Role,
    Collection,
    Message,
    ButtonInteraction,
    SelectMenuInteraction,
    ModalSubmitInteraction,
    AutocompleteInteraction
} from 'discord.js';
import type { EventManager } from '../core/EventManager.js';
import type { SettingsServer } from '../web/SettingsServer.js';

/**
 * Discord.js の型定義を再エクスポート
 */
export type {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    Client,
    Guild,
    GuildMember,
    User,
    Role,
    Collection,
    Message,
    ButtonInteraction,
    SelectMenuInteraction,
    ModalSubmitInteraction,
    AutocompleteInteraction
};

/**
 * Bot クライアントの拡張型
 */
export interface ExtendedClient extends Client {
    commands: Collection<string, any>;
    // optional runtime-injected references
    eventManager?: EventManager;
    settingsServer?: SettingsServer;
}

/**
 * ギルド設定の型定義
 */
export interface GuildSettings {
    guildId: string;
    adminRoles: string[];
    staffRoles: string[];
    plugins: Record<string, boolean>;
    prefix?: string;
    language?: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * データベースのキー・バリュー型
 */
export interface DatabaseEntry<T = any> {
    value: T;
    savedAt: string;
    savedBy?: string;
}

/**
 * サーバー情報の型
 */
export interface GuildInfo {
    id: string;
    name: string;
    memberCount: number;
    ownerId: string;
    createdAt: Date;
}

/**
 * コマンド実行コンテキスト
 */
export interface CommandContext {
    interaction: ChatInputCommandInteraction;
    guild: Guild | null;
    member: GuildMember | null;
    user: User;
    client: ExtendedClient;
}

/**
 * エラーレスポンスの型
 */
export interface ErrorResponse {
    success: false;
    error: string;
    code?: string;
    details?: Record<string, unknown>;
}

/**
 * 成功レスポンスの型
 */
export interface SuccessResponse<T = any> {
    success: true;
    data: T;
    message?: string;
}

/**
 * API レスポンスの型（Union 型）
 */
export type ApiResponse<T = any> = SuccessResponse<T> | ErrorResponse;

/**
 * 権限チェック結果
 */
export interface PermissionCheckResult {
    hasPermission: boolean;
    reason?: string;
    requiredLevel: string;
    userLevel: string;
}

/**
 * コマンド統計情報
 */
export interface CommandStats {
    commandName: string;
    executionCount: number;
    lastExecuted: string;
    averageExecutionTime: number;
    errorCount: number;
}

/**
 * プラグイン情報
 */
export interface PluginInfo {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    enabled: boolean;
    dependencies?: string[];
}

/**
 * 認証トークンの型
 */
export interface AuthToken {
    token: string;
    userId: string;
    guildId: string;
    expiresAt: number;
    permissions: string[];
}

/**
 * ユーザー情報の型
 */
export interface UserInfo {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | null;
    bot: boolean;
    createdAt: Date;
}

/**
 * ロール情報の型
 */
export interface RoleInfo {
    id: string;
    name: string;
    color: number;
    position: number;
    permissions: string;
    mentionable: boolean;
}

/**
 * コマンドオプションの値の型
 */
export type CommandOptionValue = string | number | boolean | User | GuildMember | Role | null;

/**
 * イベントハンドラーの型
 */
export type EventHandler<T = any> = (data: T) => Promise<void> | void;

/**
 * コマンドミドルウェアの型
 */
export type CommandMiddleware = (
    interaction: ChatInputCommandInteraction
) => Promise<boolean> | boolean;
