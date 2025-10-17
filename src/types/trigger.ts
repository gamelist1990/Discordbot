/**
 * トリガー機能の型定義
 */

/**
 * サポートされているDiscordイベントタイプ
 */
export type TriggerEventType =
    | 'guildMemberAdd'
    | 'guildMemberRemove'
    | 'messageCreate'
    | 'messageUpdate'
    | 'messageDelete'
    | 'interactionCreate'
    | 'messageReactionAdd'
    | 'messageReactionRemove'
    | 'voiceStateUpdate'
    | 'presenceUpdate'
    | 'guildMemberUpdate'
    | 'channelCreate'
    | 'channelDelete'
    | 'channelUpdate'
    | 'threadCreate'
    | 'threadDelete'
    | 'roleCreate'
    | 'roleDelete'
    | 'guildRoleUpdate'
    | 'webhookEvent'
    | 'customEvent';

/**
 * 条件のマッチタイプ
 */
export type ConditionMatchType =
    | 'exactly'
    | 'contains'
    | 'regex'
    | 'startsWith'
    | 'endsWith'
    | 'greaterThan'
    | 'lessThan';

/**
 * 条件のタイプ
 */
export type ConditionType =
    | 'messageContent'
    | 'authorId'
    | 'authorRole'
    | 'channelId'
    | 'hasAttachment'
    | 'mention'
    | 'regex'
    | 'presence'
    | 'voiceState'
    | 'custom';

/**
 * プリセットアクションのタイプ
 */
export type PresetActionType =
    | 'Embed'
    | 'Text'
    | 'Reply'
    | 'Webhook'
    | 'DM'
    | 'React';

/**
 * トリガー条件
 */
export interface TriggerCondition {
    id: string;
    type: ConditionType;
    matchType: ConditionMatchType;
    value: string;
    negate?: boolean; // 否定条件
    groupId?: string; // AND/ORグループ化用
}

/**
 * Embedフィールド
 */
export interface EmbedField {
    name: string;
    value: string;
    inline?: boolean;
}

/**
 * Embed設定
 */
export interface EmbedConfig {
    title?: string;
    description?: string;
    color?: string;
    fields?: EmbedField[];
    imageUrl?: string;
    thumbnailUrl?: string;
    footer?: {
        text: string;
        iconUrl?: string;
    };
    timestamp?: boolean;
}

/**
 * Modalフィールド
 */
export interface ModalField {
    id: string;
    label: string;
    type: 'short' | 'paragraph';
    required?: boolean;
    placeholder?: string;
    minLength?: number;
    maxLength?: number;
}

/**
 * Webhook設定
 */
export interface WebhookConfig {
    url?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    bodyTemplate?: string;
}

/**
 * トリガープリセット（アクション）
 */
export interface TriggerPreset {
    id: string;
    triggerId: string;
    index: number; // 実行順序
    enabled: boolean;
    type: PresetActionType;
    isPinned?: boolean; // ピン留めフラグ（ランダム実行モードで常に実行）
    
    // 共通設定
    template?: string; // テンプレート文字列
    targetChannelId?: string; // 送信先チャンネル
    cooldownSeconds?: number; // クールダウン（秒）
    removeAfterSeconds?: number; // 自動削除 (秒) - 0で無効: Text/Reply/Embed/DMメッセージやリアクションを自動削除
    
    // Embed専用
    embedConfig?: EmbedConfig;
    
    // Reply専用
    replyTemplate?: string;
    replyWithMention?: boolean;
    
    // Webhook専用
    webhookConfig?: WebhookConfig;
    
    // DM専用
    dmTargetUserId?: string; // または {author} プレースホルダ
    
    // React専用
    reactEmoji?: string;
}

/**
 * トリガー本体
 */
export interface Trigger {
    id: string;
    guildId: string;
    name: string;
    description?: string;
    enabled: boolean;
    eventType: TriggerEventType;
    priority: number; // 実行優先度（小さいほど先）
    conditions: TriggerCondition[];
    presets: TriggerPreset[]; // 最大5つ
    createdBy: string; // ユーザーID
    createdAt: string; // ISO 8601
    updatedAt: string; // ISO 8601
    // optional: condition combination logic between groups
    conditionLogic?: 'AND' | 'OR';
    // optional: how presets should run
    // all: すべてのプリセットを実行
    // random: ランダムに1つのプリセットを実行
    // single: 指定したプリセットを1つだけ実行
    // pinned-random: ピン留めプリセット + 選択外からランダムN個を実行
    runMode?: 'all' | 'random' | 'single' | 'pinned-random';
    randomCount?: number; // pinned-random モード時のランダム選択数（デフォルト: 1）
}

/**
 * トリガー発火イベント（WebSocket送信用）
 */
export interface TriggerFiredEvent {
    triggerId: string;
    presetId: string;
    guildId: string;
    eventType: TriggerEventType;
    summary: string; // 簡易説明
    renderedOutput?: string; // レンダリング済み出力
    timestamp: string; // ISO 8601
    success: boolean;
    error?: string;
}

/**
 * プレースホルダコンテキスト
 */
export interface PlaceholderContext {
    // 基本
    user?: {
        id: string;
        name: string;
        tag: string;
        createdAt: string;
        avatar?: string;
        isBot?: boolean;
        locale?: string;
    };
    guild?: {
        id: string;
        name: string;
        memberCount: number;
        icon?: string;
    };
    channel?: {
        id: string;
        name: string;
        topic?: string;
    };
    message?: {
        id: string;
        content: string;
        length: number;
        words: number;
    };
    
    // 追加コンテキスト
    attachments?: {
        count: number;
    };
    mention?: string;
    time?: string;
    
    // 権限・ロール
    author?: {
        id: string;
        name: string;
        displayName?: string;
        tag: string;
        mention: string;
        roles?: string[];
        isBot?: boolean;
        locale?: string;
    };
    
    // ボイス・プレゼンス
    voice?: {
        channelId?: string;
        channelName?: string;
    };
    presence?: {
        status?: string;
    };
    
    // ランダム・ユーティリティ
    random?: {
        int?: (min: number, max: number) => number;
        uuid?: string;
    };
    date?: {
        now?: string;
    };
    
    // 環境変数（管理者のみ）
    env?: Record<string, string>;
    
    // スクリプト連携
    script?: Record<string, any>;
}

/**
 * トリガー実行コンテキスト
 */
export interface TriggerExecutionContext {
    trigger: Trigger;
    eventType: TriggerEventType;
    eventData: any; // Discord.jsのイベントデータ
    placeholders: PlaceholderContext;
}
