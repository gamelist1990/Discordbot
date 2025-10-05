/**
 * EventManager - 統一されたイベントシステム
 * Discord標準イベントとカスタムイベントの両方を管理
 */

import { Client } from 'discord.js';
import { randomUUID } from 'crypto';
import { Event, EventHandler, EventListener, EventPayloads } from '../types/events.js';
import { Logger } from '../utils/Logger.js';

export class EventManager {
    private client: Client;
    private listeners: Map<Event, Map<string, EventListener>>;
    private discordListenersSetup: Set<Event>;

    constructor(client: Client) {
        this.client = client;
        this.listeners = new Map();
        this.discordListenersSetup = new Set();
        
        Logger.info('EventManager initialized');
    }

    /**
     * イベントリスナーを登録
     * @param event 登録するイベント
     * @param handler イベントハンドラー関数
     * @param options オプション設定
     * @returns リスナーID（登録解除に使用）
     */
    register<T extends Event>(
        event: T,
        handler: EventHandler<T>,
        options?: {
            once?: boolean;
            priority?: number;
        }
    ): string {
        const listenerId = randomUUID();
        
        // リスナー情報を作成
        const listener: EventListener<T> = {
            id: listenerId,
            event,
            handler,
            once: options?.once || false,
            priority: options?.priority || 0,
        };

        // イベントマップを取得または作成
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Map());
        }

        const eventListeners = this.listeners.get(event)!;
        eventListeners.set(listenerId, listener as unknown as EventListener);

        // Discord標準イベントの場合、Discord.jsリスナーをセットアップ
        if (this.isDiscordEvent(event) && !this.discordListenersSetup.has(event)) {
            this.setupDiscordListener(event);
            this.discordListenersSetup.add(event);
        }

        Logger.debug(`Event listener registered: ${event} (ID: ${listenerId})`);
        return listenerId;
    }

    /**
     * イベントリスナーの登録を解除
     * @param listenerId register()で返されたID
     * @returns 解除に成功したかどうか
     */
    unregister(listenerId: string): boolean {
        for (const [event, eventListeners] of this.listeners.entries()) {
            if (eventListeners.has(listenerId)) {
                eventListeners.delete(listenerId);
                Logger.debug(`Event listener unregistered: ${event} (ID: ${listenerId})`);
                
                // リスナーが0になったらマップから削除
                if (eventListeners.size === 0) {
                    this.listeners.delete(event);
                }
                
                return true;
            }
        }
        
        Logger.warn(`Event listener not found: ${listenerId}`);
        return false;
    }

    /**
     * 一度だけ実行されるイベントリスナーを登録
     */
    once<T extends Event>(
        event: T,
        handler: EventHandler<T>
    ): string {
        return this.register(event, handler, { once: true });
    }

    /**
     * 特定イベントの全リスナーを解除
     */
    unregisterAll(event: Event): void {
        this.listeners.delete(event);
        Logger.debug(`All listeners unregistered for event: ${event}`);
    }

    /**
     * カスタムイベントを発火（エミット）
     * @param event イベント名
     * @param payload イベントデータ
     */
    async emit<T extends Event>(event: T, payload: EventPayloads[T]): Promise<void> {
        const eventListeners = this.listeners.get(event);
        
        if (!eventListeners || eventListeners.size === 0) {
            return;
        }

        // 優先度順にソート
        const sortedListeners = Array.from(eventListeners.values())
            .sort((a, b) => (b.priority || 0) - (a.priority || 0));

        const onceListeners: string[] = [];

        for (const listener of sortedListeners) {
            try {
                await listener.handler(payload as any);
                
                // onceフラグが立っているリスナーを記録
                if (listener.once) {
                    onceListeners.push(listener.id);
                }
            } catch (error) {
                Logger.error(`Error in event listener (${event}):`, error);
            }
        }

        // onceリスナーを削除
        for (const id of onceListeners) {
            this.unregister(id);
        }
    }

    /**
     * Discord標準イベントかどうかを判定
     */
    private isDiscordEvent(event: Event): boolean {
        const discordEvents = [
            Event.MESSAGE_CREATE,
            Event.MESSAGE_DELETE,
            Event.MESSAGE_UPDATE,
            Event.INTERACTION_CREATE,
            Event.GUILD_CREATE,
            Event.GUILD_DELETE,
            Event.GUILD_MEMBER_ADD,
            Event.GUILD_MEMBER_REMOVE,
            Event.CHANNEL_CREATE,
            Event.CHANNEL_DELETE,
            Event.ROLE_CREATE,
            Event.ROLE_DELETE,
            Event.VOICE_STATE_UPDATE,
            Event.REACTION_ADD,
            Event.REACTION_REMOVE,
            Event.READY,
        ];
        return discordEvents.includes(event);
    }

    /**
     * Discord.jsのイベントリスナーをセットアップ
     */
    private setupDiscordListener(event: Event): void {
        switch (event) {
            case Event.MESSAGE_CREATE:
                this.client.on('messageCreate', (message) => {
                    this.emit(Event.MESSAGE_CREATE, message);
                });
                break;

            case Event.MESSAGE_DELETE:
                this.client.on('messageDelete', (message) => {
                    this.emit(Event.MESSAGE_DELETE, message as any);
                });
                break;

            case Event.MESSAGE_UPDATE:
                this.client.on('messageUpdate', (oldMessage, newMessage) => {
                    this.emit(Event.MESSAGE_UPDATE, { 
                        oldMessage: oldMessage as any, 
                        newMessage: newMessage as any 
                    });
                });
                break;

            case Event.INTERACTION_CREATE:
                this.client.on('interactionCreate', (interaction) => {
                    this.emit(Event.INTERACTION_CREATE, interaction);
                });
                break;

            case Event.GUILD_CREATE:
                this.client.on('guildCreate', (guild) => {
                    this.emit(Event.GUILD_CREATE, guild);
                });
                break;

            case Event.GUILD_DELETE:
                this.client.on('guildDelete', (guild) => {
                    this.emit(Event.GUILD_DELETE, guild);
                });
                break;

            case Event.GUILD_MEMBER_ADD:
                this.client.on('guildMemberAdd', (member) => {
                    this.emit(Event.GUILD_MEMBER_ADD, member);
                });
                break;

            case Event.GUILD_MEMBER_REMOVE:
                this.client.on('guildMemberRemove', (member) => {
                    this.emit(Event.GUILD_MEMBER_REMOVE, member as any);
                });
                break;

            case Event.CHANNEL_CREATE:
                this.client.on('channelCreate', (channel) => {
                    this.emit(Event.CHANNEL_CREATE, channel);
                });
                break;

            case Event.CHANNEL_DELETE:
                this.client.on('channelDelete', (channel) => {
                    this.emit(Event.CHANNEL_DELETE, channel);
                });
                break;

            case Event.ROLE_CREATE:
                this.client.on('roleCreate', (role) => {
                    this.emit(Event.ROLE_CREATE, role);
                });
                break;

            case Event.ROLE_DELETE:
                this.client.on('roleDelete', (role) => {
                    this.emit(Event.ROLE_DELETE, role);
                });
                break;

            case Event.VOICE_STATE_UPDATE:
                this.client.on('voiceStateUpdate', (oldState, newState) => {
                    this.emit(Event.VOICE_STATE_UPDATE, { oldState, newState });
                });
                break;

            case Event.REACTION_ADD:
                this.client.on('messageReactionAdd', (reaction, user) => {
                    this.emit(Event.REACTION_ADD, { reaction, user });
                });
                break;

            case Event.REACTION_REMOVE:
                this.client.on('messageReactionRemove', (reaction, user) => {
                    this.emit(Event.REACTION_REMOVE, { reaction, user });
                });
                break;

            case Event.READY:
                this.client.on('ready', (client) => {
                    this.emit(Event.READY, client);
                });
                break;

            default:
                Logger.warn(`Unknown Discord event: ${event}`);
        }

        Logger.debug(`Discord listener setup completed: ${event}`);
    }

    /**
     * 登録されているリスナーの統計情報を取得
     */
    getStats(): {
        totalEvents: number;
        totalListeners: number;
        eventDetails: Array<{ event: Event; listenerCount: number }>;
    } {
        const eventDetails = Array.from(this.listeners.entries()).map(([event, listeners]) => ({
            event,
            listenerCount: listeners.size,
        }));

        return {
            totalEvents: this.listeners.size,
            totalListeners: Array.from(this.listeners.values()).reduce(
                (sum, listeners) => sum + listeners.size,
                0
            ),
            eventDetails,
        };
    }

    /**
     * すべてのリスナーをクリア（クリーンアップ用）
     */
    clear(): void {
        this.listeners.clear();
        this.discordListenersSetup.clear();
        Logger.info('EventManager cleared');
    }
}
