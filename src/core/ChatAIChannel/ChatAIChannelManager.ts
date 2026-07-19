import fs from 'fs/promises';
import path from 'path';
import {
    Client,
    Events,
    type GuildTextBasedChannel,
    type Message,
} from 'discord.js';
import { config } from '../../config.js';
import { Logger } from '../../utils/Logger.js';
import { OpenAIChatManager } from '../ai/OpenAIChatManager.js';
import type { OpenAIChatCompletionMessage, OpenAIContentPart } from '../../types/openai.js';
import { registerChatAIChannelTools } from './tools/index.js';
import type { ChatAIChannelOptions, ChatAIMemoryFile, ChatAISandboxPaths } from './types.js';

const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_RESPONSE_DELAY_MS = 350;
const MAX_DISCORD_REPLY_LENGTH = 1_900;
const MAX_AI_REPLY_LENGTH = 1_200;
const MAX_IMAGES_PER_REQUEST = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 12_000;
const MAX_MEMORY_USERS_IN_PROMPT = 12;
const STREAM_UPDATE_INTERVAL_MS = 500;
const TYPING_REFRESH_INTERVAL_MS = 8_000;
const CONTINUATION_WINDOW_MS = 2 * 60_000;

interface PreparedChatPrompt {
    messages: OpenAIChatCompletionMessage[];
    images: Array<{
        index: number;
        author: string;
        dataUrl: string;
    }>;
}

export class ChatAIChannelManager {
    private client: Client | null = null;
    private readonly options: Required<ChatAIChannelOptions>;
    private readonly dataDir: string;
    private readonly memoryFile: string;
    private readonly sandboxPaths: ChatAISandboxPaths;
    private processing = false;
    private pending = false;
    private timer: NodeJS.Timeout | null = null;
    private activeConversationUserId: string | null = null;
    private activeConversationUntil = 0;
    private readonly chatManager: OpenAIChatManager;

    constructor(options: ChatAIChannelOptions) {
        this.options = {
            historyLimit: DEFAULT_HISTORY_LIMIT,
            responseDelayMs: DEFAULT_RESPONSE_DELAY_MS,
            ...options,
        };
        this.dataDir = path.join(process.cwd(), 'Database', 'integrations', this.options.guildId, 'chat-ai-channel');
        this.memoryFile = path.join(this.dataDir, 'user-memory.json');
        this.sandboxPaths = {
            root: path.join(this.dataDir, 'sandbox'),
            work: path.join(this.dataDir, 'sandbox', 'work'),
            downloads: path.join(this.dataDir, 'sandbox', 'downloads'),
            uploads: path.join(this.dataDir, 'sandbox', 'uploads'),
        };
        this.chatManager = new OpenAIChatManager({
            apiEndpoint: config.pexAi.endpoint,
            apiKey: config.pexAi.apiKey || undefined,
            defaultModel: config.pexAi.model,
        });
        registerChatAIChannelTools(this.chatManager, this.sandboxPaths);
    }

    async initialize(client: Client): Promise<void> {
        if (!this.options.enabled) {
            Logger.info(`[ChatAIChannel] disabled for guild ${this.options.guildId}`);
            return;
        }

        this.client = client;
        this.chatManager.setToolContext({ client, sandbox: this.sandboxPaths });
        await this.ensureStorage();
        client.on(Events.MessageCreate, this.onMessageCreate);
        Logger.info(`[ChatAIChannel] enabled: guild=${this.options.guildId} channel=${this.options.channelId}`);
    }

    async destroy(): Promise<void> {
        if (this.client) {
            this.client.off(Events.MessageCreate, this.onMessageCreate);
        }
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.client = null;
        this.processing = false;
        this.pending = false;
    }

    private readonly onMessageCreate = async (message: Message): Promise<void> => {
        if (!this.shouldObserve(message)) return;
        const shouldTrigger = this.shouldTrigger(message);

        if (shouldTrigger) {
            this.activeConversationUserId = message.author.id;
            this.activeConversationUntil = Date.now() + CONTINUATION_WINDOW_MS;
            const channel = message.channel;
            if ('sendTyping' in channel && typeof channel.sendTyping === 'function') {
                void channel.sendTyping().catch(() => null);
            }
            this.queueResponse();
        }

        await this.rememberLightweight(message).catch(error => Logger.debug('[ChatAIChannel] memory update failed:', error));
    };

