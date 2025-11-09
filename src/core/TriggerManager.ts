import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { Database } from './Database.js';
import { Logger } from '../utils/Logger.js';
import {
    Trigger,
    TriggerCondition,
    TriggerPreset,
    TriggerEventType,
    TriggerFiredEvent,
    TriggerExecutionContext,
    PlaceholderContext,
    ConditionMatchType,
} from '../types/trigger.js';
import axios from 'axios';

/**
 * TriggerManager
 * トリガー機能の中核を担うマネージャークラス
 * - 条件評価エンジン
 * - プリセット実行（Embed/Text/Reply/Modal/Webhook/DM/React）
 * - Cooldown管理
 * - WebSocket通知
 */
export class TriggerManager {
    private client: Client;
    private database: Database;
    private cooldowns: Map<string, number>; // presetId -> lastExecutedTimestamp
    private liveBuffer: TriggerFiredEvent[]; // インメモリバッファ（最大100件）
    private maxBufferSize: number = 100;
    private wsEmitter?: (event: string, data: any) => void;

    constructor(client: Client, database: Database) {
        this.client = client;
        this.database = database;
        this.cooldowns = new Map();
        this.liveBuffer = [];
    }

    /**
     * ギルドのトリガー保存キーを取得
     */
    private getTriggersKey(guildId: string): string {
        return `Guild/${guildId}/triggers`;
    }

    /**
     * WebSocketエミッターを設定
     */
    setWebSocketEmitter(emitter: (event: string, data: any) => void): void {
        this.wsEmitter = emitter;
    }

    /**
     * 全トリガーをギルドIDから取得
     */
    async getTriggersForGuild(guildId: string): Promise<Trigger[]> {
        const key = this.getTriggersKey(guildId);
        const data = await this.database.get<Trigger[]>(guildId, key, []);
        Logger.debug(`[getTriggersForGuild] guildId=${guildId}, key=${key}, triggers=${data?.length || 0}`);
        return data || [];
    }

    /**
     * トリガーをIDで取得
     */
    async getTriggerById(guildId: string, triggerId: string): Promise<Trigger | null> {
        const triggers = await this.getTriggersForGuild(guildId);
        return triggers.find((t) => t.id === triggerId) || null;
    }

    /**
     * トリガーを作成
     */
    async createTrigger(trigger: Trigger): Promise<Trigger> {
        Logger.info(`[createTrigger] 開始: guildId=${trigger.guildId}, name=${trigger.name}`);
        
        const key = this.getTriggersKey(trigger.guildId);
        Logger.info(`[createTrigger] 保存キー: ${key}`);
        
        const triggers = await this.getTriggersForGuild(trigger.guildId);
        Logger.info(`[createTrigger] 現在のトリガー数: ${triggers.length}`);
        
        // トリガー数制限チェック（ギルドごと最大20件）
        if (triggers.length >= 20) {
            throw new Error('トリガーは最大20件までです。既存のトリガーを削除してください。');
        }
        
        // プリセット数制限チェック
        if (trigger.presets.length > 5) {
            throw new Error('プリセットは最大5つまでです');
        }
        
        triggers.push(trigger);
        Logger.info(`[createTrigger] データベースに保存: database.set(${trigger.guildId}, ${key}, triggers[${triggers.length}])`);
        
        await this.database.set(trigger.guildId, key, triggers);
        Logger.info(`✅ トリガー作成成功: ${trigger.name} (${trigger.id}) in guild ${trigger.guildId}`);
        return trigger;
    }

    /**
     * トリガーを更新
     */
    async updateTrigger(guildId: string, triggerId: string, updates: Partial<Trigger>): Promise<Trigger | null> {
        const triggers = await this.getTriggersForGuild(guildId);
        const index = triggers.findIndex((t) => t.id === triggerId);
        
        if (index === -1) {
            return null;
        }
        
        // プリセット数制限チェック
        if (updates.presets && updates.presets.length > 5) {
            throw new Error('プリセットは最大5つまでです');
        }
        
        triggers[index] = { ...triggers[index], ...updates, updatedAt: new Date().toISOString() };
        await this.database.set(guildId, this.getTriggersKey(guildId), triggers);
        Logger.info(`✅ トリガー更新: ${triggers[index].name} (${triggerId})`);
        return triggers[index];
    }

