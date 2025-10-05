import { 
    Message, 
    Client, 
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    SlashCommandSubcommandsOnlyBuilder
} from 'discord.js';
import { PermissionLevel } from './enhanced-command.js';

/**
 * レガシーメッセージコマンドの型定義（後方互換性のため残す）
 */
export interface Command {
    name: string;
    description: string;
    aliases?: string[];
    usage?: string;
    admin?: boolean;
    execute: (client: Client, message: Message, args: string[]) => Promise<void> | void;
}

/**
 * スラッシュコマンドの型定義
 */
export interface SlashCommand {
    data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
    cooldown?: number; // クールダウン時間（秒）
    permissions?: bigint[]; // 必要な権限
    guildOnly?: boolean; // ギルド専用コマンドか
    permissionLevel?: PermissionLevel; // 権限レベル（動的登録コマンド用）
}
