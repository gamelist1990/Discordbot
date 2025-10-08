import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder
} from 'discord.js';
import { PermissionLevel } from '../web/types/permission';

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