    /**
     * トリガーを削除
     */
    async deleteTrigger(guildId: string, triggerId: string): Promise<boolean> {
        const triggers = await this.getTriggersForGuild(guildId);
        const filtered = triggers.filter((t) => t.id !== triggerId);
        
        if (filtered.length === triggers.length) {
            return false; // 削除対象が見つからなかった
        }
        
        await this.database.set(guildId, this.getTriggersKey(guildId), filtered);
        Logger.info(`🗑️ トリガー削除: ${triggerId}`);
        return true;
    }

    /**
     * イベント発火時にトリガーを処理
     */
    async handleEvent(eventType: TriggerEventType, guildId: string, eventData: any): Promise<void> {
        const triggers = await this.getTriggersForGuild(guildId);
        
        // 有効で対象イベントタイプのトリガーをフィルタ
        const matchingTriggers = triggers.filter(
            (t) => t.enabled && t.eventType === eventType
        );
        
        Logger.debug(`[TriggerManager] handleEvent: eventType=${eventType}, guildId=${guildId}, matchingTriggers=${matchingTriggers.length}`);
        
        // 優先度順にソート
        matchingTriggers.sort((a, b) => a.priority - b.priority);
        
        for (const trigger of matchingTriggers) {
            try {
                // 条件評価
                const context = await this.buildContext(trigger, eventType, eventData);
                const conditionsMet = this.evaluateConditions(trigger.conditions, context, (trigger as any).conditionLogic || 'OR');
                
                Logger.debug(`[TriggerManager] trigger="${trigger.name}" (${trigger.id}): conditionsMet=${conditionsMet}, conditions=${trigger.conditions.length}`);
                
                if (!conditionsMet) {
                    continue;
                }
                
                Logger.info(`✅ トリガー条件一致: ${trigger.name} (${trigger.id})`);
                
                // プリセット実行モードに基づいて実行するプリセットを決定
                const presetsToExecute = this.selectPresetsToExecute(trigger);
                
                for (const preset of presetsToExecute) {
                    await this.executePreset(trigger, preset, context);
                }
            } catch (error) {
                Logger.error(`❌ トリガー実行エラー [${trigger.id}]:`, error);
            }
        }
    }

    /**
     * runMode に基づいて実行するプリセットを選択
     */
    private selectPresetsToExecute(trigger: Trigger): TriggerPreset[] {
        const enabledPresets = trigger.presets.filter((p) => p.enabled);
        const runMode = trigger.runMode || 'all';

        switch (runMode) {
            case 'all':
                // すべてのプリセットを実行
                return enabledPresets;

            case 'random':
                // ランダムに1つ選択
                if (enabledPresets.length === 0) return [];
                const randomIndex = Math.floor(Math.random() * enabledPresets.length);
                return [enabledPresets[randomIndex]];

            case 'single':
                // 最初のプリセット（またはピン留めされたもの）を1つ実行
                const pinnedPreset = enabledPresets.find((p) => p.isPinned);
                if (pinnedPreset) {
                    return [pinnedPreset];
                }
                // ピン留めがなければ最初のものを実行
                return enabledPresets.length > 0 ? [enabledPresets[0]] : [];

            case 'pinned-random':
                // ピン留めプリセット + 選択外からランダム選択
                const pinnedPresets = enabledPresets.filter((p) => p.isPinned);
                const unpinnedPresets = enabledPresets.filter((p) => !p.isPinned);
                
                const randomCount = Math.min(
                    trigger.randomCount || 1,
                    unpinnedPresets.length
                );
                
                // ランダムに N 個のプリセットを選択
                const shuffled = [...unpinnedPresets].sort(() => Math.random() - 0.5);
                const randomPresets = shuffled.slice(0, randomCount);
                
                // ピン留め + ランダムを返す
                return [...pinnedPresets, ...randomPresets];

            default:
                return enabledPresets;
        }
    }

