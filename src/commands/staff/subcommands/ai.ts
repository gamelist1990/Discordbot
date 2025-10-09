// src/commands/staff/subcommands/ai.ts
import { ChatInputCommandInteraction, MessageFlags, DiscordAPIError } from 'discord.js';
import { OpenAIChatManager } from '../../../core/OpenAIChatManager';
import { OpenAIChatCompletionMessage, OpenAIChatCompletionChunk } from '../../../types/openai';
import { statusToolDefinition, statusToolHandler } from './ai-tools';

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
                    .setRequired(true)
            )
            .addAttachmentOption((opt: any) =>
                opt.setName('attachment')
                    .setDescription('添付ファイル (JSON, text, JS, TSなど。動画は未対応)')
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
        
        const prompt = interaction.options.getString('prompt', true);
        const attachment = interaction.options.getAttachment('attachment');
        
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
                const MAX_HISTORY_MESSAGES = 10;
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
        if (attachment) {
            // 動画ファイルのチェック
            if (attachment.contentType?.startsWith('video/')) {
                await interaction.reply({ 
                    content: '❌ 動画ファイルは未対応です。JSON、テキスト、JS、TS、画像ファイルのみ対応しています。', 
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }
            
            // 画像ファイルの場合
            if (attachment.contentType?.startsWith('image/')) {
                attachmentContent = [
                    { type: 'text', text: `添付画像: ${attachment.name}` },
                    { type: 'image_url', image_url: { url: attachment.url, detail: 'auto' } }
                ];
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
                    await interaction.reply({ 
                        content: '❌ 添付ファイルの処理中にエラーが発生しました。', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return;
                }
            }
        }
        
        // 応答を遅延して処理中であることを示す
        await interaction.deferReply();
        
        const chatManager = new OpenAIChatManager();
        
        // ツールを登録
        chatManager.registerTool(statusToolDefinition, statusToolHandler);
        
        // ツール実行時のコンテキストとして interaction を設定
        chatManager.setToolContext(interaction);
        
        // カスタム system prompt と安全化オプションの取得
        const userSystemPrompt = interaction.options.getString('system_prompt', false);
        const safetyOverride = interaction.options.getBoolean('safety', false);

        // デフォルトの安全な system prompt
        const defaultSystemPrompt = 'あなたは役立つアシスタントです。回答は正確かつスピーディにそしてよりフレンドリーに行って下さい。よく分からない意図が不明の場合は聞き直して下さい';

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
                for (const msg of historySlice) {
                    const display = (msg as any).member?.displayName || msg.author.username;
                    const role = msg.author.bot ? 'assistant' : 'user';
                    // タイムスタンプをローカル表記で付与（フォールバックは ISO）
                    const timeStr = new Date(msg.createdTimestamp).toLocaleString();
                    // include display name and timestamp so AI can see who said what and when
                    historyMessages.push({ role: role as any, content: `[${timeStr}] ${display}: ${msg.content}` });
                }
            }
        } catch (e) {
            // fetch 失敗時は conversationHistory の文字列を fallback として使う
            if (conversationHistory) {
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
                // 画像の場合は、プロンプトに添付情報を付ける形で別 user メッセージを追加
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
            // ストリーミングレスポンスを追加
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
                { temperature: 0.7 } // オプションの設定
            );
            
            // 完了としてマーク
            isCompleted = true;
            
            // コードブロックを検知してファイル化
            const { cleanedResponse, codeFiles } = processCodeBlocks(responseContent);
            
            // 最終的な完全なレスポンスで更新（インタラクションが有効な場合のみ）
            if (!interactionExpired) {
                await interaction.editReply({
                    content: cleanedResponse,
                    files: codeFiles.length > 0 ? codeFiles : undefined
                });
            } else {
                // インタラクションが無効になった場合はフォローアップ
                await interaction.followUp({
                    content: cleanedResponse,
                    files: codeFiles.length > 0 ? codeFiles : undefined,
                    ephemeral: true
                });
            }
            
        } catch (error) {
            console.error('AIストリームでエラーが発生:', error);
            
            // インタラクションが無効になった場合のエラーハンドリング
            if (error instanceof DiscordAPIError && error.code === 10062) {
                interactionExpired = true;
                try {
                    await interaction.followUp({
                        content: `❌ インタラクションがタイムアウトしました。最終結果:\n\n${formatResponse(responseContent, true)}`,
                        ephemeral: true
                    });
                } catch (followUpError) {
                    console.error('フォローアップ送信エラー:', followUpError);
                }
            } else {
                if (!interactionExpired) {
                    await interaction.editReply('❌ リクエストの処理中にエラーが発生しました。');
                } else {
                    await interaction.followUp({
                        content: '❌ リクエストの処理中にエラーが発生しました。',
                        ephemeral: true
                    });
                }
            }
        }
        
        // 何らかの理由で完了せずに終了した場合、現在の内容で更新
        if (!isCompleted && !interactionExpired) {
            await interaction.editReply(formatResponse(responseContent, true));
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