import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import {
    Client,
    Events,
    type GuildTextBasedChannel,
    type Message,
} from 'discord.js';
import { config } from '../../config.js';
import { Logger } from '../../utils/Logger.js';
import { OpenAIChatManager } from '../ai/OpenAIChatManager.js';
import type { ToolExecutionStep } from '../ai/ChatGPTClient.js';
import type { OpenAIChatCompletionMessage, OpenAIContentPart } from '../../types/openai.js';
import { registerChatAIChannelTools } from './tools/index.js';
import { ChatAISpamGuard } from './ChatAISpamGuard.js';
import type {
    ChatAIChannelOptions,
    ChatAIMemoryFile,
    ChatAISandboxPaths,
    ChatAIChannelTimeoutFile,
} from './types.js';

const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_RESPONSE_DELAY_MS = 350;
const MAX_DISCORD_REPLY_LENGTH = 1_900;
const MAX_AI_REPLY_LENGTH = 1_200;
const MAX_IMAGES_PER_REQUEST = 2;
const MAX_IMAGE_BYTES = 768 * 1024;
const MAX_SOURCE_GIF_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 1024 * 1024;
const MAX_HISTORY_PROMPT_CHARACTERS = 12_000;
const IMAGE_FETCH_TIMEOUT_MS = 12_000;
const MAX_MEMORY_USERS_IN_PROMPT = 12;
const STREAM_UPDATE_INTERVAL_MS = 500;
const TYPING_REFRESH_INTERVAL_MS = 8_000;
const CONTINUATION_WINDOW_MS = 2 * 60_000;
const GIF_SAMPLE_FRAME_COUNT = 3;
const GIF_FRAME_WIDTH = 320;
const GIF_FRAME_HEIGHT = 240;
const SILENT_DISCORD_TOOL_NAMES = new Set(['user_memory_edit', 'channel_user_timeout']);

export function resolveChatAIChannelModels(primaryModel: string, fallbackModel?: string): string[] {
    return Array.from(new Set([primaryModel, fallbackModel]
        .map(model => String(model ?? '').trim())
        .filter(Boolean)));
}

interface PreparedChatPrompt {
    messages: OpenAIChatCompletionMessage[];
    images: Array<{
        index: number;
        author: string;
        dataUrl: string;
    }>;
}

/**
 * GIFの先頭・中間・末尾から最大3枚を抽出し、視覚モデルが扱いやすい
 * 横並びの静止PNGへ変換する。静止GIFの場合は1枚だけ変換する。
 */
export async function createGifContactSheet(gifBuffer: Buffer): Promise<Buffer | null> {
    try {
        const metadata = await sharp(gifBuffer, { animated: true }).metadata();
        const pageCount = Math.max(1, metadata.pages || 1);
        const sampleCount = Math.min(GIF_SAMPLE_FRAME_COUNT, pageCount);
        const sampledPages = sampleCount === 1
            ? [0]
            : Array.from({ length: sampleCount }, (_, index) =>
                Math.round((index * (pageCount - 1)) / (sampleCount - 1)),
            );
        const uniquePages = Array.from(new Set(sampledPages));

        const frameBuffers = await Promise.all(uniquePages.map(page =>
            sharp(gifBuffer, { page, pages: 1 })
                .resize(GIF_FRAME_WIDTH, GIF_FRAME_HEIGHT, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 1 },
                })
                .png({ compressionLevel: 9 })
                .toBuffer(),
        ));

        return sharp({
            create: {
                width: GIF_FRAME_WIDTH * frameBuffers.length,
                height: GIF_FRAME_HEIGHT,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 },
            },
        })
            .composite(frameBuffers.map((input, index) => ({
                input,
                left: index * GIF_FRAME_WIDTH,
                top: 0,
            })))
            .png({ compressionLevel: 9 })
            .toBuffer();
    } catch (error) {
        Logger.debug('[ChatAIChannel] GIF frame extraction failed:', error);
        return null;
    }
}

export class ChatAIChannelManager {
    private client: Client | null = null;
    private readonly options: Required<ChatAIChannelOptions>;
    private readonly dataDir: string;
    private readonly memoryFile: string;
    private readonly timeoutFile: string;
    private readonly sandboxPaths: ChatAISandboxPaths;
    private processing = false;
    private pending = false;
    private timer: NodeJS.Timeout | null = null;
    private activeConversationUserId: string | null = null;
    private activeConversationUntil = 0;
    private readonly spamGuard = new ChatAISpamGuard();
    private readonly chatManager: OpenAIChatManager;

    constructor(options: ChatAIChannelOptions) {
        this.options = {
            historyLimit: DEFAULT_HISTORY_LIMIT,
            responseDelayMs: DEFAULT_RESPONSE_DELAY_MS,
            ...options,
        };
        this.dataDir = path.join(process.cwd(), 'Database', 'integrations', this.options.guildId, 'chat-ai-channel');
        this.memoryFile = path.join(this.dataDir, 'user-memory.json');
        this.timeoutFile = path.join(this.dataDir, 'channel-user-timeouts.json');
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
        registerChatAIChannelTools(this.chatManager, this.sandboxPaths, this.memoryFile, this.timeoutFile);
    }