    /**
     * 条件評価エンジン
     */
    private evaluateConditions(conditions: TriggerCondition[], context: TriggerExecutionContext, conditionLogic: 'AND' | 'OR' = 'OR'): boolean {
        if (conditions.length === 0) {
            return true; // 条件なし = 常に実行
        }
        
        // グループIDでグルーピング（未指定は "default" グループ）
        const groups = new Map<string, TriggerCondition[]>();
        conditions.forEach((cond) => {
            const groupId = cond.groupId || 'default';
            if (!groups.has(groupId)) {
                groups.set(groupId, []);
            }
            groups.get(groupId)!.push(cond);
        });
        
        // 各グループ内は AND
        const groupResults: boolean[] = [];
        for (const [_groupId, groupConditions] of groups) {
            const allMatch = groupConditions.every((cond) => this.evaluateSingleCondition(cond, context));
            groupResults.push(allMatch);
        }

        // グループ間の結合は conditionLogic に従う
        if (conditionLogic === 'AND') {
            // すべてのグループが true であれば OK
            return groupResults.every(Boolean);
        } else {
            // OR: いずれかのグループが true であれば OK
            return groupResults.some(Boolean);
        }
    }

    /**
     * 単一条件の評価
     */
    private evaluateSingleCondition(condition: TriggerCondition, context: TriggerExecutionContext): boolean {
        let result = false;
        const { type, matchType, value } = condition;
        
        try {
            switch (type) {
                case 'messageContent':
                    const content = context.placeholders.message?.content || '';
                    result = this.matchString(content, value, matchType);
                    break;
                    
                case 'authorId':
                    const authorId = context.placeholders.user?.id || '';
                    result = this.matchString(authorId, value, matchType);
                    break;
                    
                case 'authorRole':
                    const roles = context.placeholders.author?.roles || [];
                    result = roles.includes(value);
                    break;
                    
                case 'channelId':
                    const channelId = context.placeholders.channel?.id || '';
                    result = this.matchString(channelId, value, matchType);
                    break;
                    
                case 'hasAttachment':
                    const attachmentCount = context.placeholders.attachments?.count || 0;
                    result = attachmentCount > 0;
                    break;
                    
                case 'mention':
                    // メンション条件: メッセージ内の mention を確認
                    // value は userId または <@userId> 形式、または メンション文字列
                    const mentionedIds = context.placeholders.mentionedIds || [];
                    const cleanValue = value.replace(/<@!?(\d+)>/g, '$1'); // <@id> -> id に変換
                    
                    // マッチ方式に応じて判定
                    if (matchType === 'contains' || matchType === 'exactly') {
                        // mentionedIds に value (userId) が含まれているか確認
                        result = mentionedIds.includes(cleanValue) || mentionedIds.includes(value);
                        Logger.debug(`[Mention Condition] value="${value}", cleanValue="${cleanValue}", mentionedIds=[${mentionedIds.join(', ')}], result=${result}`);
                    } else {
                        result = this.matchString(cleanValue, value, matchType);
                    }
                    break;
                    
                case 'regex':
                    const testContent = context.placeholders.message?.content || '';
                    const regex = new RegExp(value);
                    result = regex.test(testContent);
                    break;
                    
                case 'presence':
                    const status = context.placeholders.presence?.status || '';
                    result = this.matchString(status, value, matchType);
                    break;
                    
                case 'voiceState':
                    const voiceChannelId = context.placeholders.voice?.channelId || '';
                    result = this.matchString(voiceChannelId, value, matchType);
                    break;
                    
                case 'custom':
                    // カスタム条件は拡張可能
                    result = false;
                    break;
            }
        } catch (error) {
            Logger.error(`条件評価エラー [${type}]:`, error);
            result = false;
        }
        
        // negate フラグで反転
        return condition.negate ? !result : result;
    }

