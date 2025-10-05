/**
 * イベントシステム型定義
 * Discord標準イベントとカスタムイベントの両方に対応
 */

import type { 
    Message, 
    ChatInputCommandInteraction, 
    Client,
    Guild,
    GuildMember,
    User,
    Channel,
    Role,
    Interaction,
    VoiceState,
    MessageReaction,
    PartialMessageReaction,
    PartialUser,
} from 'discord.js';

/**
 * イベント列挙型
 */
export enum Event {
    // Discord標準イベント
    MESSAGE_CREATE = 'messageCreate',
    MESSAGE_DELETE = 'messageDelete',
    MESSAGE_UPDATE = 'messageUpdate',
    INTERACTION_CREATE = 'interactionCreate',
    GUILD_CREATE = 'guildCreate',
    GUILD_DELETE = 'guildDelete',
    GUILD_MEMBER_ADD = 'guildMemberAdd',
    GUILD_MEMBER_REMOVE = 'guildMemberRemove',
    CHANNEL_CREATE = 'channelCreate',
    CHANNEL_DELETE = 'channelDelete',
    ROLE_CREATE = 'roleCreate',
    ROLE_DELETE = 'roleDelete',
    VOICE_STATE_UPDATE = 'voiceStateUpdate',
    REACTION_ADD = 'messageReactionAdd',
    REACTION_REMOVE = 'messageReactionRemove',
    READY = 'ready',
    
    // カスタムイベント
    COMMAND_EXECUTE = 'commandExecute',
    COMMAND_ERROR = 'commandError',
    PERMISSION_DENIED = 'permissionDenied',
    COOLDOWN_HIT = 'cooldownHit',
    BOT_STATUS_CHANGE = 'botStatusChange',
    GUILD_SETTINGS_UPDATE = 'guildSettingsUpdate',
    DATABASE_UPDATE = 'databaseUpdate',
    PLUGIN_LOAD = 'pluginLoad',
    PLUGIN_UNLOAD = 'pluginUnload',
}

/**
 * 各イベントのペイロード型マッピング
 */
export interface EventPayloads {
    // Discord標準イベント
    [Event.MESSAGE_CREATE]: Message;
    [Event.MESSAGE_DELETE]: Message;
    [Event.MESSAGE_UPDATE]: { oldMessage: Message; newMessage: Message };
    [Event.INTERACTION_CREATE]: Interaction;
    [Event.GUILD_CREATE]: Guild;
    [Event.GUILD_DELETE]: Guild;
    [Event.GUILD_MEMBER_ADD]: GuildMember;
    [Event.GUILD_MEMBER_REMOVE]: GuildMember;
    [Event.CHANNEL_CREATE]: Channel;
    [Event.CHANNEL_DELETE]: Channel;
    [Event.ROLE_CREATE]: Role;
    [Event.ROLE_DELETE]: Role;
    [Event.VOICE_STATE_UPDATE]: { oldState: VoiceState; newState: VoiceState };
    [Event.REACTION_ADD]: { reaction: MessageReaction | PartialMessageReaction; user: User | PartialUser };
    [Event.REACTION_REMOVE]: { reaction: MessageReaction | PartialMessageReaction; user: User | PartialUser };
    [Event.READY]: Client;
    
    // カスタムイベント
    [Event.COMMAND_EXECUTE]: {
        commandName: string;
        user: User;
        guild?: Guild;
        interaction?: ChatInputCommandInteraction;
        message?: Message;
    };
    [Event.COMMAND_ERROR]: {
        commandName: string;
        error: Error;
        user: User;
        guild?: Guild;
    };
    [Event.PERMISSION_DENIED]: {
        commandName: string;
        user: User;
        guild: Guild;
        requiredPermission: string;
    };
    [Event.COOLDOWN_HIT]: {
        commandName: string;
        user: User;
        remainingTime: number;
    };
    [Event.BOT_STATUS_CHANGE]: {
        oldStatus: string;
        newStatus: string;
        timestamp: number;
    };
    [Event.GUILD_SETTINGS_UPDATE]: {
        guildId: string;
        settings: any;
        updatedBy?: User;
    };
    [Event.DATABASE_UPDATE]: {
        key: string;
        value: any;
        operation: 'set' | 'delete' | 'update';
    };
    [Event.PLUGIN_LOAD]: {
        pluginName: string;
        pluginPath: string;
    };
    [Event.PLUGIN_UNLOAD]: {
        pluginName: string;
        reason?: string;
    };
}

/**
 * イベントハンドラー型
 */
export type EventHandler<T extends Event> = (payload: EventPayloads[T]) => void | Promise<void>;

/**
 * イベントリスナー情報
 */
export interface EventListener<T extends Event = Event> {
    id: string;
    event: T;
    handler: EventHandler<T>;
    once?: boolean;
    priority?: number; // 優先度（数値が大きいほど先に実行）
}
