// src/commands/staff/subcommands/ai.ts
import { ChatInputCommandInteraction, MessageFlags, DiscordAPIError } from 'discord.js';
import { OpenAIChatManager } from '../../../core/OpenAIChatManager';
import { OpenAIChatCompletionMessage, OpenAIChatCompletionChunk } from '../../../types/openai';
import { statusToolDefinition, statusToolHandler, weatherToolDefinition, weatherToolHandler, timeToolDefinition, timeToolHandler, countPhraseToolDefinition, countPhraseToolHandler, userInfoToolDefinition, userInfoToolHandler, memoListDefinition, memoListHandler, memoGetDefinition, memoGetHandler, memoCreateDefinition, memoCreateHandler, memoUpdateDefinition, memoUpdateHandler, memoDeleteDefinition, memoDeleteHandler, memoSearchDefinition, memoSearchHandler } from './ai-tools';
import { PdfRAGManager } from '../../../core/PdfRAGManager';
import { database } from '../../../core/Database.js';

// レート制限の設定
const userRateLimits = new Map<string, { lastUsed: number, count: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1分間のウィンドウ
const MAX_REQUESTS_PER_WINDOW = 3; // 1分間に最大3リクエスト
const UPDATE_INTERVAL = 500; // Discord APIレート制限を避けるため500ミリ秒ごとに更新

// このコマンドはオプションでカスタムの system prompt を受け取れます。
// - `system_prompt` を与えると、デフォルトの安全プロンプトとマージされます。
// - `safety` を true にすると、ユーザー指示は補助的に扱われ、より厳格に安全性を保ちます。
export const subcommandHandler = {
    name: 'ai',
    description: 'AIにメッセージを送信し、ストリーミングレスポンスを取得します',

    builder: (subcommand: any) => {
        return subcommand
            .setName('ai')
            .setDescription('AIにメッセージを送信し、ストリーミングレスポンスを取得します')
            .addStringOption((opt: any) =>
                opt.setName('prompt')
                    .setDescription('AIに送信するプロンプト')
                    .setRequired(false)
            )
            .addAttachmentOption((opt: any) =>
                opt.setName('attachment')
                    .setDescription('添付ファイル (JSON, text, JS, TSなど。動画は未対応)')
                    .setRequired(false)
            )
            .addBooleanOption((opt: any) =>
                opt.setName('export_dataset')
                    .setDescription('（任意）このサーバーの会話 dataset を JSON でダウンロードします（staff専用）')
                    .setRequired(false)
            )

            .addStringOption((opt: any) =>
                opt.setName('system_prompt')
                    .setDescription('（任意）システムプロンプトを追加・上書きします（安全性のためサニタイズされます）')
                    .setRequired(false)
            )

            .addBooleanOption((opt: any) =>
                opt.setName('safety')
                    .setDescription('（任意）true にするとユーザーの system_prompt を補助的に扱います（保守的モード）')
                    .setRequired(false)
            );
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const userId = interaction.user.id;

        // レート制限のチェック
        if (isRateLimited(userId)) {
            await interaction.reply({
                content: '⚠️ レート制限に達しました。しばらく待ってから再試行してください。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const prompt = interaction.options.getString('prompt', false);
        const exportDataset = interaction.options.getBoolean('export_dataset', false);

        // dataset のエクスポートがリクエストされている場合はそれを優先して送信
        if (exportDataset) {
            const guildId = interaction.guild?.id || 'global';
            try {
                const dataset = await getConversationDataset(guildId, 100);
                const buffer = Buffer.from(JSON.stringify(dataset, null, 2), 'utf-8');
                await interaction.reply({ content: `📥 dataset (${dataset.length} 件)`, files: [{ attachment: buffer, name: `dataset_${guildId}_${Date.now()}.json` }], flags: MessageFlags.Ephemeral });
                return;
            } catch (err) {
                console.error('dataset export error:', err);
                await interaction.reply({ content: '❌ dataset の取得に失敗しました。', flags: MessageFlags.Ephemeral });
                return;
            }
        }

        const attachment = interaction.options.getAttachment('attachment');

        // prompt と attachment を受け取ったらすぐに defer してインタラクションの期限切れを防止
        await interaction.deferReply();

        // 安全なレスポンス関数: interaction が期限切れの場合は followUp、さらに失敗したらチャンネルに直接送信してフォールバックする
        async function safeRespond(payload: { content?: string; files?: any[]; ephemeral?: boolean }) {
            // contentが空の場合はデフォルトメッセージを設定
            if (!payload.content || payload.content.trim() === '') {
                payload.content = '（応答が空でした）';
            }

            try {
                // まず編集を試みる（既に返信がある想定）
                await interaction.editReply({ content: payload.content, files: payload.files });
                return;
            } catch (err: any) {
                // Unknown interaction や期限切れの場合、followUp かチャンネル送信でフォールバック
                try {
                    await interaction.followUp({ content: payload.content || '', files: payload.files, ephemeral: payload.ephemeral });
                    return;
                } catch (followErr: any) {
                    // 最終フォールバック: チャンネルに直接送信（パブリック）
                    try {
                        const channel = interaction.channel;
                        if (channel && 'send' in channel) {
                            // @ts-ignore send exists
                            await (channel as any).send({ content: payload.content || '', files: payload.files });
                            return;
                        }
                    } catch (chErr: any) {
                        console.error('safeRespond: final channel send failed', chErr);
                    }
                }
            }
        }

        // 会話履歴の取得と処理
        let conversationHistory: string = '';
        try {
            const messages = await interaction.channel?.messages.fetch({ limit: 50 });
            if (messages) {
                const recentMessages = Array.from(messages.values())
                    .filter(msg => msg.createdTimestamp > Date.now() - 3600000) // 1時間以内のメッセージ
                    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                    .slice(-20); // 最新20件

                // 最新の会話履歴を取得して含める（連続投稿が5件必要、という厳しい条件は廃止）
                // 過度に長くならないよう、最大メッセージ数と最大文字数で切り詰める
                const MAX_HISTORY_MESSAGES = 20;
                const MAX_HISTORY_CHARS = 1500;

                const historySlice = recentMessages.slice(-MAX_HISTORY_MESSAGES);
                if (historySlice.length > 0) {
                    conversationHistory = historySlice
                        .map(msg => {
                            const display = (msg as any).member?.displayName || msg.author.username;
                            return `${display}: ${msg.content}`;
                        })
                        .join('\n')
                        .substring(0, MAX_HISTORY_CHARS);

                    conversationHistory = `会話履歴:\n${conversationHistory}\n\n`;
                }
            }
        } catch (error) {
            console.error('会話履歴の取得中にエラーが発生:', error);
            // エラーが発生しても続行
        }

        // 添付ファイルの処理
        let attachmentContent: string | any[] | null = null;
        const rag = new PdfRAGManager();
        if (attachment) {
            // 動画ファイルのチェック
            if (attachment.contentType?.startsWith('video/')) {
                await safeRespond({ content: '❌ 動画ファイルは未対応です。JSON、テキスト、JS、TS、画像ファイルのみ対応しています。', ephemeral: true });
                return;
            }

            // 画像ファイルの場合
            if (attachment.contentType?.startsWith('image/')) {
                attachmentContent = [
                    { type: 'text', text: `添付画像: ${attachment.name}` },
                    { type: 'image_url', image_url: { url: attachment.url, detail: 'auto' } }
                ];
            }
            // PDFファイルの場合 — RAG フローで扱う
            else if (attachment.contentType === 'application/pdf' || attachment.name?.toLowerCase().endsWith('.pdf')) {
                try {
                    const resp = await fetch(attachment.url);
                    if (!resp.ok) throw new Error(`Failed to fetch PDF: ${resp.status}`);
                    const arrayBuffer = await resp.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    // Index the PDF (idempotent: re-index will replace existing entries for same file hash)
                    const { fileId, chunksIndexed } = await rag.indexPdfBuffer(buffer);
                    console.info(`Indexed PDF ${attachment.name} -> ${chunksIndexed} chunks (fileId=${fileId})`);

                    // Query relevant chunks for current prompt (prompt がない場合は関連検索をスキップ)
                    if (prompt) {
                        const relevant = await rag.queryRelevant(prompt, 3);
                        if (relevant && relevant.length > 0) {
                            // プレフィックスとして関連チャンクを挿入
                            const ragText = relevant.map(r => `【関連】(score:${r.score.toFixed(3)}) ${r.text}`).join('\n\n');
                            attachmentContent = `添付PDF (${attachment.name}) の関連情報:\n\n${ragText}`;
                        } else {
                            attachmentContent = `添付PDF (${attachment.name}): (関連情報なし)`;
                        }
                    } else {
                        attachmentContent = `添付PDF (${attachment.name}): (関連情報なし)`;
                    }
                } catch (err) {
                    console.error('PDF RAG 処理エラー:', err);
                    await safeRespond({ content: '❌ 添付PDFの処理中にエラーが発生しました。', ephemeral: true });
                    return;
                }
            } else {
                // テキストベースのファイルの場合
                try {
                    // ファイルをダウンロードして内容を取得
                    const response = await fetch(attachment.url);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch attachment: ${response.status}`);
                    }
                    const content = await response.text();

                    // サイズチェック（トークン制限を避けるため）
                    if (content.length > 10000) { // 約10KB
                        await interaction.reply({
                            content: '❌ 添付ファイルが大きすぎます。10KB以内のファイルのみ対応しています。',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    attachmentContent = `添付ファイル (${attachment.name}):\n\`\`\`\n${content}\n\`\`\``;
                } catch (error) {
                    console.error('添付ファイルのダウンロード中にエラーが発生:', error);
                    await safeRespond({ content: '❌ 添付ファイルの処理中にエラーが発生しました。', ephemeral: true });
                    return;
                }
            }
        }

        const chatManager = new OpenAIChatManager();

        // >> ツールを登録 <<
        // ステータス検知
        chatManager.registerTool(statusToolDefinition, statusToolHandler);
        // 天気予報
        chatManager.registerTool(weatherToolDefinition, weatherToolHandler);
        // 時刻取得
        chatManager.registerTool(timeToolDefinition, timeToolHandler);
        // フレーズカウント
        chatManager.registerTool(countPhraseToolDefinition,countPhraseToolHandler);
        // ユーザー情報取得
        chatManager.registerTool(userInfoToolDefinition, userInfoToolHandler);

        // メモ管理ツール（create, list, get, update, delete, search）
        chatManager.registerTool(memoListDefinition, memoListHandler);
        chatManager.registerTool(memoGetDefinition, memoGetHandler);
        chatManager.registerTool(memoCreateDefinition, memoCreateHandler);
        chatManager.registerTool(memoUpdateDefinition, memoUpdateHandler);
        chatManager.registerTool(memoDeleteDefinition, memoDeleteHandler);
        chatManager.registerTool(memoSearchDefinition, memoSearchHandler);

        // ツール実行時のコンテキストとして interaction を設定
        chatManager.setToolContext(interaction);

        // カスタム system prompt と安全化オプションの取得
        const userSystemPrompt = interaction.options.getString('system_prompt', false);
        const safetyOverride = interaction.options.getBoolean('safety', false);

        // ギルド絵文字の取得
        let emojiInfo = '';
        if (interaction.guild) {
            const guildEmojis = interaction.guild.emojis.cache;
            if (guildEmojis.size > 0) {
                const emojiList = guildEmojis.map(emoji => {
                    return `${emoji.animated ? '<a:' : '<:'}${emoji.name}:${emoji.id}>`;
                }).join(' ');
                emojiInfo = `\n\n# 利用可能なギルド絵文字\nこのサーバーには以下のカスタム絵文字が設定されています。適切な場面で自由に使用できます:\n${emojiList}`;
            }
        }

        // デフォルトの安全な system prompt
        const defaultSystemPrompt = `あなたは役立つアシスタントです。回答は正確かつスピーディにそしてよりフレンドリーに行って下さい。よく分からない意図が不明の場合は聞き直して下さい。

# 重要な応答ルール
- 会話履歴は文脈理解のために提供されますが、応答時にタイムスタンプ（例: [10/13/2025, 10:01:00 PM]）やユーザー名のプレフィックス（例: PEXserver:）を含めないでください
- あなたの応答は直接的なメッセージ内容のみにしてください
- 会話履歴の形式を真似せず、自然な会話として応答してください${emojiInfo}`;

        // ユーザーが提供した system prompt をサニタイズしてマージ
        const mergedSystemPrompt = mergeSystemPrompts(defaultSystemPrompt, userSystemPrompt, safetyOverride === true);

        // AIへのメッセージを準備（systemはマージされたプロンプト）
        // recentMessages を OpenAI の個別メッセージ（role を付与）に変換して渡す
        const historyMessages: OpenAIChatCompletionMessage[] = [];

        // 再取得せず、先に作成した historySlice 相当の recentMessages を使って構築する
        try {
            const fetched = await interaction.channel?.messages.fetch({ limit: 50 });
            if (fetched) {
                const recentMessages = Array.from(fetched.values())
                    .filter(msg => msg.createdTimestamp > Date.now() - 3600000)
                    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                    .slice(-20);

                const historySlice = recentMessages.slice(-10); // MAX_HISTORY_MESSAGES と合わせて10
                
                // 会話履歴がある場合、system メッセージに説明を追加
                if (historySlice.length > 0) {
                    historyMessages.push({
                        role: 'system',
                        content: '以下は会話の文脈理解のための履歴です。各メッセージは [タイムスタンプ] ユーザー名: メッセージ の形式ですが、これは参考情報であり、あなたの応答にこの形式を含めないでください。'
                    });
                }
                
                for (const msg of historySlice) {
                    const display = (msg as any).member?.displayName || msg.author.username;
                    const role = msg.author.bot ? 'assistant' : 'user';
                    // タイムスタンプをローカル表記で付与（フォールバックは ISO）
                    const timeStr = new Date(msg.createdTimestamp).toLocaleString();
                    // include display name and timestamp so AI can see who said what and when
                    historyMessages.push({ role: role as any, content: `[${timeStr}] ${display}: ${msg.content}` });
                }

                // チャンネルからの履歴が不足している場合は永続化データセットから補う（最大10件）
                if (historyMessages.length === 0) {
                    try {
                        const guildId = interaction.guild?.id || 'global';
                        const dataset = await getConversationDataset(guildId, 10);
                        if (dataset && dataset.length > 0) {
                            historyMessages.push({
                                role: 'system',
                                content: '以下は過去の会話ログです。文脈理解のための参考情報として扱ってください。'
                            });
                            for (const entry of dataset) {
                                const time = new Date(entry.timestamp).toLocaleString();
                                historyMessages.push({ role: 'user', content: `[${time}] ${entry.userName || entry.userId}: ${entry.prompt}` });
                                if (entry.response) historyMessages.push({ role: 'assistant', content: entry.response });
                            }
                        }
                    } catch (dsErr) {
                        console.error('dataset retrieval error:', dsErr);
                    }
                }
            }
        } catch (e) {
            // fetch 失敗時は conversationHistory の文字列を fallback として使う
            if (conversationHistory) {
                // フォールバック時にも説明を追加
                historyMessages.push({
                    role: 'system',
                    content: '以下は会話の文脈理解のための履歴です。各メッセージは [タイムスタンプ] ユーザー名: メッセージ の形式ですが、これは参考情報であり、あなたの応答にこの形式を含めないでください。'
                });
                
                const lines = conversationHistory.split('\n').filter(l => l.trim() !== '' && !l.startsWith('会話履歴:'));
                for (const line of lines) {
                    // フォールバック行は "Name: message" または "[time] Name: message" の可能性がある
                    const idx = line.indexOf(':');
                    if (idx > 0) {
                        const left = line.substring(0, idx).trim();
                        const text = line.substring(idx + 1).trim();
                        // left が [time] Name 形式かどうかをチェック
                        const timeMatch = left.match(/^\[(.+?)\]\s*(.+)$/);
                        if (timeMatch) {
                            const time = timeMatch[1];
                            const name = timeMatch[2];
                            historyMessages.push({ role: 'user', content: `[${time}] ${name}: ${text}` });
                        } else {
                            historyMessages.push({ role: 'user', content: `${left}: ${text}` });
                        }
                    } else {
                        historyMessages.push({ role: 'user', content: line });
                    }
                }
            }
        }

        // 最後に現在のユーザープロンプトを user メッセージとして追加
        const userContentText = `### ユーザープロンプト\n${prompt}`;

        const messages: OpenAIChatCompletionMessage[] = [
            { role: 'system', content: mergedSystemPrompt },
            ...historyMessages,
            { role: 'user', content: userContentText }
        ];

        // 添付ファイルの内容を追加
        if (attachment && attachmentContent) {
            if (Array.isArray(attachmentContent)) {
                const imagePart = attachmentContent[1];
                messages.push({ role: 'user', content: `[添付画像: ${imagePart.image_url?.url || 'image'}]` });
            } else {
                // テキストファイルの場合は別の user メッセージとして追加
                messages.push({ role: 'user', content: attachmentContent });
            }
        }

        // レスポンスを蓄積
        let responseContent = '';
        let lastUpdateTime = Date.now();
        let isCompleted = false;
        let interactionExpired = false;

        try {
            // ストリーミングレスポンスを追加（まず GPT-4o を試す）
            let modelToUse = 'gpt-4o';

            const attemptStream = async (model: string) => {
                await chatManager.streamMessage(
                    messages,
                    (chunk: OpenAIChatCompletionChunk) => {
                        if (chunk.choices[0]?.delta?.content) {
                            responseContent += chunk.choices[0].delta.content;

                            // 定期的にメッセージを更新（インタラクションが有効な場合のみ）
                            const now = Date.now();
                            if (now - lastUpdateTime >= UPDATE_INTERVAL && !interactionExpired) {
                                lastUpdateTime = now;
                                updateDiscordMessage(interaction, formatResponse(responseContent));
                            }
                        }
                    },
                    { temperature: 0.7, model: model }
                );
            };

            try {
                await attemptStream(modelToUse);
            } catch (error: any) {
                if (error.message.includes('RateLimitReached') && modelToUse === 'gpt-4o') {
                    console.log('GPT-4o がレート制限に達したため、GPT-4o-mini に切り替え');
                    modelToUse = 'gpt-4o-mini';
                    responseContent = ''; // レスポンスをリセット
                    lastUpdateTime = Date.now();
                    await attemptStream(modelToUse);
                } else {
                    throw error; // 再スロー
                }
            }

            // 完了としてマーク
            isCompleted = true;

            // コードブロックを検知してファイル化
            const { cleanedResponse, codeFiles } = processCodeBlocks(responseContent);

            // 最終的な完全なレスポンスで更新（インタラクションが有効な場合のみ）
            // 完了レスポンスを安全に送信（期限切れ等は safeRespond がフォールバックする）
            await safeRespond({ content: cleanedResponse, files: codeFiles.length > 0 ? codeFiles : undefined, ephemeral: interactionExpired });

            // 会話をデータセットに保存（最新100件に切り詰め）
            try {
                await saveConversationDatasetEntry(interaction, prompt, cleanedResponse, /* incomplete */ false);
            } catch (dbErr) {
                console.error('dataset save error:', dbErr);
            }

        } catch (error: any) {
            console.error('AIストリームでエラーが発生:', error);

            // コンテンツフィルタ (Azure/OpenAI) による失敗を検出
            const messageStr = typeof error === 'string' ? error : error?.message || '';
            const isContentFilterError = messageStr.includes('content_filter') || messageStr.includes('ResponsibleAIPolicyViolation');

            if (isContentFilterError) {
                // ユーザへ通知
                try {
                    await safeRespond({ content: '⚠️ 入力がコンテンツポリシーに抵触したためリクエストが拒否されました。過激な表現・自己傷害・ヘイト表現・暴力表現などが含まれている可能性があります。入力を修正するか、より穏当な表現で再試行してください。', ephemeral: true });
                } catch (e) {
                    console.error('safeRespond エラー (content_filter):', e);
                }

                // 自動サニタイズして再試行を試みる（保守的モード）
                try {
                    const sanitized = sanitizeForContentFilter(prompt);
                    if (sanitized && sanitized !== prompt) {
                        const sanitizedUserContentText = `### ユーザープロンプト\n${sanitized}`;
                        // 再構築: system を保守的モードにして、最新の user メッセージを置換
                        const retryMessages = messages.map(m => ({ ...m }));
                        if (retryMessages.length > 0) retryMessages[0] = { role: 'system', content: mergeSystemPrompts(defaultSystemPrompt, null, true) };
                        // find last user message that starts with '### ユーザープロンプト'
                        for (let i = retryMessages.length - 1; i >= 0; i--) {
                            // 修正: 要素を一時変数に取り出してから content を安全にチェックする
                            const entry = retryMessages[i];
                            const content = entry?.content;
                            if (entry?.role === 'user' && typeof content === 'string' && content.startsWith('### ユーザープロンプト')) {
                                retryMessages[i] = { role: 'user', content: sanitizedUserContentText };
                                break;
                            }
                        }

                        // 試行: 安全にストリーム（簡易: model を gpt-4o-mini に切り替える）
                        try {
                            responseContent = '';
                            await chatManager.streamMessage(retryMessages, (chunk: OpenAIChatCompletionChunk) => {
                                if (chunk.choices[0]?.delta?.content) {
                                    responseContent += chunk.choices[0].delta.content;
                                    const now2 = Date.now();
                                    if (now2 - lastUpdateTime >= UPDATE_INTERVAL && !interactionExpired) {
                                        lastUpdateTime = now2;
                                        updateDiscordMessage(interaction, formatResponse(responseContent));
                                    }
                                }
                            }, { temperature: 0.7, model: 'gpt-4o-mini' });

                            // 成功したら送信
                            await safeRespond({ content: formatResponse(responseContent, true) });
                            isCompleted = true;
                            try {
                                await saveConversationDatasetEntry(interaction, sanitized, responseContent, false);
                            } catch (dbErr) {
                                console.error('dataset save error:', dbErr);
                            }
                            return; // 正常終了
                        } catch (retryErr) {
                            console.error('自動サニタイズ再試行に失敗:', retryErr);
                            // 以降は通常のエラーハンドリングにフォールバックする
                        }
                    }
                } catch (sanErr) {
                    console.error('sanitize/retry エラー:', sanErr);
                }

                // 再試行ができなかった／失敗した場合はここで終了
                return;
            }

            // OpenAIのレート制限エラーを検知して適切なメッセージを表示
            let errorMessage = '❌ リクエストの処理中にエラーが発生しました。';
            if (error instanceof Error && error.message.includes('RateLimitReached')) {
                errorMessage = '⚠️ OpenAIのレート制限に達しました。1日あたり50リクエストの制限を超えています。しばらく待ってから再試行してください。';
            }

            // インタラクションが無効になった場合のエラーハンドリング
            if (error instanceof DiscordAPIError && error.code === 10062) {
                interactionExpired = true;
                try {
                    await safeRespond({ content: `${errorMessage}\n\n最終結果:\n\n${formatResponse(responseContent, true)}`, ephemeral: true });
                } catch (followUpError) {
                    console.error('safeRespond エラー:', followUpError);
                }
            } else {
                if (!interactionExpired) {
                    try {
                        await safeRespond({ content: errorMessage });
                    } catch (e) {
                        console.error('safeRespond エラー:', e);
                    }
                } else {
                    try {
                        await safeRespond({ content: errorMessage, ephemeral: true });
                    } catch (e) {
                        console.error('safeRespond エラー:', e);
                    }
                }
            }
        }

        // 何らかの理由で完了せずに終了した場合、現在の内容で更新
        if (!isCompleted && !interactionExpired) {
            try {
                await safeRespond({ content: formatResponse(responseContent, true) });
            } catch (e) {
                console.error('safeRespond エラー:', e);
            }

            // 未完了レスポンスでも部分的な結果があればデータセットに保存（incomplete=true）
            if (responseContent && responseContent.trim().length > 0) {
                try {
                    await saveConversationDatasetEntry(interaction, prompt, responseContent, true);
                } catch (dbErr) {
                    console.error('dataset save error (incomplete):', dbErr);
                }
            }
        }
    }
};

// Discord表示用のレスポンスをフォーマット
function formatResponse(response: string, isComplete = false): string {
    // 回答だけを表示
    let formattedMessage = response;

    // 完了していない場合は入力インジケータを追加
    if (!isComplete) {
        formattedMessage += '▌'; // 入力カーソルインジケータ
    }

    // Discordのメッセージ長制限を処理
    if (formattedMessage.length > 1950) {
        return formattedMessage.substring(0, 1950) + '...\n\n(内容が長すぎるため切り詰められました)';
    }

    return formattedMessage;
}

// ブロッキングを避けるためawaitなしでDiscordメッセージを更新
function updateDiscordMessage(interaction: ChatInputCommandInteraction, content: string): void {
    interaction.editReply(content).catch(err => {
        console.error('Discordメッセージの更新中にエラーが発生:', err);
        // インタラクションが無効になった場合は無視（最終的にフォローアップを送る）
    });
}

// レート制限をチェックして更新する関数
function isRateLimited(userId: string): boolean {
    const now = Date.now();
    const userLimit = userRateLimits.get(userId);

    if (!userLimit) {
        // このユーザーからの最初のリクエスト
        userRateLimits.set(userId, { lastUsed: now, count: 1 });
        return false;
    }

    if (now - userLimit.lastUsed > RATE_LIMIT_WINDOW) {
        // ウィンドウ外の場合はリセット
        userRateLimits.set(userId, { lastUsed: now, count: 1 });
        return false;
    }

    // ウィンドウ内の場合、カウントをインクリメントして制限をチェック
    userLimit.count += 1;
    userLimit.lastUsed = now;
    userRateLimits.set(userId, userLimit);

    return userLimit.count > MAX_REQUESTS_PER_WINDOW;
}

// コードブロックを処理してファイル化する関数
function processCodeBlocks(response: string): { cleanedResponse: string, codeFiles: any[] } {
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    const codeFiles: any[] = [];
    let cleanedResponse = response;
    let match;
    let index = 0;

    while ((match = codeBlockRegex.exec(response)) !== null) {
        const language = match[1] || 'txt';
        const code = match[2];

        // ファイル拡張子を決定
        const extension = getFileExtension(language);
        const fileName = `code_${index + 1}.${extension}`;

        // ファイルをBufferとして作成
        const buffer = Buffer.from(code, 'utf-8');
        codeFiles.push({
            attachment: buffer,
            name: fileName
        });

        // 応答からコードブロックを除去
        cleanedResponse = cleanedResponse.replace(match[0], `\n[コードファイル: ${fileName}]\n`);
        index++;
    }

    // コードブロックがない場合は元の応答を返す
    if (codeFiles.length === 0) {
        return { cleanedResponse: formatResponse(response, true), codeFiles: [] };
    }

    return { cleanedResponse: formatResponse(cleanedResponse, true), codeFiles };
}

// 言語からファイル拡張子を取得
function getFileExtension(language: string): string {
    const extensions: { [key: string]: string } = {
        javascript: 'js',
        typescript: 'ts',
        python: 'py',
        java: 'java',
        c: 'c',
        cpp: 'cpp',
        csharp: 'cs',
        php: 'php',
        ruby: 'rb',
        go: 'go',
        rust: 'rs',
        swift: 'swift',
        kotlin: 'kt',
        scala: 'scala',
        html: 'html',
        css: 'css',
        json: 'json',
        xml: 'xml',
        yaml: 'yaml',
        sql: 'sql',
        bash: 'sh',
        shell: 'sh',
        powershell: 'ps1',
        dockerfile: 'dockerfile'
    };

    return extensions[language.toLowerCase()] || 'txt';
}

// 会話データセットの型
type DatasetEntry = {
    id: string;
    timestamp: number;
    userId: string;
    userName?: string;
    prompt: string;
    response?: string;
    incomplete?: boolean;
};

// データセットを保存するユーティリティ
async function saveConversationDatasetEntry(interaction: ChatInputCommandInteraction, prompt: string | null, response?: string, incomplete = false): Promise<void> {
    const guildId = interaction.guild?.id || 'global';
    const entry: DatasetEntry = {
        id: `${Date.now()}_${Math.random().toString(36).substring(2,8)}`,
        timestamp: Date.now(),
        userId: interaction.user.id,
        userName: interaction.user.username,
        prompt: prompt ?? '',
        response,
        incomplete
    };

    const key = `Guild/${guildId}/dataset`;
    try {
        const existing: DatasetEntry[] = (await database.get(guildId, key, [])) || [];
        existing.push(entry);
        // 最新100件のみ保持
        const trimmed = existing.slice(-100);
        await database.set(guildId, key, trimmed);
    } catch (err) {
        console.error('saveConversationDatasetEntry error:', err);
        throw err;
    }
}

// データセットを取得するユーティリティ
async function getConversationDataset(guildId: string, limit = 100): Promise<DatasetEntry[]> {
    const key = `Guild/${guildId}/dataset`;
    try {
        const existing: DatasetEntry[] = (await database.get(guildId, key, [])) || [];
        return existing.slice(-limit);
    } catch (err) {
        console.error('getConversationDataset error:', err);
        return [];
    }
}

// サニタイズされた system prompt を生成・マージする
function sanitizeSystemPrompt(prompt: string | undefined): string {
    if (!prompt) return '';
    // 簡易フィルタ: 危険な指示や個人情報要求を削除
    const forbiddenPatterns = [
        /evade/i,
        /ignore safety/i,
        /bypass/i,
        /do illegal/i,
        /personal data/i,
        /private data/i,
        /password/i,
        /credit card/i
    ];

    let cleaned = prompt;
    for (const pat of forbiddenPatterns) {
        cleaned = cleaned.replace(pat, '[削除された内容]');
    }

    // 長すぎる場合は切り詰め
    if (cleaned.length > 1500) {
        cleaned = cleaned.substring(0, 1500) + '...';
    }
    return cleaned.trim();
}

function mergeSystemPrompts(defaultPrompt: string, userPrompt: string | null | undefined, conservativeMode: boolean): string {
    const sanitized = sanitizeSystemPrompt(userPrompt || undefined);
    if (!sanitized) return defaultPrompt;

    // 保守的モードではユーザーの指示を補助的に扱う
    if (conservativeMode) {
        return `${defaultPrompt}\n\n# ユーザーの追加指示（補助的に扱う）\n${sanitized}`;
    }

    // 標準モードではユーザー指示をデフォルトの下に結合
    return `${defaultPrompt}\n\n# ユーザーの追加指示\n${sanitized}`;
}

// コンテンツフィルタ用の自動サニタイズ。返り値はサニタイズ後のテキスト（変更がない場合は元の入力を返す）
function sanitizeForContentFilter(input: string | null | undefined): string {
    if (!input) return '';
    let cleaned = input;

    // 危険度の高いキーワード一覧（簡易）を置換
    const patterns = [
        /kill yourself/gi,
        /commit suicide/gi,
        /i want to die/gi,
        /hate (?:you|them)/gi,
        /\bslur1\b/gi, // placeholder: 実運用ではスラーワードリストを整備してください
        /\bslur2\b/gi,
        /how to make a bomb/gi,
        /explode/gi,
        /\bterrorist\b/gi
    ];

    for (const pat of patterns) {
        cleaned = cleaned.replace(pat, '[削除]');
    }

    // 長すぎる場合は切り詰め
    if (cleaned.length > 1000) {
        cleaned = cleaned.substring(0, 1000) + '...';
    }

    return cleaned.trim();
}