    /**
     * 文字列マッチング
     */
    private matchString(input: string, pattern: string, matchType: ConditionMatchType): boolean {
        switch (matchType) {
            case 'exactly':
                return input === pattern;
            case 'contains':
                return input.includes(pattern);
            case 'startsWith':
                return input.startsWith(pattern);
            case 'endsWith':
                return input.endsWith(pattern);
            case 'regex':
                return new RegExp(pattern).test(input);
            case 'greaterThan':
                return parseFloat(input) > parseFloat(pattern);
            case 'lessThan':
                return parseFloat(input) < parseFloat(pattern);
            default:
                return false;
        }
    }

    /**
     * プリセット実行
     */
    private async executePreset(trigger: Trigger, preset: TriggerPreset, context: TriggerExecutionContext): Promise<void> {
        // Cooldown チェック
        if (preset.cooldownSeconds) {
            const lastExecuted = this.cooldowns.get(preset.id) || 0;
            const now = Date.now();
            if (now - lastExecuted < preset.cooldownSeconds * 1000) {
                Logger.debug(`⏰ Cooldown中: ${preset.id}`);
                return;
            }
            this.cooldowns.set(preset.id, now);
        }
        
        const firedEvent: TriggerFiredEvent = {
            triggerId: trigger.id,
            presetId: preset.id,
            guildId: trigger.guildId,
            eventType: trigger.eventType,
            summary: `${trigger.name} - ${preset.type}`,
            timestamp: new Date().toISOString(),
            success: false,
        };
        
        try {
            switch (preset.type) {
                case 'Embed':
                    await this.executeEmbedPreset(preset, context);
                    break;
                case 'Text':
                    await this.executeTextPreset(preset, context);
                    break;
                case 'Reply':
                    await this.executeReplyPreset(preset, context);
                    break;
                case 'Webhook':
                    await this.executeWebhookPreset(preset, context);
                    break;
                case 'DM':
                    await this.executeDMPreset(preset, context);
                    break;
                case 'React':
                    await this.executeReactPreset(preset, context);
                    break;
                default:
                    throw new Error(`未対応のプリセットタイプ: ${preset.type}`);
            }
            
            firedEvent.success = true;
            Logger.info(`✅ プリセット実行成功: ${preset.type} (${preset.id})`);
        } catch (error: any) {
            firedEvent.success = false;
            firedEvent.error = error.message || String(error);
            Logger.error(`❌ プリセット実行エラー [${preset.type}]:`, error);
        } finally {
            // WebSocket通知とバッファ追加
            this.addToLiveBuffer(firedEvent);
            if (this.wsEmitter) {
                this.wsEmitter('trigger:fired', firedEvent);
            }
        }
    }

