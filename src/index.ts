import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { BotClient } from './core/BotClient.js';
import { EventHandler } from './core/EventHandler.js';
import { CommandLoader } from './core/CommandLoader.js';
import { Logger } from './utils/Logger.js';
import { SettingsServer } from './web/SettingsServer.js';
import { statusManager } from './utils/StatusManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE_PATH = path.join(path.dirname(__dirname), 'config.json');

interface Config {
    token?: string;
}

let botClient: BotClient | null = null;
let settingsServer: SettingsServer | null = null;

/**
 * 設定ファイルを読み込む
 */
async function loadConfig(): Promise<Config> {
    try {
        Logger.debug(`CONFIG_FILE_PATH = ${CONFIG_FILE_PATH}`);
        const data = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
        Logger.debug(`config.json length=${data.length}`);
        if (!data) {
            Logger.error(`設定ファイルが空です: ${CONFIG_FILE_PATH}`);
            return {};
        }

        // remove UTF-8 BOM if present
        const stripBOM = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
        const cleaned = stripBOM(data).trim();

        // Try plain JSON parse first
        try {
            return JSON.parse(cleaned);
        } catch (errPlain) {
            // Fallback: remove JS-style comments (/* */ and //)
            const uncommented = cleaned.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
            try {
                return JSON.parse(uncommented);
            } catch (errComments) {
                // Mask token before logging snippet to avoid leaking secrets
                const masked = cleaned.replace(/("token"\s*:\s*")([^"]+)(")/i, '$1<masked>$3');
                Logger.error('設定ファイルの JSON 解析に失敗しました。先頭スニペット（token はマスク済み）:');
                Logger.error(masked.slice(0, 400));
                Logger.error(String(errComments));
                return {};
            }
        }
    } catch (error) {
        Logger.error('設定ファイルの読み込みに失敗しました:', error);
        return {};
    }
}

/**
 * メイン処理
 */
async function main() {
    try {
        Logger.info('🚀 Discord Bot を起動しています...');

        // StatusManager を初期化
        await statusManager.initialize();

        // 設定ファイルを読み込む
        const config = await loadConfig();

        if (!config.token) {
            Logger.error('❌ エラー: config.json に有効な token が設定されていません。');
            process.exit(1);
        }

        // Bot クライアントを初期化
        botClient = new BotClient(config.token);

        // Bot にログイン（クライアントIDを取得するため）
        await botClient.login();

        // データベースを初期化
        await botClient.initializeDatabase();

        Logger.info(`📊 現在のサーバー数: ${botClient.getGuildCount()}/${botClient.getMaxGuilds()}`);

        // コマンドローダーを初期化
        const commandLoader = new CommandLoader(botClient);
        await commandLoader.loadAll();

        // イベントハンドラーを登録
        const eventHandler = new EventHandler(botClient);
        eventHandler.setRegistry(commandLoader.getRegistry());
        eventHandler.registerAll();

        // RankManager を初期化
        const { rankManager } = await import('./core/RankManager.js');
        rankManager.setClient(botClient.client);
        Logger.info('📊 RankManager を初期化しました');

        // StatsManager を初期化
        const { statsManagerSingleton } = await import('./core/StatsManager.js');
        statsManagerSingleton.init(botClient.client);
        Logger.info('📊 StatsManager を初期化しました');

        // TriggerManager を初期化
        const { initTriggerManager } = await import('./core/TriggerManager.js');
        const { database } = await import('./core/Database.js');
        const triggerManager = initTriggerManager(botClient.client, database);
        Logger.info('🎯 TriggerManager を初期化しました');

        // すべてのサーバーにコマンドをデプロイ
        Logger.info('🚀 全サーバーにコマンドをデプロイします...');
        await botClient.deployCommandsToAllGuilds();

        // 未登録コマンドのクリーンアップ
        Logger.info('🧹 未登録コマンドのクリーンアップを実行します...');
        await botClient.cleanupUnregisteredCommands();

        // Bot を準備完了にマーク
        await statusManager.markReady(botClient.getGuildCount());

        // 設定サーバーを起動
        Logger.info('🌐 設定サーバーを起動します...');
        settingsServer = new SettingsServer(botClient, 3000);
        await settingsServer.start();

        // SettingsServer を client に注入（コマンドから参照できるようにする）
        (botClient.client as any).settingsServer = settingsServer;

        // TriggerManager に WebSocket のエミッタを接続
        // 注意: WebSocket サーバーは UnifiedWebSocketManager を使っているため、そちらへブロードキャストする
        const { unifiedWsManager } = await import('./web/services/UnifiedWebSocketManager.js');
        triggerManager.setWebSocketEmitter((event: string, data: any) => {
            try {
                unifiedWsManager.broadcast('trigger', {
                    type: event,
                    timestamp: Date.now(),
                    payload: data
                });
            } catch (err) {
                Logger.error('Failed to emit WS event via unifiedWsManager:', err);
            }
        });
        Logger.info('🔗 TriggerManager と WebSocketManager を接続しました');
        
        Logger.success('✅ Bot が正常に起動しました！');
        Logger.info('💡 新しいサーバーに追加すると、自動的にコマンドがデプロイされます。');
        Logger.info(`⚠️ サーバー上限: ${botClient.getMaxGuilds()} (現在: ${botClient.getGuildCount()})`);
        try {
            // Prefer WEB_BASE_URL from config if available
            const cfg = await import('./config.js');
            Logger.info(`🌐 Web ダッシュボード: ${cfg.default.WEB_BASE_URL || cfg.default.BASE_URL}`);
        } catch {
            Logger.info(`🌐 Web ダッシュボード: http://localhost:3000`);
        }
    } catch (error) {
        Logger.error('起動エラー:', error);
        process.exit(1);
    }
}

/**
 * エラーハンドラー
 */
process.on('unhandledRejection', (error) => {
    Logger.error('未処理の Promise 拒否:', error);
});

process.on('uncaughtException', (error) => {
    Logger.error('未処理の例外:', error);
    process.exit(1);
});

/**
 * 終了処理
 */
process.on('SIGINT', async () => {
    Logger.info('\n🛑 終了処理を開始します...');
    if (statusManager) {
        await statusManager.cleanup();
    }
    if (settingsServer) {
        await settingsServer.stop();
    }
    if (botClient) {
                // Web ダッシュボードの URL は config の BASE_URL を表示する
                try {
                    // ...existing code...
                } catch (e) { /* noop */ }
                import('./config.js').then((cfg) => {
                    Logger.info(`🌐 Web ダッシュボード: ${cfg.default.BASE_URL}`);
                }).catch(() => {
                    Logger.info(`🌐 Web ダッシュボード: http://localhost:3000`);
                });
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    Logger.info('\n🛑 終了処理を開始します...');
    if (statusManager) {
        await statusManager.cleanup();
    }
    if (settingsServer) {
        await settingsServer.stop();
    }
    if (botClient) {
        await botClient.destroy();
    }
    process.exit(0);
});

// アプリケーションを起動
main();