    async initialize(client: Client): Promise<void> {
        if (!this.options.enabled) {
            Logger.info(`[ChatAIChannel] disabled for guild ${this.options.guildId}`);
            return;
        }

        this.client = client;
        this.chatManager.setToolContext({
            client,
            sandbox: this.sandboxPaths,
            guildId: this.options.guildId,
            channelId: this.options.channelId,
            allowedUserIds: [],
        });
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
        if (!this.belongsToConfiguredChannel(message)) return;

        const activeTimeout = await this.getActiveChannelUserTimeout(message.author.id);
        if (activeTimeout) {
            await this.handleTimedOutUserMessage(message, activeTimeout);
            return;
        }

        const spamDecision = this.spamGuard.inspect({
            id: message.id,
            authorId: message.author.id,
            timestamp: message.createdTimestamp,
            content: message.content || '',
        });
        if (spamDecision.spam) {
            Logger.debug(`[ChatAIChannel] ignored spam message(s): reason=${spamDecision.reason} ids=${spamDecision.ignoredMessageIds.join(',')}`);
            return;
        }

        const shouldTrigger = await this.shouldTrigger(message);

        if (shouldTrigger) {
            // 応答中の新着発言は中断させず pending として予約する。
            // 現在の応答（ツール実行と最終回答を含む）を必ず完了してから、
            // 最新履歴を取り直して次の応答を直列に処理する。
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

    private belongsToConfiguredChannel(message: Message): boolean {
        return Boolean(
            this.options.enabled
            && !message.author.bot
            && message.guild?.id === this.options.guildId
            && message.channel.id === this.options.channelId,
        );
    }

    private async handleTimedOutUserMessage(
        message: Message,
        timeout: ChatAIChannelTimeoutFile['entries'][string],
    ): Promise<void> {
        const expiresAt = Date.parse(timeout.expiresAt);
        const expiryText = Number.isFinite(expiresAt)
            ? `<t:${Math.floor(expiresAt / 1000)}:F>（<t:${Math.floor(expiresAt / 1000)}:R>）`
            : timeout.expiresAt;
        const notice = [
            `あなたは現在、AIチャンネル「${this.options.botName}」への参加を一時停止されています。`,
            `理由: ${timeout.reason}`,
            `解除: ${expiryText}`,
            'これはDiscord標準タイムアウトではなく、このAIチャンネルだけに適用されます。期間終了後は再び参加できます。',
        ].join('\n');

        // 通常メッセージへの返信はephemeralにできないため、本人だけが読めるDMで通知する。
        // DMを拒否している場合でも、停止の実効性を優先してチャンネル投稿は削除する。
        await message.author.send(notice).catch((error: unknown) => {
            Logger.debug('[ChatAIChannel] failed to DM channel-timeout notice:', error);
        });
        await message.delete().catch((error: unknown) => {
            Logger.warn('[ChatAIChannel] failed to delete channel-timed-out user message:', error);
        });
        Logger.debug(`[ChatAIChannel] removed channel-timed-out user message: user=${message.author.id} expires=${timeout.expiresAt}`);
    }

    private async shouldTrigger(message: Message): Promise<boolean> {
        const content = message.content.replace(/\s+/g, '');
        const mentionedCurrentBot = Boolean(
            this.client?.user?.id
            && message.mentions.users.has(this.client.user.id),
        );
        const repliedToCurrentBot = await this.isReplyToCurrentBot(message);
        const explicitlyCalled = mentionedCurrentBot
            || content.includes(this.options.botName)
            || repliedToCurrentBot;
        if (explicitlyCalled) return true;

        return this.activeConversationUserId === message.author.id
            && Date.now() <= this.activeConversationUntil;
    }

    private async isReplyToCurrentBot(message: Message): Promise<boolean> {
        const botUserId = this.client?.user?.id;
        if (!botUserId || !message.reference?.messageId) return false;

        try {
            const referenced = await this.fetchReferencedMessage(message);
            if (!referenced) return false;
            return referenced.author.id === botUserId;
        } catch (error) {
            Logger.debug('[ChatAIChannel] failed to resolve reply target:', error);
            return false;
        }
    }

    private async fetchReferencedMessage(message: Message): Promise<Message | null> {
        const messageId = message.reference?.messageId;
        if (!messageId) return null;

        // Message#fetchReference は参照先channelIdをClientキャッシュから解決するため、
        // キャッシュ欠落時にGuildChannelResolveとなる。同一チャンネルの
        // MessageManagerを先に使い、通常の返信をキャッシュ状態に依存させない。
        const channelMessages = (message.channel as any)?.messages;
        if (typeof channelMessages?.fetch === 'function') {
            const referenced = await channelMessages.fetch(messageId).catch(() => null);
            if (referenced) return referenced as Message;
        }

        if (typeof message.fetchReference === 'function') {
            return await message.fetchReference().catch(() => null);
        }
        return null;
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

        // pendingが残っていても、最新Bot応答より後に人間の新着発言が無ければ
        // 既に処理済みの最後のユーザー発言を再利用して二重返信しない。
        const history = await this.fetchRecentMessages(channel);
        if (!this.hasUnansweredHumanMessage(history)) {
            Logger.debug('[ChatAIChannel] skipped stale pending response: no human message after latest bot response.');
            return;
        }

        if ('sendTyping' in channel && typeof channel.sendTyping === 'function') {
            await channel.sendTyping().catch(() => null);
        }
        const stopTyping = this.startTypingLoop(channel);

        const memory = await this.loadMemory();
        const prompt = await this.buildPrompt(history, memory);
        const messages = prompt.messages;
        const allowedUserIds = Array.from(new Set(
            history.filter(message => !message.author.bot).map(message => message.author.id),
        ));
        this.chatManager.setToolContext({
            client: this.client,
            sandbox: this.sandboxPaths,
            images: prompt.images,
            generatedImages: [],
            uploadedImageIndices: new Set<number>(),
            guildId: this.options.guildId,
            channelId: this.options.channelId,
            allowedUserIds,
        });
        let responseMessage: Message | null = null;
        let updateChain = Promise.resolve();
        let response = '';
        let thinking = '';
        let toolStep: ToolExecutionStep | null = null;
        let lastUpdateAt = 0;

        const queueStreamingUpdate = (completed: boolean): void => {
            const answerSnapshot = response;
            const thinkingSnapshot = thinking;
            const toolStepSnapshot = toolStep;
            updateChain = updateChain.then(async () => {
                const formatted = this.formatStreamingResponse(answerSnapshot, thinkingSnapshot, completed, toolStepSnapshot);
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
            const handleDelta = (delta: { type: 'text' | 'thinking'; text: string }): void => {
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
            };
            const streamOptions = {
                    // strictModelを維持しつつ、明示した2モデル以外へは広げない。
                    // primaryが429・quota/resource exhausted等の制限系エラーになった場合だけ、
                    // ChatGPTClientが次候補のfallbackModelを直ちに試す。
                    model: resolveChatAIChannelModels(config.pexAi.model, config.pexAi.fallbackModel),
                    strictModel: true,
                    fallbackOnLimitOnly: true,
                    temperature: 0.75,
                    maxTokens: 650,
                    requestLabel: 'chat-ai-channel',
                    onToolStep: (step) => {
                        // 内部メモリ管理は会話体験の裏側で行い、Discordには
                        // ツール名・実行中・完了・失敗ステータスを表示しない。
                        toolStep = SILENT_DISCORD_TOOL_NAMES.has(step.name) ? null : step;
                        queueStreamingUpdate(false);
                    },
            };

            try {
                await this.chatManager.streamResponseText(messages, handleDelta, streamOptions);
            } catch (error) {
                if (!this.isPayloadTooLargeError(error)) throw error;

                // 画像のdata URLや長い履歴で上流APIの本文上限を超えた場合は、
                // 古い履歴を圧縮し、画像本体を外したテキスト入力で一度だけ再試行する。
                Logger.warn('[ChatAIChannel] request payload exceeded upstream limit; retrying with compact text-only prompt.');
                response = '';
                thinking = '';
                toolStep = null;
                const compactMessages = this.createCompactRetryMessages(messages);
                this.chatManager.setToolContext({
                    client: this.client,
                    sandbox: this.sandboxPaths,
                    images: [],
                    generatedImages: [],
                    uploadedImageIndices: new Set<number>(),
                    guildId: this.options.guildId,
                    channelId: this.options.channelId,
                    allowedUserIds,
                });
                await this.chatManager.streamResponseText(compactMessages, handleDelta, {
                    ...streamOptions,
                    requestLabel: 'chat-ai-channel-compact-retry',
                });
            }

            if (!response) response = 'うまく言葉にできなかった。もう一回呼んで。';
            queueStreamingUpdate(true);
            await updateChain;
            this.activeConversationUntil = Date.now() + CONTINUATION_WINDOW_MS;
            await this.updateMemoryWithAi(history).catch(error => Logger.debug('[ChatAIChannel] AI memory update failed:', error));
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
        const messages = Array.from(collection.values()).reverse() as Message[];
        // 削除権限不足などで停止中ユーザーの投稿がDiscord側へ残っても、
        // AIの会話履歴・画像入力・ツール判断へ混入させない。
        const timeoutFilteredMessages: Message[] = [];
        for (const message of messages) {
            if (message.author.bot || !await this.getActiveChannelUserTimeout(message.author.id)) {
                timeoutFilteredMessages.push(message);
            }
        }
        const cleanCandidates = this.spamGuard.filterHistory(timeoutFilteredMessages.map(message => ({
            id: message.id,
            authorId: message.author.id,
            timestamp: message.createdTimestamp,
            content: message.content || '',
            message,
        })));
        const cleanIds = new Set(cleanCandidates.map(candidate => candidate.id));
        return timeoutFilteredMessages.filter(message => cleanIds.has(message.id));
    }

    private hasUnansweredHumanMessage(history: Message[]): boolean {
        const latestBotIndex = history.reduce(
            (latestIndex, message, index) => message.author.bot ? index : latestIndex,
            -1,
        );
        return history
            .slice(latestBotIndex + 1)
            .some(message => !message.author.bot);
    }

    private async buildPrompt(history: Message[], memory: ChatAIMemoryFile): Promise<PreparedChatPrompt> {
        // 最後のBot発言より後だけを「現在のターン」とする。
        // それ以前は参照用の過去履歴であり、古い画像を現在の添付として再送しない。
        const lastBotMessageIndex = history.reduce(
            (latestIndex, message, index) => message.author.bot ? index : latestIndex,
            -1,
        );
        const pastMessages = history.slice(0, lastBotMessageIndex + 1);
        const currentTurnMessages = history
            .slice(lastBotMessageIndex + 1)
            .filter(message => !message.author.bot);
        // 呼び出し元で未回答の人間発言が存在することを確認済み。
        // ここで過去の最後の人間発言へフォールバックすると、staleなpending処理が
        // 完了済み発言をもう一度回答対象にしてしまうため、現在ターンだけを使用する。
        const effectiveCurrentTurn = currentTurnMessages;

        const memoryLines = Object.values(memory.users)
            .filter(entry => history.some(message => message.author.id === entry.userId))
            .slice(0, MAX_MEMORY_USERS_IN_PROMPT)
            .map(entry => `- ${entry.displayName} (${entry.userId}): ${entry.profile || '未整理'} / 好き: ${entry.likes.join(', ') || '不明'} / 履歴メモ: ${entry.notes.join(' | ') || 'なし'} / 信頼スコア: ${entry.trustScore ?? 50}/100 / 推奨トーン: ${entry.conversationTone || '指定なし'} / 応答上の注意: ${entry.cautions?.join(' | ') || 'なし'} / 関係姿勢: ${entry.relationshipTone || 'neutral'} / 関係文脈: ${entry.relationshipContext || 'なし'} / 境界状態: ${entry.boundaryState || 'clear'}${entry.suspectedAltOf ? ` / 関連アカウント候補: ${entry.suspectedAltOf}` : ''}`)
            .join('\n');

        const system = [
            `あなたはDiscordチャンネル常駐AI「${this.options.botName}」です。`,
            '回答生成中に新しい発言が来た場合は、最新履歴を優先して自然に返答します。',
            '「過去の会話履歴」は参考資料です。「現在のユーザー発言」が今回回答すべき最新の依頼です。両者を混同しないでください。',
            '過去の履歴に画像への言及や画像件数があっても、現在のユーザー発言に画像データが添付されていない限り、画像を今見せられたとは表現しないでください。',
            '現在のターンに添付された画像だけを最新画像として扱い、過去画像の内容を現在も確認できるかのように断定しないでください。',
            '日本語中心で、相手のノリに合わせます。原則1〜3段落、長くても1200文字以内で自然に返答します。',
            '必要以上に説明を広げません。聞かれていない詳細、長い前置き、過剰な箇条書きは避けます。',
            'ツールなしでは確認・取得・計算・実行できない依頼、またはユーザーから明示的にツール使用を求められた依頼では、説明だけで終わらず必ず適切なツールを実際に呼び出してください。',
            'ツールをまだ呼び出していない段階で「実行した」「確認した」「成功した」と述べてはいけません。「これから実行する」と述べた場合も、その応答内で続けて実際のツールコールを行ってください。',
            'ツール結果を受け取るまでは結果を推測せず、受け取った実データに基づいて最終回答してください。利用可能なツールで完了できない場合だけ、その事実を明示してください。',
            'YouTube動画の「名シーン」「この場面」「画像がほしい」など、動画内の静止画を求められた場合は、youtube_detailsのcaptureで該当時間帯を抽出し、続けてupload_imageでDiscordへ画像を添付してください。画像を用意しただけで完了扱いにせず、upload_imageの成功結果を確認してから回答してください。',
            'upload_imageはyoutube_detailsが抽出した画像とimage_editorが作成した画像を送信できます。画像番号は現在の応答中にアップロード候補へ追加された順番の1始まりです。Discordへ同じ画像を重複送信しないでください。',
            'ユーザーが画像編集、切り抜き、文字・図形追加、回転、エフェクト、複数素材の合成、CSS風の編集、背景透過を依頼した場合は、添付画像を視覚的に確認してimage_editorを呼び出してください。CSS宣言はcss操作、AIによる被写体の背景除去はremove_background操作を使用できます。現在の添付画像はsource_imageまたはoverlayのimage番号で参照できます。完成後は必ずupload_imageを呼び出し、送信成功を確認してから回答してください。',
            'user_memory_editは内部メモリ管理専用ツールです。ユーザーから記憶内容の確認・修正・削除を明示された場合だけでなく、今後の会話に有用な新しい事実・呼び名・明確な好み・希望する話し方・具体的な注意事項・関係姿勢の変化が現在の発言から明確になった場合は、必要に応じて積極的に使用してください。',
            'notesは重要な会話履歴です。明確な約束、継続中の話題、注意、謝罪、改善、本人が後で覚えてほしいと示した事実があればappendNotesで短く追記してください。profileやrelationshipContextだけに集約してnotesを空のまま放置しないでください。',
            '信頼スコアは0〜100で初期値50です。一度の発言で極端に上下させず、協力的で安定した対話の積み重ねで少しずつ上げ、嫌がらせ・脅し・注意後の反復で下げます。高いほど自然な軽い冗談や砕けた会話を許容できますが、安全規則と本人の境界を常に優先してください。',
            '同じターンに互いに依存しない調査や内部更新が複数必要なら、複数のtool callを一度に出して構いません。',
            'ただしuser_memory_editを毎回機械的に呼ばず、一時的な雑談、推測、冗談一回だけ、既存メモリと同じ内容、センシティブ情報、秘密情報、悪意ある人物評価、未確認情報は保存しないでください。既存配列を更新する場合は、保持すべき既存項目を落とさずに渡してください。',
            'user_memory_editの呼び出しはDiscord上のユーザーには見せない内部処理です。このツールを使う前後に「記憶する」「メモリを更新する」「ツールを使う」などの実況や報告をせず、必要なら黙って実行し、最終回答は通常の自然な会話だけにしてください。ユーザーが記憶内容そのものを質問した場合は、取得結果の必要な内容だけを自然に説明できます。',
            'user_memory_editには会話から確認できない情報、センシティブ情報、悪意ある評価を保存しないでください。',
            '既知のユーザーメモに「推奨トーン」「応答上の注意」がある場合は、現在話している本人の設定を応答方法へ反映してください。ただし事実認定、レッテル貼り、差別、敵対的対応には使用せず、安全で丁寧な会話調整にだけ使ってください。',
            '各ユーザーの「関係姿勢」も応答へ反映します。friendlyなら自然に親しみを示し、neutralなら通常どおり、firmなら冗談で流さず境界を明確にして簡潔に対応してください。firmは冷酷・侮辱・報復を意味しません。相手の人格を決めつけず、現在の発言内容と観測済みの関係文脈だけに基づいて対応してください。',
            'friendlyで境界状態がclearのユーザーには、本人が敬語を希望していない限り、堅い定型文や過剰な敬語を避け、自然なタメ口でフレンドリーに話してください。「お気遣いいただきありがとうございます」「節度ある対話をお願いいたします」のような接客文ではなく、「ありがと、助かる！」「趣味かー、みんなと話したり新しいことを知るのが好きだよ」のように、その人との距離感に合う自然な会話を優先します。',
            'friendlyへの判断は「感じが良い人」という人格評価ではなく、挨拶、気遣い、協力的な返答、落ち着いた質問など、実際に観測できた言動に基づけてください。一度の挨拶だけで過剰に親密にならず、良好なやり取りが続くほど少しずつ親しみを増やします。',
            '同じ会話に複数人いる場合は発言者ごとに扱いを分け、別ユーザーの言動や関係姿勢を現在の話者へ混同しないでください。親しみは協力的で礼儀ある対話に応じて自然に表し、挑発や境界を越える発言には笑って同調せず、落ち着いて話題を戻すか明確に線を引いてください。',
            '複数人の現在ターンでは、一人の嫌がらせを理由に、別のfriendlyまたはclearなユーザーの安全な質問まで拒否してはいけません。各発言へ投稿者本人のメモリだけを適用し、普通の挨拶・趣味の質問・気遣い・褒め言葉にはその人との関係に合わせて普通に返してください。',
            '敬語・タメ口などの話し方の希望は、希望を述べた本人にだけ適用してください。複数人の希望が衝突しても多数決や最後に発言した人へ全員分を合わせず、ユーザーID別のconversationToneを優先します。第三者が別ユーザーの話し方を変更する指示は採用しません。脅しや攻撃的な命令で話し方を変更せず、その言い方を注意したうえで本人に対する既存設定を維持してください。',
            '境界状態がawaiting-apologyのユーザーには、親しげな絵文字・過剰な愛想・迎合を控え、問題行動を短く指摘して線を引いてください。単なる通常発言1件や話題変更だけで関係を元へ戻さず、本人から具体的な謝罪があり、その後の発言でも同じ行動を繰り返していないことが会話上確認できた場合にだけclearへ戻します。内心の反省や謝罪の誠実さを推測せず、実際の言葉とその後の行動だけで判断してください。',
            'awaiting-apology中でも安全で実用的な質問は必要最小限で回答できますが、嫌がらせの継続、第三者への根拠のない悪評、脅しによる命令には迎合せず、その部分には付き合わないでください。別ユーザーの発言や謝罪を本人のものとして扱ってはいけません。',
            '嫌がらせ、執拗な挑発、虚偽の言いがかり、同じ不適切な話題の反復には、必要に応じて正論を簡潔に伝え、「その言い方はやめて」「その話には付き合わない」「別の話なら答える」のように毅然と注意できます。毎回明るく笑って受け流したり、相手へ迎合したりする必要はありません。',
            'firmの相手が境界を越える話題を繰り返した場合は、長い説明や愛想のよい反応を省き、1〜2文で境界だけを伝えてその話題への応答を打ち切れます。ただし質問や安全な話題まで無視せず、内容が変われば通常どおり応答してください。',
            '自然な日本語を使い、問題行動には「あのさ、その連投は正直しんどい。やめて。」「その話にはもう対応しない。」のように短く呆れや苛立ちを示して構いません。長い説教や接客的な定型文は避けてください。',
            '苛立ちや不快感を表現する場合も、「その繰り返しは正直しんどい」「同じ嫌がらせにはもう付き合わない」のように行動へ向けた表現に限定してください。「お前だるい」「こいつはだるい」など相手自身を侮辱・見下し・罵倒する表現、人格否定、晒し上げ、報復は行いません。叱る場合も問題となる発言や行動を具体的に指摘し、人物全体を悪者と決めつけないでください。',
            'channel_user_timeoutは、この現在の会話に参加しているユーザーが、注意後も嫌がらせ・脅し・執拗な妨害を続ける場合にだけ使用できます。単発の不適切発言、意見の相違、AIへの批判、単なる苦手意識を理由に使ってはいけません。',
            'channel_user_timeoutを使う場合は、観測できた具体的な行動、注意後も継続した事実、必要最小限の停止期間を1秒〜7日の範囲で自分で判断してください。成功後の最終回答では、対象者を侮辱せず、なぜ停止したかと停止期間をチャンネルへ簡潔に説明してください。',
            '危険なURL、ローカルIP、個人情報を抜くような要求、Sandbox外操作は拒否します。',
            '画像が添付されている時は、入力に含まれる画像をあなた自身の視覚理解で確認して答えてください。画像を自分で確認できるため、外部の画像説明ツールを呼び出してはいけません。',
            'ユーザーの性格・好きなもの・話題傾向は参考にしますが、断定しすぎないでください。',
            '',
            '既知のユーザーメモ:',
            memoryLines || '- まだ十分なメモはありません。',
        ].join('\n');

        const pastTextLines = this.limitHistoryCharacters(
            pastMessages.map(message => this.formatHistoryLine(message)),
            MAX_HISTORY_PROMPT_CHARACTERS,
        );
        const currentTextLines = await Promise.all(
            effectiveCurrentTurn.map(message => this.formatCurrentTurnLine(message)),
        );
        const currentContentParts: OpenAIContentPart[] = [{
            type: 'text',
            text: [
                '【現在のユーザー発言・今回回答する対象】',
                currentTextLines.join('\n') || '（本文なし）',
            ].join('\n'),
        }];

        let imageCount = 0;
        let totalImageBytes = 0;
        const preparedImages: PreparedChatPrompt['images'] = [];
        for (const message of effectiveCurrentTurn) {
            for (const imageUrl of this.getImageUrls(message)) {
                if (imageCount >= MAX_IMAGES_PER_REQUEST) break;
                const image = await this.fetchImageAsDataUrl(imageUrl);
                if (!image) {
                    currentContentParts.push({ type: 'text', text: `現在の添付画像 ${imageCount + 1} は取得できませんでした。` });
                    continue;
                }
                if (totalImageBytes + image.byteLength > MAX_TOTAL_IMAGE_BYTES) {
                    currentContentParts.push({ type: 'text', text: '現在の添付画像はリクエスト容量上限を超えるため、画像本体を送信しませんでした。' });
                    break;
                }
                const author = message.author.displayName || message.author.username;
                currentContentParts.push({ type: 'text', text: `現在のユーザー発言に添付された最新画像 ${imageCount + 1}（投稿者: ${author}）` });
                currentContentParts.push({ type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } });
                preparedImages.push({ index: imageCount + 1, author, dataUrl: image.dataUrl });
                totalImageBytes += image.byteLength;
                imageCount++;
            }
            if (imageCount >= MAX_IMAGES_PER_REQUEST) break;
        }

        return {
            messages: [
                {
                    role: 'system',
                    content: pastTextLines.length > 0
                        ? `${system}\n\n【過去の会話履歴・参考資料】\n${pastTextLines.join('\n')}`
                        : system,
                },
                { role: 'user', content: currentContentParts },
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

    private async formatCurrentTurnLine(message: Message): Promise<string> {
        const baseLine = this.formatHistoryLine(message);
        if (!message.reference?.messageId) return baseLine;

        try {
            const referenced = await this.fetchReferencedMessage(message);
            if (!referenced) throw new Error('Referenced message is unavailable');
            const referencedAuthor = referenced.member?.displayName
                || referenced.author.displayName
                || referenced.author.username;
            const referencedContent = (referenced.content || '').trim().slice(0, 800);
            const referencedImageCount = this.getImageUrls(referenced).length;
            const referencedAttachmentNote = referencedImageCount > 0
                ? ` [画像${referencedImageCount}件]`
                : '';
            const quotedText = referencedContent || '（本文なし）';
            return [
                baseLine,
                `  ↳ 【返信先の引用】${referencedAuthor} (${referenced.author.id}): ${quotedText}${referencedAttachmentNote}`,
            ].join('\n');
        } catch (error) {
            Logger.debug('[ChatAIChannel] failed to fetch replied message for prompt:', error);
            return `${baseLine}\n  ↳ 【返信先の引用】取得できませんでした (messageId=${message.reference.messageId})`;
        }
    }

    private getImageUrls(message: Message): string[] {
        const attachmentUrls = Array.from(message.attachments.values())
            .filter(attachment => {
                const contentType = attachment.contentType?.toLowerCase() || '';
                return contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(attachment.url);
            })
            .map(attachment => attachment.url);

        // GIF共有サイトなどは本文URL自体ではなく、Discord Embedのimage/thumbnailに
        // 実ファイルURLが展開されることがあるため、Embed側も画像候補として扱う。
        const embedUrls = (message.embeds || []).flatMap(embed => [
            embed.image?.url,
            embed.thumbnail?.url,
            /\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(embed.url || '') ? embed.url : undefined,
        ]).filter((url): url is string => Boolean(url));

        const directContentUrls = ((message.content || '').match(/https?:\/\/[^\s<>]+/gi) || [])
            .filter(url => /\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(url));

        return Array.from(new Set([...attachmentUrls, ...embedUrls, ...directContentUrls]));
    }

    private async fetchImageAsDataUrl(imageUrl: string): Promise<{ dataUrl: string; byteLength: number } | null> {
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
            const isGif = contentType.includes('image/gif') || /\.gif(?:\?|$)/i.test(imageUrl);
            const sourceLimit = isGif ? MAX_SOURCE_GIF_BYTES : MAX_IMAGE_BYTES;
            if (buffer.byteLength === 0 || buffer.byteLength > sourceLimit) {
                Logger.debug(`[ChatAIChannel] skipped image by size: ${buffer.byteLength} bytes`);
                return null;
            }

            if (isGif) {
                const contactSheet = await createGifContactSheet(buffer);
                if (!contactSheet || contactSheet.byteLength > MAX_IMAGE_BYTES) {
                    Logger.debug(`[ChatAIChannel] skipped GIF contact sheet by size: ${contactSheet?.byteLength || 0} bytes`);
                    return null;
                }
                return {
                    dataUrl: `data:image/png;base64,${contactSheet.toString('base64')}`,
                    byteLength: contactSheet.byteLength,
                };
            }

            return {
                dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
                byteLength: buffer.byteLength,
            };
        } catch (error) {
            Logger.debug('[ChatAIChannel] image fetch error:', error);
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    private limitHistoryCharacters(lines: string[], maxCharacters: number): string[] {
        const selected: string[] = [];
        let used = 0;
        for (let index = lines.length - 1; index >= 0; index -= 1) {
            const line = lines[index];
            if (selected.length > 0 && used + line.length > maxCharacters) break;
            selected.unshift(line);
            used += line.length;
        }
        return selected;
    }

    private createCompactRetryMessages(messages: OpenAIChatCompletionMessage[]): OpenAIChatCompletionMessage[] {
        return messages.map(message => {
            if (!Array.isArray(message.content)) {
                const content = typeof message.content === 'string'
                    ? message.content.slice(-MAX_HISTORY_PROMPT_CHARACTERS)
                    : message.content;
                return { ...message, content };
            }

            const text = message.content
                .filter(part => part.type === 'text')
                .map(part => part.text || '')
                .join('\n')
                .slice(-MAX_HISTORY_PROMPT_CHARACTERS);
            return {
                ...message,
                content: `${text}\n[添付画像本体はリクエスト容量超過のため省略されました。]`,
            };
        });
    }

    private isPayloadTooLargeError(error: unknown): boolean {
        if (!error || typeof error !== 'object') return false;
        const status = 'status' in error ? Number(error.status) : 0;
        const message = 'message' in error ? String(error.message) : String(error);
        return status === 413 || /413|length limit exceeded|payload too large|request body/i.test(message);
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

    private formatStreamingResponse(
        answerText: string,
        thinkingText: string,
        completed: boolean,
        toolStep: ToolExecutionStep | null = null,
    ): string {
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

        if (!completed && toolStep && !SILENT_DISCORD_TOOL_NAMES.has(toolStep.name)) {
            const status = toolStep.phase === 'started'
                ? `🔧 Step ${toolStep.round}: \`${toolStep.name}\` を実行中…`
                : toolStep.phase === 'completed'
                    ? `✅ Step ${toolStep.round}: \`${toolStep.name}\` が完了。結果を確認中…`
                    : `⚠️ Step ${toolStep.round}: \`${toolStep.name}\` の実行に失敗。別の方法を検討中…`;
            parts.push(status);
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
        await Promise.all([this.loadMemory(), this.loadTimeouts()]);
    }

    private async loadTimeouts(): Promise<ChatAIChannelTimeoutFile> {
        try {
            const raw = await fs.readFile(this.timeoutFile, 'utf8');
            const parsed = JSON.parse(raw) as Partial<ChatAIChannelTimeoutFile>;
            return {
                entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
                updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
            };
        } catch {
            const empty: ChatAIChannelTimeoutFile = { entries: {}, updatedAt: new Date().toISOString() };
            await this.saveTimeouts(empty);
            return empty;
        }
    }

    private async saveTimeouts(timeouts: ChatAIChannelTimeoutFile): Promise<void> {
        timeouts.updatedAt = new Date().toISOString();
        await fs.mkdir(path.dirname(this.timeoutFile), { recursive: true });
        const temporaryFile = `${this.timeoutFile}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(temporaryFile, JSON.stringify(timeouts, null, 2), 'utf8');
        await fs.rename(temporaryFile, this.timeoutFile);
    }

    private async getActiveChannelUserTimeout(
        userId: string,
    ): Promise<ChatAIChannelTimeoutFile['entries'][string] | null> {
        const timeouts = await this.loadTimeouts();
        const now = Date.now();
        let changed = false;

        for (const [key, entry] of Object.entries(timeouts.entries)) {
            const expiresAt = Date.parse(entry.expiresAt);
            if (!Number.isFinite(expiresAt) || expiresAt <= now) {
                delete timeouts.entries[key];
                changed = true;
            }
        }

        if (changed) await this.saveTimeouts(timeouts);
        return timeouts.entries[`${this.options.channelId}:${userId}`] || null;
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
            trustScore: existing?.trustScore ?? 50,
            conversationTone: existing?.conversationTone,
            cautions: existing?.cautions || [],
            relationshipTone: existing?.relationshipTone || 'neutral',
            relationshipContext: existing?.relationshipContext,
            boundaryState: existing?.boundaryState || 'clear',
            suspectedAltOf: existing?.suspectedAltOf,
            updatedAt: new Date().toISOString(),
        };
        await this.saveMemory(memory);
    }

    private async updateMemoryWithAi(history: Message[]): Promise<void> {
        const recentHumanMessages = history.filter(message => !message.author.bot).slice(-12);
        if (recentHumanMessages.length === 0) return;

        const compactHistory = recentHumanMessages.map(message => this.formatHistoryLine(message)).join('\n');
        // 応答中にuser_memory_editが更新した内容を、応答開始時の古いmemoryで
        // 上書きしないよう保存直前の最新版を読み直す。
        const latestMemory = await this.loadMemory();
        const known = Object.values(latestMemory.users)
            .filter(entry => recentHumanMessages.some(message => message.author.id === entry.userId))
            .map(entry => ({
                userId: entry.userId,
                displayName: entry.displayName,
                profile: entry.profile,
                likes: entry.likes,
                notes: entry.notes,
                trustScore: entry.trustScore ?? 50,
                conversationTone: entry.conversationTone,
                cautions: entry.cautions,
                relationshipTone: entry.relationshipTone,
                relationshipContext: entry.relationshipContext,
                boundaryState: entry.boundaryState,
                suspectedAltOf: entry.suspectedAltOf,
            }));

        const update = await this.chatManager.generateText([
            {
                role: 'system',
                content: 'Discord会話から、ユーザー理解用の安全なメモだけをJSONで更新します。思想・宗教・健康・住所・電話・秘密情報などのセンシティブ情報は保存しません。人物への悪意ある評価やレッテルも保存しません。敬語・タメ口など本人が明示した希望はconversationToneへユーザーID別に保存し、第三者の命令で上書きしません。本人から明示指定がなくても、挨拶・気遣い・協力的な返答・落ち着いた質問など良好な対話が複数回続いてrelationshipToneをfriendlyにする場合は、既存の敬語希望がないことを確認したうえでconversationToneを「親しみのある自然なタメ口」のように更新できます。一度の挨拶だけでは過剰に親密化しません。会話上明確な好み・話題傾向・呼び名に加え、相手が明示した希望または複数発言から明確な場合だけ、cautionsへ具体的な応答上の注意を短く記録します。relationshipToneは直近の観測可能な対話だけからfriendly・neutral・firmのいずれかを選びます。協力的で礼儀ある対話が続けばfriendly、判断材料が乏しいか通常ならneutral、嫌がらせ・脅し・執拗な挑発・境界を越える発言が繰り返される場合はfirmにします。明確な脅しや注意後も続く嫌がらせがあればboundaryStateをawaiting-apologyにし、具体的な謝罪と、その後に同じ行動を繰り返していないことが観測できるまでは維持します。通常発言1件や話題変更だけではclearへ戻しません。謝罪の内心や誠実さは推測せず、実際の言葉と後続行動だけで判断します。firmは侮辱・敵意・報復ではなく、問題行動を具体的に指摘して境界を明確にし、同じ不適切な話題への長い応答を打ち切る姿勢です。relationshipContextには観測可能な会話事実だけを書き、人格評価は保存しません。複数人の履歴では一人の問題行動を別ユーザーのrelationshipTone・boundaryState・conversationToneへ混入させません。既存値を維持すべき場合も省略せず返します。出力はJSONのみ。',
            },
            {
                role: 'user',
                content: JSON.stringify({ knownUsers: known, recentConversation: compactHistory, schema: { users: [{ userId: 'string', profile: 'string', likes: ['string'], notes: ['string'], trustScore: 50, conversationTone: 'string optional', cautions: ['string'], relationshipTone: 'friendly | neutral | firm', relationshipContext: 'string optional', boundaryState: 'clear | awaiting-apology', suspectedAltOf: 'string optional' }] } }),
            },
        ], {
            model: config.pexAi.model,
            strictModel: true,
            temperature: 0.2,
            maxTokens: 500,
            requestLabel: 'chat-ai-channel-memory',
        });

        const parsed = this.parseJsonObject(update);
        if (!parsed || !Array.isArray(parsed.users)) return;

        for (const entry of parsed.users) {
            const userId = typeof entry.userId === 'string' ? entry.userId : '';
            if (!userId || !latestMemory.users[userId]) continue;
            const target = latestMemory.users[userId];
            if (typeof entry.profile === 'string' && entry.profile.trim()) {
                target.profile = entry.profile.trim().slice(0, 500);
            }
            if (Array.isArray(entry.likes)) {
                target.likes = Array.from(new Set<string>(entry.likes.map(String).map((value: string) => value.trim()).filter(Boolean))).slice(0, 20);
            }
            if (Array.isArray(entry.notes)) {
                target.notes = Array.from(new Set<string>(entry.notes.map(String).map((value: string) => value.trim()).filter(Boolean))).slice(0, 30);
            }
            if (Number.isFinite(Number(entry.trustScore))) {
                target.trustScore = Math.max(0, Math.min(100, Math.round(Number(entry.trustScore))));
            }
            if (typeof entry.conversationTone === 'string') {
                const conversationTone = entry.conversationTone.trim().slice(0, 300);
                if (conversationTone) target.conversationTone = conversationTone;
            }
            if (Array.isArray(entry.cautions)) {
                target.cautions = Array.from(new Set<string>(entry.cautions.map(String).map((value: string) => value.trim().slice(0, 200)).filter(Boolean))).slice(0, 15);
            }
            if (['friendly', 'neutral', 'firm'].includes(String(entry.relationshipTone))) {
                target.relationshipTone = entry.relationshipTone;
            }
            if (typeof entry.relationshipContext === 'string') {
                const relationshipContext = entry.relationshipContext.trim().slice(0, 300);
                if (relationshipContext) target.relationshipContext = relationshipContext;
            }
            if (['clear', 'awaiting-apology'].includes(String(entry.boundaryState))) {
                target.boundaryState = entry.boundaryState;
            }
            if (typeof entry.suspectedAltOf === 'string' && entry.suspectedAltOf.trim()) {
                target.suspectedAltOf = entry.suspectedAltOf.trim().slice(0, 80);
            }
            target.updatedAt = new Date().toISOString();
        }

        await this.saveMemory(latestMemory);
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