    /**
     * Embedプリセット実行
     */
    private async executeEmbedPreset(preset: TriggerPreset, context: TriggerExecutionContext): Promise<void> {
        const channelId = preset.targetChannelId || context.placeholders.channel?.id;
        if (!channelId) {
            throw new Error('送信先チャンネルが指定されていません');
        }
        
        const channel = await this.client.channels.fetch(channelId) as TextChannel;
        if (!channel || !channel.isTextBased()) {
            throw new Error('チャンネルが見つからないか、テキストチャンネルではありません');
        }
        
        const embed = new EmbedBuilder();
        const config = preset.embedConfig;
        
        if (config?.title) {
            embed.setTitle(this.renderTemplate(config.title, context.placeholders));
        }
        if (config?.description) {
            embed.setDescription(this.renderTemplate(config.description, context.placeholders));
        }
        if (config?.color) {
            embed.setColor(config.color as any);
        }
        if (config?.fields) {
            for (const field of config.fields) {
                embed.addFields({
                    name: this.renderTemplate(field.name, context.placeholders),
                    value: this.renderTemplate(field.value, context.placeholders),
                    inline: field.inline || false,
                });
            }
        }
        if (config?.imageUrl) {
            embed.setImage(this.renderTemplate(config.imageUrl, context.placeholders));
        }
        if (config?.thumbnailUrl) {
            embed.setThumbnail(this.renderTemplate(config.thumbnailUrl, context.placeholders));
        }
        if (config?.footer) {
            embed.setFooter({
                text: this.renderTemplate(config.footer.text, context.placeholders),
                iconURL: config.footer.iconUrl ? this.renderTemplate(config.footer.iconUrl, context.placeholders) : undefined,
            });
        }
        if (config?.timestamp) {
            embed.setTimestamp();
        }
        
        // Embedが完全に空でないことを確認
        const embedData = embed.toJSON();
        if (!embedData.title && !embedData.description && (!embedData.fields || embedData.fields.length === 0)) {
            throw new Error('Embedが空です。タイトル、説明、またはフィールドのいずれかを設定してください。');
        }
        
        const message = await channel.send({ embeds: [embed] });
        
        // 自動削除オプション
        if (preset.removeAfterSeconds && preset.removeAfterSeconds > 0) {
            setTimeout(async () => {
                try {
                    await message.delete();
                } catch (error) {
                    Logger.error('埋め込みメッセージ削除エラー:', error);
                }
            }, preset.removeAfterSeconds * 1000);
        }
    }

    /**
     * Textプリセット実行
     */
    private async executeTextPreset(preset: TriggerPreset, context: TriggerExecutionContext): Promise<void> {
        const channelId = preset.targetChannelId || context.placeholders.channel?.id;
        if (!channelId) {
            throw new Error('送信先チャンネルが指定されていません');
        }
        
        const channel = await this.client.channels.fetch(channelId) as TextChannel;
        if (!channel || !channel.isTextBased()) {
            throw new Error('チャンネルが見つからないか、テキストチャンネルではありません');
        }
        
        const text = this.renderTemplate(preset.template || '', context.placeholders);
        if (!text.trim()) {
            throw new Error('メッセージが空です。テンプレートを確認してください。');
        }
        const message = await channel.send(text);
        
        // 自動削除オプション
        if (preset.removeAfterSeconds && preset.removeAfterSeconds > 0) {
            setTimeout(async () => {
                try {
                    await message.delete();
                } catch (error) {
                    Logger.error('テキストメッセージ削除エラー:', error);
                }
            }, preset.removeAfterSeconds * 1000);
        }
    }

    /**
     * Replyプリセット実行
     */
    private async executeReplyPreset(preset: TriggerPreset, context: TriggerExecutionContext): Promise<void> {
        const messageId = context.placeholders.message?.id;
        const channelId = context.placeholders.channel?.id;
        
        if (!messageId || !channelId) {
            throw new Error('返信先のメッセージIDまたはチャンネルIDが不明です');
        }
        
        const channel = await this.client.channels.fetch(channelId) as TextChannel;
        const message = await channel.messages.fetch(messageId);
        
        const text = this.renderTemplate(preset.replyTemplate || '', context.placeholders);
        if (!text.trim()) {
            throw new Error('リプライメッセージが空です。テンプレートを確認してください。');
        }
        
        // replyWithMention フラグに基づいてメンション動作を制御
        const allowedMentions = preset.replyWithMention ? {} : { repliedUser: false };
        const replyMessage = await message.reply({
            content: text,
            allowedMentions: allowedMentions as any
        });
        
        // 自動削除オプション
        if (preset.removeAfterSeconds && preset.removeAfterSeconds > 0) {
            setTimeout(async () => {
                try {
                    await replyMessage.delete();
                } catch (error) {
                    Logger.error('リプライメッセージ削除エラー:', error);
                }
            }, preset.removeAfterSeconds * 1000);
        }
    }

