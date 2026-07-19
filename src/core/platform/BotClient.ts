import { Client, Collection, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import { SlashCommand } from '../types/command.js';
import { database } from './Database.js';
import { Logger } from '../utils/Logger.js';
import { EventManager } from './EventManager.js';

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
    public eventManager: EventManager;
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
                GatewayIntentBits.GuildPresences, // メンバーのオンライン状態を取得
            ],
            partials: [
                Partials.Message,
                Partials.Channel,
            ],
        });

        // EventManager を初期化
        this.eventManager = new EventManager(this.client);

    // client オブジェクトにも参照を保持しておく（コマンドなどから参照可能にする）
    (this.client as any).eventManager = this.eventManager;

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
     * 既に同じコマンドが存在する場合はスキップ
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
            let skippedCount = 0;

            // ギルド固有のコマンドをデプロイ
            for (const [guildId, guild] of guilds) {
                try {
                    // 既存のコマンドを取得
                    const existingCommands = await this.rest.get(
                        Routes.applicationGuildCommands(clientId, guildId)
                    ) as DiscordCommand[];

                    // コマンドが同じかチェック
                    const isSame = this.compareCommands(existingCommands, commandData);

                    if (isSame) {
                        skippedCount++;
                        Logger.info(`  ⏭️ スキップ (変更なし): ${guild.name} (${guildId})`);
                        continue;
                    }

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

            Logger.success(`✅ デプロイ完了: 成功 ${successCount} / スキップ ${skippedCount} / 失敗 ${failCount}`);
        } catch (error) {
            Logger.error('❌ コマンドデプロイエラー:', error);
            throw error;
        }
    }

    /**
     * コマンドの内容を比較（名前と説明）
     */
    private compareCommands(existing: DiscordCommand[], newCommands: any[]): boolean {
        // 数と内容（説明 + オプション）を比較して差分があれば false を返す
        if (existing.length !== newCommands.length) {
            return false;
        }

        const existingMap = new Map(existing.map(cmd => [cmd.name, cmd]));
        const newMap = new Map(newCommands.map(cmd => [cmd.name, cmd]));

        if (existingMap.size !== newMap.size) {
            return false;
        }

        for (const [name, newCmd] of newMap) {
            const existingCmd = existingMap.get(name);
            if (!existingCmd) return false;

            // 名前・説明の比較
            if (existingCmd.description !== newCmd.description) {
                return false;
            }

            // オプション（サブコマンド等）の詳細比較
            if (!this.compareCommandOptions((existingCmd as any).options || [], newCmd.options || [])) {
                return false;
            }
        }

        return true;
    }

    /**
     * コマンドオプションを再帰的に比較（サブコマンド対応）
     */
    private compareCommandOptions(existingOptions: any[], newOptions: any[]): boolean {
        if (existingOptions.length !== newOptions.length) {
            return false;
        }

        // オプションを名前でソートして比較（順序非依存）
        const sortOptions = (opts: any[]) => opts.slice().sort((a, b) => a.name.localeCompare(b.name));
        const sortedExisting = sortOptions(existingOptions);
        const sortedNew = sortOptions(newOptions);

        for (let i = 0; i < sortedExisting.length; i++) {
            const existingOpt = sortedExisting[i];
            const newOpt = sortedNew[i];

            // 基本プロパティの比較
            if (existingOpt.name !== newOpt.name ||
                existingOpt.description !== newOpt.description ||
                existingOpt.type !== newOpt.type ||
                existingOpt.required !== newOpt.required) {
                return false;
            }

            // choices の比較（順序非依存）
            if (!this.compareChoices(existingOpt.choices || [], newOpt.choices || [])) {
                return false;
            }

            // サブコマンド/サブコマンドグループのネストオプションを再帰的に比較
            if (existingOpt.options && newOpt.options) {
                if (!this.compareCommandOptions(existingOpt.options, newOpt.options)) {
                    return false;
                }
            } else if (existingOpt.options || newOpt.options) {
                // 一方だけオプションがある場合
                return false;
            }
        }

        return true;
    }

    /**
     * コマンドのchoicesを比較
     */
    private compareChoices(existingChoices: any[], newChoices: any[]): boolean {
        if (existingChoices.length !== newChoices.length) {
            return false;
        }

        // choicesを名前でソート
        const sortChoices = (choices: any[]) => choices.slice().sort((a, b) => a.name.localeCompare(b.name));
        const sortedExisting = sortChoices(existingChoices);
        const sortedNew = sortChoices(newChoices);

        for (let i = 0; i < sortedExisting.length; i++) {
            const existingChoice = sortedExisting[i];
            const newChoice = sortedNew[i];

            if (existingChoice.name !== newChoice.name ||
                existingChoice.value !== newChoice.value) {
                return false;
            }
        }

        return true;
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
     * ここではギルドのアイコンハッシュも返す（フロントエンドがアイコン表示に使用する）
     */
    getGuildList(): Array<{ id: string; name: string; memberCount: number; icon?: string | null }> {
        return Array.from(this.client.guilds.cache.values()).map(guild => ({
            id: guild.id,
            name: guild.name,
            memberCount: guild.memberCount,
            icon: (guild.icon !== null && guild.icon !== undefined) ? guild.icon : undefined,
        }));
    }
}
