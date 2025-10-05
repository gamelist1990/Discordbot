import { Client, Collection, GatewayIntentBits, REST, Routes } from 'discord.js';
import { SlashCommand } from '../types/command.js';
import { database } from './Database.js';
import { Logger } from '../utils/Logger.js';

/**
 * Discord APIコマンド型定義
 */
interface DiscordCommand {
    id: string;
    name: string;
    description: string;
    version?: string;
}

/**
 * サーバー上限設定
 */
const MAX_GUILDS = 50;

/**
 * Discord Bot のクライアント管理クラス
 */
export class BotClient {
    public client: Client;
    public commands: Collection<string, SlashCommand>;
    public token: string;
    private rest: REST;

    constructor(token: string) {
        this.token = token;
        this.commands = new Collection();
        this.rest = new REST({ version: '10' }).setToken(token);

        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
            ],
        });

        // サーバー参加イベント
        this.setupGuildLimitHandler();
    }

    /**
     * 登録されているコマンド一覧を取得
     */
    public getCommands(): Collection<string, SlashCommand> {
        return this.commands;
    }

    /**
     * サーバー上限チェックハンドラーを設定
     */
    private setupGuildLimitHandler(): void {
        this.client.on('guildCreate', async (guild) => {
            const guildCount = this.client.guilds.cache.size;
            
            Logger.info(`📥 新しいサーバーに参加: ${guild.name} (ID: ${guild.id})`);
            Logger.info(`📊 現在のサーバー数: ${guildCount}/${MAX_GUILDS}`);

            if (guildCount > MAX_GUILDS) {
                Logger.warn(`⚠️ サーバー上限 (${MAX_GUILDS}) を超えました。サーバーから退出します: ${guild.name}`);
                
                try {
                    // サーバーオーナーにメッセージを送信
                    const owner = await guild.fetchOwner();
                    await owner.send(
                        `申し訳ございません。このBotは現在、最大${MAX_GUILDS}サーバーまでしかサポートしていません。\n` +
                        `サーバー上限に達したため、「${guild.name}」から退出させていただきます。\n` +
                        `ご理解のほどよろしくお願いいたします。`
                    ).catch(() => {
                        Logger.warn('サーバーオーナーへのDM送信に失敗しました');
                    });
                } catch (error) {
                    Logger.error('サーバーオーナーの取得に失敗:', error);
                }

                // サーバーから退出
                await guild.leave();
                Logger.info(`✅ サーバーから退出しました: ${guild.name}`);
            } else {
                Logger.success(`✅ サーバーに参加しました: ${guild.name} (${guildCount}/${MAX_GUILDS})`);
            }
        });

        this.client.on('guildDelete', (guild) => {
            const guildCount = this.client.guilds.cache.size;
            Logger.info(`📤 サーバーから退出: ${guild.name} (ID: ${guild.id})`);
            Logger.info(`📊 現在のサーバー数: ${guildCount}/${MAX_GUILDS}`);
        });
    }

    /**
     * Bot を起動
     */
    async login(): Promise<void> {
        try {
            await this.client.login(this.token);
            Logger.success('✅ Discord Bot にログインしました');
        } catch (error) {
            Logger.error('❌ ログインエラー:', error);
            throw error;
        }
    }

    /**
     * Bot を停止
     */
    async destroy(): Promise<void> {
        try {
            this.client.destroy();
            Logger.success('👋 Discord Bot を停止しました');
        } catch (error) {
            Logger.error('停止処理エラー:', error);
            throw error;
        }
    }

    /**
     * クライアントIDを取得（自動）
     */
    getClientId(): string {
        if (!this.client.user) {
            throw new Error('Bot がログインしていません');
        }
        return this.client.user.id;
    }

    /**
     * コマンドを登録
     * @param command スラッシュコマンド
     */
    registerCommand(command: SlashCommand): void {
        this.commands.set(command.data.name, command);
        Logger.info(`📝 コマンド登録: /${command.data.name}`);
    }

    /**
     * 複数のコマンドを一括登録
     * @param commands スラッシュコマンドの配列
     */
    registerCommands(commands: SlashCommand[]): void {
        for (const command of commands) {
            this.registerCommand(command);
        }
    }

    /**
     * すべてのギルドにコマンドをデプロイ（自動）
     * 登録されていない古いコマンドを自動的にクリア
     */
    async deployCommandsToAllGuilds(): Promise<void> {
        try {
            const clientId = this.getClientId();
            const commandData = Array.from(this.commands.values()).map(cmd => cmd.data.toJSON());
            const guilds = this.client.guilds.cache;

            Logger.info(`🚀 全サーバー (${guilds.size}個) にスラッシュコマンドをデプロイ中...`);
            Logger.info(`📦 コマンド数: ${commandData.length}個`);

            let successCount = 0;
            let failCount = 0;

            // ギルド固有のコマンドをデプロイ
            for (const [guildId, guild] of guilds) {
                try {
                    // 古いコマンドをクリアして新しいコマンドをデプロイ
                    await this.rest.put(
                        Routes.applicationGuildCommands(clientId, guildId),
                        { body: commandData }
                    );
                    successCount++;
                    Logger.success(`  ✅ ${guild.name} (${guildId})`);
                } catch (error) {
                    failCount++;
                    Logger.error(`  ❌ ${guild.name} (${guildId}):`, error);
                }
            }

            // グローバルコマンドもクリア（未登録のものを削除）
            try {
                Logger.info('🌍 グローバルコマンドを同期中...');
                await this.rest.put(
                    Routes.applicationCommands(clientId),
                    { body: [] } // グローバルコマンドは空にする（ギルド固有のみ使用）
                );
                Logger.success('✅ グローバルコマンドをクリアしました');
            } catch (error) {
                Logger.error('❌ グローバルコマンドのクリアに失敗:', error);
            }

            Logger.success(`✅ デプロイ完了: 成功 ${successCount} / 失敗 ${failCount}`);
        } catch (error) {
            Logger.error('❌ コマンドデプロイエラー:', error);
            throw error;
        }
    }

    /**
     * 未登録のコマンドを検出して削除（ギルドとグローバル両方）
     */
    async cleanupUnregisteredCommands(): Promise<void> {
        try {
            const clientId = this.getClientId();
            const registeredCommandNames = new Set(
                Array.from(this.commands.values()).map(cmd => cmd.data.name)
            );

            Logger.info('🧹 未登録コマンドのクリーンアップを開始...');

            let totalDeleted = 0;

            // 各ギルドの未登録コマンドをチェック
            for (const [guildId, guild] of this.client.guilds.cache) {
                try {
                    const guildCommands = await this.rest.get(
                        Routes.applicationGuildCommands(clientId, guildId)
                    ) as DiscordCommand[];

                    for (const cmd of guildCommands) {
                        if (!registeredCommandNames.has(cmd.name)) {
                            Logger.warn(`  🗑️ 削除: /${cmd.name} from ${guild.name}`);
                            await this.rest.delete(
                                Routes.applicationGuildCommand(clientId, guildId, cmd.id)
                            );
                            totalDeleted++;
                        }
                    }
                } catch (error) {
                    Logger.error(`  ❌ ${guild.name} のコマンドチェックに失敗:`, error);
                }
            }

            // グローバルコマンドの未登録をチェック
            try {
                const globalCommands = await this.rest.get(
                    Routes.applicationCommands(clientId)
                ) as DiscordCommand[];

                for (const cmd of globalCommands) {
                    if (!registeredCommandNames.has(cmd.name)) {
                        Logger.warn(`  🗑️ 削除: /${cmd.name} (グローバル)`);
                        await this.rest.delete(
                            Routes.applicationCommand(clientId, cmd.id)
                        );
                        totalDeleted++;
                    }
                }
            } catch (error) {
                Logger.error('  ❌ グローバルコマンドのチェックに失敗:', error);
            }

            if (totalDeleted > 0) {
                Logger.success(`✅ ${totalDeleted} 個の未登録コマンドを削除しました`);
            } else {
                Logger.info('✅ 未登録コマンドはありませんでした');
            }
        } catch (error) {
            Logger.error('❌ コマンドクリーンアップエラー:', error);
            throw error;
        }
    }

    /**
     * データベースを初期化
     */
    async initializeDatabase(): Promise<void> {
        await database.initialize();
    }

    /**
     * 現在のサーバー数を取得
     */
    getGuildCount(): number {
        return this.client.guilds.cache.size;
    }

    /**
     * サーバー上限を取得
     */
    getMaxGuilds(): number {
        return MAX_GUILDS;
    }

    /**
     * サーバーリストを取得
     */
    getGuildList(): Array<{ id: string; name: string; memberCount: number }> {
        return Array.from(this.client.guilds.cache.values()).map(guild => ({
            id: guild.id,
            name: guild.name,
            memberCount: guild.memberCount,
        }));
    }
}