    /**
     * Modalプリセット実行（現在は未実装）
     */
    /**
     * Webhookプリセット実行
     */
    private async executeWebhookPreset(preset: TriggerPreset, context: TriggerExecutionContext): Promise<void> {
        if (!preset.webhookConfig || !preset.webhookConfig.url) {
            throw new Error('Webhook URLが指定されていません');
        }
        
        const url = this.renderTemplate(preset.webhookConfig.url, context.placeholders);
        const method = preset.webhookConfig.method || 'POST';
        const headers = preset.webhookConfig.headers || {};
        const bodyTemplate = preset.webhookConfig.bodyTemplate || '';
        
        const body = bodyTemplate ? this.renderTemplate(bodyTemplate, context.placeholders) : undefined;
        
        const response = await axios({
            method,
            url,
            headers,
            data: body ? JSON.parse(body) : undefined,
        });
        
        Logger.info(`📤 Webhook実行成功: ${url} (ステータス: ${response.status})`);
    }

    /**
     * DMプリセット実行
     */
    private async executeDMPreset(preset: TriggerPreset, context: TriggerExecutionContext): Promise<void> {
        let userId = preset.dmTargetUserId;
        
        // {author} プレースホルダの処理
        if (userId === '{author}' || !userId) {
            userId = context.placeholders.user?.id;
        }
        
        if (!userId) {
            throw new Error('DM送信先のユーザーIDが不明です');
        }
        
        const user = await this.client.users.fetch(userId);
        const text = this.renderTemplate(preset.template || '', context.placeholders);
        if (!text.trim()) {
            throw new Error('DMメッセージが空です。テンプレートを確認してください。');
        }
        
        const dmMessage = await user.send(text);
        
        // 自動削除オプション
        if (preset.removeAfterSeconds && preset.removeAfterSeconds > 0) {
            setTimeout(async () => {
                try {
                    await dmMessage.delete();
                } catch (error) {
                    Logger.error('DMメッセージ削除エラー:', error);
                }
            }, preset.removeAfterSeconds * 1000);
        }
    }

    /**
     * Reactプリセット実行
     */
    private async executeReactPreset(preset: TriggerPreset, context: TriggerExecutionContext): Promise<void> {
        const messageId = context.placeholders.message?.id;
        const channelId = context.placeholders.channel?.id;
        
        if (!messageId || !channelId) {
            throw new Error('リアクション対象のメッセージIDまたはチャンネルIDが不明です');
        }
        
        const channel = await this.client.channels.fetch(channelId) as TextChannel;
        const message = await channel.messages.fetch(messageId);
        
        if (!preset.reactEmoji) {
            throw new Error('リアクション絵文字が指定されていません');
        }
        
        await message.react(preset.reactEmoji);
        
        // 自動削除オプション
        if (preset.removeAfterSeconds && preset.removeAfterSeconds > 0) {
            setTimeout(async () => {
                try {
                    const reaction = message.reactions.cache.find((r) => r.emoji.name === preset.reactEmoji);
                    if (reaction) {
                        await reaction.users.remove(this.client.user!.id);
                    }
                } catch (error) {
                    Logger.error('リアクション削除エラー:', error);
                }
            }, preset.removeAfterSeconds * 1000);
        }
    }