    private shouldObserve(message: Message): boolean {
        return Boolean(
            this.options.enabled
            && !message.author.bot
            && message.guild?.id === this.options.guildId
            && message.channel.id === this.options.channelId,
        );
    }

    private shouldTrigger(message: Message): boolean {
        const content = message.content.replace(/\s+/g, '');
        const mentionedCurrentBot = Boolean(
            this.client?.user?.id
            && message.mentions.users.has(this.client.user.id),
        );
        const explicitlyCalled = mentionedCurrentBot || content.includes(this.options.botName);
        if (explicitlyCalled) return true;

        return this.activeConversationUserId === message.author.id
            && Date.now() <= this.activeConversationUntil;
    }

    private queueResponse(): void {
        this.pending = true;
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.processQueue();
        }, this.options.responseDelayMs);
    }

    private async processQueue(): Promise<void> {
        if (this.processing) {
            this.pending = true;
            return;
        }

        this.processing = true;
        try {
            do {
                this.pending = false;
                await this.respondToLatestConversation();
            } while (this.pending);
        } catch (error) {
            Logger.error('[ChatAIChannel] failed to respond:', error);
            await this.sendFallbackError().catch(() => null);
        } finally {
            this.processing = false;
        }
    }

    private async respondToLatestConversation(): Promise<void> {
        const channel = await this.resolveChannel();
        if (!channel) return;

        if ('sendTyping' in channel && typeof channel.sendTyping === 'function') {
            await channel.sendTyping().catch(() => null);
        }
        const stopTyping = this.startTypingLoop(channel);

        const history = await this.fetchRecentMessages(channel);
        const memory = await this.loadMemory();
        const prompt = await this.buildPrompt(history, memory);
        const messages = prompt.messages;
        this.chatManager.setToolContext({ client: this.client, sandbox: this.sandboxPaths, images: prompt.images });
        let responseMessage: Message | null = null;
        let updateChain = Promise.resolve();
        let response = '';
        let thinking = '';
        let lastUpdateAt = 0;

        const queueStreamingUpdate = (completed: boolean): void => {
            const answerSnapshot = response;
            const thinkingSnapshot = thinking;
            updateChain = updateChain.then(async () => {
                const formatted = this.formatStreamingResponse(answerSnapshot, thinkingSnapshot, completed);
                if (!responseMessage) {
                    responseMessage = await this.createStreamingMessage(channel, formatted);
                    return;
                }
                await responseMessage.edit(formatted).catch((error: unknown) => {
                    Logger.debug('[ChatAIChannel] stream edit failed:', error);
                });
            });
        };

        try {
            await this.chatManager.streamResponseText(
                messages,
                (delta) => {
                    if (delta.type === 'thinking') {
                        thinking += delta.text;
                    } else {
                        response += delta.text;
                    }

                    const now = Date.now();
                    if (now - lastUpdateAt >= STREAM_UPDATE_INTERVAL_MS) {
                        lastUpdateAt = now;
                        queueStreamingUpdate(false);
                    }
                },
                {
                    model: config.pexAi.model,
                    strictModel: true,
                    temperature: 0.75,
                    maxTokens: 650,
                    requestLabel: 'chat-ai-channel',
                },
            );

            if (!response) response = 'うまく言葉にできなかった。もう一回呼んで。';
            queueStreamingUpdate(true);
            await updateChain;
            this.activeConversationUntil = Date.now() + CONTINUATION_WINDOW_MS;
            await this.updateMemoryWithAi(history, memory).catch(error => Logger.debug('[ChatAIChannel] AI memory update failed:', error));
        } finally {
            stopTyping();
        }
    }

    private async resolveChannel(): Promise<GuildTextBasedChannel | null> {
        if (!this.client) return null;
        const guild = await this.client.guilds.fetch(this.options.guildId).catch(() => null);
        if (!guild) return null;
        const channel = await guild.channels.fetch(this.options.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return null;
        return channel as GuildTextBasedChannel;
    }

    private async fetchRecentMessages(channel: GuildTextBasedChannel): Promise<Message[]> {
        const fetchable = channel as any;
        if (!fetchable.messages?.fetch) return [];
        const collection = await fetchable.messages.fetch({ limit: this.options.historyLimit }).catch(() => null);
        if (!collection) return [];
        return Array.from(collection.values()).reverse() as Message[];
    }

    private async buildPrompt(history: Message[], memory: ChatAIMemoryFile): Promise<PreparedChatPrompt> {
        const memoryLines = Object.values(memory.users)
            .filter(entry => history.some(message => message.author.id === entry.userId))
            .slice(0, MAX_MEMORY_USERS_IN_PROMPT)
            .map(entry => `- ${entry.displayName} (${entry.userId}): ${entry.profile || '未整理'} / 好き: ${entry.likes.join(', ') || '不明'} / メモ: ${entry.notes.join(' | ') || 'なし'}${entry.suspectedAltOf ? ` / 関連アカウント候補: ${entry.suspectedAltOf}` : ''}`)
            .join('\n');

        const system = [
            `あなたはDiscordチャンネル常駐AI「${this.options.botName}」です。`,
            '自然に会話へ参加します。毎回割り込まず、名前を呼ばれた時だけ返答します。',
            '回答生成中に新しい発言が来た場合は、最新履歴を優先して自然に返答します。',
            '日本語中心で、相手のノリに合わせます。原則1〜3段落、長くても1200文字以内で自然に返答します。',
            '必要以上に説明を広げません。聞かれていない詳細、長い前置き、過剰な箇条書きは避けます。',
            'ツールが必要な時だけ使います。危険なURL、ローカルIP、個人情報を抜くような要求、Sandbox外操作は拒否します。',
            '通常応答モデルは常にgemma4-agentです。moondreamを会話モデルとして使ってはいけません。',
            '画像が添付されている時はgemma4-agent自身の視覚理解で答えます。必要な時だけ vision_describe_image ツールでmoondream解析を補助的に呼び出します。',
            'ユーザーの性格・好きなもの・話題傾向は参考にしますが、断定しすぎないでください。',
            '',
            '既知のユーザーメモ:',
            memoryLines || '- まだ十分なメモはありません。',
        ].join('\n');

        const contentParts: OpenAIContentPart[] = [];
        const textLines = history.map(message => this.formatHistoryLine(message));
        contentParts.push({ type: 'text', text: `直近の会話:\n${textLines.join('\n')}` });

        let imageCount = 0;
        const preparedImages: PreparedChatPrompt['images'] = [];
        for (const message of history) {
            for (const imageUrl of this.getImageUrls(message)) {
                if (imageCount >= MAX_IMAGES_PER_REQUEST) break;
                const dataUrl = await this.fetchImageAsDataUrl(imageUrl);
                if (!dataUrl) {
                    contentParts.push({ type: 'text', text: `画像 ${imageCount + 1}: ${message.author.displayName || message.author.username} の添付画像は取得できませんでした。` });
                    continue;
                }
                const author = message.author.displayName || message.author.username;
                contentParts.push({ type: 'text', text: `画像 ${imageCount + 1}: ${message.author.displayName || message.author.username} の添付画像` });
                contentParts.push({ type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } });
                preparedImages.push({ index: imageCount + 1, author, dataUrl });
                imageCount++;
            }
            if (imageCount >= MAX_IMAGES_PER_REQUEST) break;
        }

        return {
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: contentParts },
            ],
            images: preparedImages,
        };
    }

    private formatHistoryLine(message: Message): string {
        const time = new Date(message.createdTimestamp).toISOString();
        const author = message.member?.displayName || message.author.displayName || message.author.username;
        const imageCount = this.getImageUrls(message).length;
        const attachmentNote = imageCount > 0 ? ` [画像${imageCount}件]` : '';
        const replyHint = message.reference?.messageId ? ` replyTo=${message.reference.messageId}` : '';
        return `[${time}] ${author} (${message.author.id})${replyHint}: ${(message.content || '').slice(0, 800)}${attachmentNote}`;
    }

    private getImageUrls(message: Message): string[] {
        return Array.from(message.attachments.values())
            .filter(attachment => {
                const contentType = attachment.contentType?.toLowerCase() || '';
                return contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(attachment.url);
            })
            .map(attachment => attachment.url);
    }

    private async fetchImageAsDataUrl(imageUrl: string): Promise<string | null> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

        try {
            const response = await fetch(imageUrl, {
                signal: controller.signal,
                headers: { 'user-agent': 'PexisChatAI/1.0' },
            });
            if (!response.ok) {
                Logger.debug(`[ChatAIChannel] image fetch failed: HTTP ${response.status}`);
                return null;
            }

            const contentType = response.headers.get('content-type')?.toLowerCase() || 'application/octet-stream';
            if (!contentType.startsWith('image/')) {
                Logger.debug(`[ChatAIChannel] skipped non-image attachment: ${contentType}`);
                return null;
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
                Logger.debug(`[ChatAIChannel] skipped image by size: ${buffer.byteLength} bytes`);
                return null;
            }

            return `data:${contentType};base64,${buffer.toString('base64')}`;
        } catch (error) {
            Logger.debug('[ChatAIChannel] image fetch error:', error);
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    private async sendLongReply(channel: GuildTextBasedChannel, text: string): Promise<void> {
        const sendable = channel as any;
        if (typeof sendable.send !== 'function') return;
        const chunks = this.chunkText(text, MAX_DISCORD_REPLY_LENGTH);
        for (const chunk of chunks) {
            await sendable.send(chunk).catch((error: unknown) => Logger.debug('[ChatAIChannel] send failed:', error));
        }
    }

    private async createStreamingMessage(channel: GuildTextBasedChannel, content: string): Promise<Message | null> {
        const sendable = channel as any;
        if (typeof sendable.send !== 'function') return null;
        return await sendable.send(content).catch((error: unknown) => {
            Logger.debug('[ChatAIChannel] initial stream send failed:', error);
            return null;
        });
    }

    private startTypingLoop(channel: GuildTextBasedChannel): () => void {
        if (!('sendTyping' in channel) || typeof channel.sendTyping !== 'function') {
            return () => {};
        }

        let active = true;
        const tick = () => {
            if (!active) return;
            void channel.sendTyping().catch((error: unknown) => {
                Logger.debug('[ChatAIChannel] sendTyping failed:', error);
            });
        };

        tick();
        const interval = setInterval(tick, TYPING_REFRESH_INTERVAL_MS);
        return () => {
            active = false;
            clearInterval(interval);
        };
    }

    private formatStreamingResponse(answerText: string, thinkingText: string, completed: boolean): string {
        const parts: string[] = [];

        if (thinkingText.trim()) {
            const thinking = this.limitThinkingText(thinkingText);
            parts.push(thinking
                .split('\n')
                .map(line => `> *${line || ' '}*`)
                .join('\n'));
        }

        const answer = this.limitReply(answerText || '');
        if (answer) {
            parts.push(answer);
        }

        const body = parts.join('\n\n').trim() || (completed ? '（空の応答）' : '…');
        return this.chunkText(body, MAX_DISCORD_REPLY_LENGTH)[0] || body.slice(0, MAX_DISCORD_REPLY_LENGTH);
    }

    private limitThinkingText(text: string): string {
        const compact = text
            .replace(/\s+/g, ' ')
            .trim();
        return compact.length > 350 ? `${compact.slice(0, 350).trim()}...` : compact;
    }

    private chunkText(text: string, maxLength: number): string[] {
        const normalized = text.trim() || '（空の応答）';
        const chunks: string[] = [];
        let remaining = normalized;
        while (remaining.length > maxLength) {
            const splitAt = Math.max(remaining.lastIndexOf('\n', maxLength), remaining.lastIndexOf('。', maxLength));
            const index = splitAt > 200 ? splitAt + 1 : maxLength;
            chunks.push(remaining.slice(0, index).trim());
            remaining = remaining.slice(index).trim();
        }
        if (remaining) chunks.push(remaining);
        return chunks;
    }

    private limitReply(text: string): string {
        const normalized = text.trim();
        if (normalized.length <= MAX_AI_REPLY_LENGTH) {
            return normalized;
        }

        const sliced = normalized.slice(0, MAX_AI_REPLY_LENGTH);
        const splitAt = Math.max(sliced.lastIndexOf('\n'), sliced.lastIndexOf('。'), sliced.lastIndexOf('！'), sliced.lastIndexOf('？'));
        const body = splitAt > 400 ? sliced.slice(0, splitAt + 1).trim() : sliced.trim();
        return `${body}\n\n（長くなりそうだからここで区切るね。続きが必要なら呼んで。）`;
    }

    private async sendFallbackError(): Promise<void> {
        const channel = await this.resolveChannel();
        if (!channel) return;
        await this.sendLongReply(channel, `ごめん、今ちょっと処理に失敗した。少し内容を変えてもう一回「${this.options.botName}」って呼んで。`);
    }

    private async ensureStorage(): Promise<void> {
        await Promise.all([
            fs.mkdir(this.dataDir, { recursive: true }),
            fs.mkdir(this.sandboxPaths.work, { recursive: true }),
            fs.mkdir(this.sandboxPaths.downloads, { recursive: true }),
            fs.mkdir(this.sandboxPaths.uploads, { recursive: true }),
        ]);
        await this.loadMemory();
    }

    private async loadMemory(): Promise<ChatAIMemoryFile> {
        try {
            const raw = await fs.readFile(this.memoryFile, 'utf8');
            return JSON.parse(raw) as ChatAIMemoryFile;
        } catch {
            const empty: ChatAIMemoryFile = { users: {}, updatedAt: new Date().toISOString() };
            await this.saveMemory(empty);
            return empty;
        }
    }

    private async saveMemory(memory: ChatAIMemoryFile): Promise<void> {
        memory.updatedAt = new Date().toISOString();
        await fs.mkdir(path.dirname(this.memoryFile), { recursive: true });
        await fs.writeFile(this.memoryFile, JSON.stringify(memory, null, 2), 'utf8');
    }

    private async rememberLightweight(message: Message): Promise<void> {
        const memory = await this.loadMemory();
        const displayName = message.member?.displayName || message.author.displayName || message.author.username;
        const existing = memory.users[message.author.id];
        memory.users[message.author.id] = {
            userId: message.author.id,
            displayName,
            aliases: Array.from(new Set([...(existing?.aliases || []), message.author.username, displayName].filter(Boolean))).slice(0, 10),
            profile: existing?.profile || '',
            likes: existing?.likes || [],
            notes: existing?.notes || [],
            suspectedAltOf: existing?.suspectedAltOf,
            updatedAt: new Date().toISOString(),
        };
        await this.saveMemory(memory);
    }

    private async updateMemoryWithAi(history: Message[], memory: ChatAIMemoryFile): Promise<void> {
        const recentHumanMessages = history.filter(message => !message.author.bot).slice(-12);
        if (recentHumanMessages.length === 0) return;

        const compactHistory = recentHumanMessages.map(message => this.formatHistoryLine(message)).join('\n');
        const known = Object.values(memory.users)
            .filter(entry => recentHumanMessages.some(message => message.author.id === entry.userId))
            .map(entry => ({ userId: entry.userId, displayName: entry.displayName, profile: entry.profile, likes: entry.likes, notes: entry.notes, suspectedAltOf: entry.suspectedAltOf }));

        const update = await this.chatManager.generateText([
            {
                role: 'system',
                content: 'Discord会話から、ユーザー理解用の安全なメモだけをJSONで更新します。思想・宗教・健康・住所・電話・秘密情報などのセンシティブ情報は保存しません。断定せず、会話上明確な好み・話題傾向・呼び名だけを短く保存します。出力はJSONのみ。',
            },
            {
                role: 'user',
                content: JSON.stringify({ knownUsers: known, recentConversation: compactHistory, schema: { users: [{ userId: 'string', profile: 'string', likes: ['string'], notes: ['string'], suspectedAltOf: 'string optional' }] } }),
            },
        ], {
            model: config.pexAi.model,
            temperature: 0.2,
            maxTokens: 500,
            requestLabel: 'chat-ai-channel-memory',
        });

        const parsed = this.parseJsonObject(update);
        if (!parsed || !Array.isArray(parsed.users)) return;

        for (const entry of parsed.users) {
            const userId = typeof entry.userId === 'string' ? entry.userId : '';
            if (!userId || !memory.users[userId]) continue;
            const target = memory.users[userId];
            if (typeof entry.profile === 'string' && entry.profile.trim()) {
                target.profile = entry.profile.trim().slice(0, 500);
            }
            if (Array.isArray(entry.likes)) {
                target.likes = Array.from(new Set<string>(entry.likes.map(String).map((value: string) => value.trim()).filter(Boolean))).slice(0, 20);
            }
            if (Array.isArray(entry.notes)) {
                target.notes = Array.from(new Set<string>(entry.notes.map(String).map((value: string) => value.trim()).filter(Boolean))).slice(0, 30);
            }
            if (typeof entry.suspectedAltOf === 'string' && entry.suspectedAltOf.trim()) {
                target.suspectedAltOf = entry.suspectedAltOf.trim().slice(0, 80);
            }
            target.updatedAt = new Date().toISOString();
        }

        await this.saveMemory(memory);
    }

    private parseJsonObject(text: string): any | null {
        try {
            return JSON.parse(text);
        } catch {
            const match = text.match(/\{[\s\S]*\}/);
            if (!match) return null;
            try {
                return JSON.parse(match[0]);
            } catch {
                return null;
            }
        }
    }
}