    /**
     * テンプレートレンダリング（プレースホルダ置換）
     */
    private renderTemplate(template: string, context: PlaceholderContext): string {
        let result = template;
        
        // 基本プレースホルダ
        result = result.replace(/{user}/g, context.user?.name || 'Unknown');
        result = result.replace(/{user\.name}/g, context.user?.name || 'Unknown');
        result = result.replace(/{user\.tag}/g, context.user?.tag || 'Unknown#0000');
        result = result.replace(/{user\.id}/g, context.user?.id || '');
        result = result.replace(/{user\.createdAt}/g, context.user?.createdAt || '');
        
        result = result.replace(/{author}/g, context.author?.name || 'Unknown');
        result = result.replace(/{author\.name}/g, context.author?.name || 'Unknown');
        result = result.replace(/{author\.displayName}/g, context.author?.displayName || context.author?.name || 'Unknown');
        result = result.replace(/{author\.mention}/g, context.author?.mention || '<@' + (context.author?.id || '') + '>');
        result = result.replace(/{author\.id}/g, context.author?.id || '');
        result = result.replace(/{author\.tag}/g, context.author?.tag || 'Unknown#0000');
        
        result = result.replace(/{guild\.name}/g, context.guild?.name || 'Unknown');
        result = result.replace(/{guild\.id}/g, context.guild?.id || '');
        result = result.replace(/{guild\.memberCount}/g, String(context.guild?.memberCount || 0));
        
        result = result.replace(/{channel\.name}/g, context.channel?.name || 'Unknown');
        result = result.replace(/{channel\.id}/g, context.channel?.id || '');
        result = result.replace(/{channel\.topic}/g, context.channel?.topic || '');
        result = result.replace(/{channel\.mention}/g, '<#' + (context.channel?.id || '') + '>');
        
        result = result.replace(/{message\.content}/g, context.message?.content || '');
        result = result.replace(/{message\.id}/g, context.message?.id || '');
        result = result.replace(/{message\.length}/g, String(context.message?.length || 0));
        result = result.replace(/{message\.words}/g, String(context.message?.words || 0));
        
        result = result.replace(/{attachments\.count}/g, String(context.attachments?.count || 0));
        result = result.replace(/{mention}/g, context.mention || '');
        result = result.replace(/{time}/g, context.time || new Date().toISOString());
        
        // ボイス・プレゼンス
        result = result.replace(/{voice\.channel}/g, context.voice?.channelName || '');
        result = result.replace(/{voice\.channel\.id}/g, context.voice?.channelId || '');
        result = result.replace(/{presence\.status}/g, context.presence?.status || '');
        
        // ランダム・日付
        result = result.replace(/{date\.now}/g, new Date().toISOString());
        result = result.replace(/{timestamp}/g, new Date().toISOString());
        result = result.replace(/{timestamp\.unix}/g, String(Math.floor(Date.now() / 1000)));
        
        // XSSエスケープ（簡易版）
        result = this.escapeHtml(result);
        
        return result;
    }

    /**
     * HTMLエスケープ（XSS防止）
     */
    private escapeHtml(text: string): string {
        const map: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
        };
        return text.replace(/[&<>"']/g, (m) => map[m]);
    }

    /**
     * コンテキスト構築
     */
    private async buildContext(
        trigger: Trigger,
        eventType: TriggerEventType,
        eventData: any
    ): Promise<TriggerExecutionContext> {
        const placeholders: PlaceholderContext = {
            time: new Date().toISOString(),
            date: { now: new Date().toISOString() },
        };
        
        // イベントタイプ別にコンテキストを構築
        if (eventType === 'messageCreate' && eventData.message) {
            const message: any = eventData.message;
            
            // メンション情報を抽出（Discord.js Message オブジェクト）
            let mentionedIds: string[] = [];
            let mentionedBotIds: string[] = [];
            
            try {
                if (message.mentions) {
                    // MessageMentions オブジェクトの場合
                    if (message.mentions.users) {
                        if (Array.isArray(message.mentions.users)) {
                            // 配列形式（ID の文字列配列）
                            mentionedIds = message.mentions.users.filter((id: any) => typeof id === 'string');
                        } else if (typeof message.mentions.users.keys === 'function') {
                            // Collection 形式
                            mentionedIds = Array.from(message.mentions.users.keys());
                        }
                    }
                    // Collection の場合
                    else if (typeof message.mentions.keys === 'function') {
                        mentionedIds = Array.from(message.mentions.keys());
                    }
                    // 配列形式の場合
                    else if (Array.isArray(message.mentions)) {
                        mentionedIds = message.mentions
                            .map((m: any) => m.id || m)
                            .filter((x: any) => typeof x === 'string');
                    }
                }
            } catch (err) {
                Logger.debug(`[buildContext] メンション抽出エラー: ${err}`);
            }
            
            // Bot のメンションを抽出
            try {
                if (message.mentions && message.mentions.users) {
                    if (Array.isArray(message.mentions.users)) {
                        // 配列形式の場合、users 内の ID をチェック
                        mentionedBotIds = mentionedIds.filter((id: string) => {
                            // message.mentions に bot 情報があるかチェック
                            // ここは簡易的に、users に含まれるだけでは bot かどうかは判定できないので
                            // 今は ID を使用
                            return true; // 一旦すべて bot と見なす（別途判定が必要な場合は修正）
                        });
                    } else if (typeof message.mentions.users.get === 'function') {
                        // Collection の場合
                        mentionedBotIds = mentionedIds.filter((id: string) => {
                            const user = message.mentions.users.get(id);
                            return user?.bot === true;
                        });
                    }
                }
            } catch (err) {
                Logger.debug(`[buildContext] Bot メンション抽出エラー: ${err}`);
            }
            
            Logger.debug(`[buildContext] messageCreate: content="${message.content}", mentionedIds=[${mentionedIds.join(', ')}], mentionedBotIds=[${mentionedBotIds.join(', ')}]`);
            
            placeholders.message = {
                id: message.id,
                content: message.content,
                length: message.content.length,
                words: message.content.split(/\s+/).length,
            };
            placeholders.user = {
                id: message.author.id,
                name: message.author.username,
                tag: message.author.tag,
                createdAt: message.author.createdAt ? (message.author.createdAt.toISOString ? message.author.createdAt.toISOString() : String(message.author.createdAt)) : undefined,
                isBot: message.author.bot,
            };
            placeholders.author = {
                id: message.author.id,
                name: message.author.username,
                displayName: message.member?.displayName || message.author.username,
                tag: message.author.tag,
                mention: `<@${message.author.id}>`,
                roles: message.member?.roles?.cache?.map(role => role.id) || [],
                isBot: message.author.bot,
                locale: message.author.locale,
            };
            placeholders.channel = {
                id: message.channel.id,
                name: (message.channel as TextChannel).name || '',
                topic: (message.channel as TextChannel).topic || '',
            };
            placeholders.guild = message.guild ? {
                id: message.guild.id,
                name: message.guild.name,
                memberCount: message.guild.memberCount,
            } : undefined;
            placeholders.attachments = {
                count: message.attachments.size,
            };
            
            // メンション情報を追加
            placeholders.mentionedIds = mentionedIds;
            placeholders.mentionedBotIds = mentionedBotIds;
            placeholders.mention = mentionedIds.join(','); // カンマ区切りで連結
        }
        
        // 他のイベントタイプも同様に追加可能
        
        return {
            trigger,
            eventType,
            eventData,
            placeholders,
        };
    }

    /**
     * ライブバッファに追加
     */
    private addToLiveBuffer(event: TriggerFiredEvent): void {
        this.liveBuffer.push(event);
        if (this.liveBuffer.length > this.maxBufferSize) {
            this.liveBuffer.shift(); // FIFO
        }
    }

    /**
     * ライブバッファを取得
     */
    getLiveBuffer(): TriggerFiredEvent[] {
        return [...this.liveBuffer];
    }

    /**
     * ライブバッファをクリア
     */
    clearLiveBuffer(): void {
        this.liveBuffer = [];
    }
}

// シングルトンエクスポート（BotClientで初期化後に利用）
let triggerManagerInstance: TriggerManager | null = null;

export function initTriggerManager(client: Client, database: Database): TriggerManager {
    triggerManagerInstance = new TriggerManager(client, database);
    return triggerManagerInstance;
}

export function getTriggerManager(): TriggerManager {
    if (!triggerManagerInstance) {
        throw new Error('TriggerManager が初期化されていません');
    }
    return triggerManagerInstance;
}
