import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { BotClient } from './core/BotClient.js';
import { EventHandler } from './core/EventHandler.js';
import { CommandLoader } from './core/CommandLoader.js';
import { Logger } from './utils/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE_PATH = path.join(path.dirname(__dirname), 'config.json');

interface Config {
    token?: string;
}

let botClient: BotClient | null = null;

/**
 * 設定ファイルを読み込む
 */
async function loadConfig(): Promise<Config> {
    try {
        const data = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
        return JSON.parse(data);
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

        // すべてのサーバーにコマンドをデプロイ
        Logger.info('🚀 全サーバーにコマンドをデプロイします...');
        await botClient.deployCommandsToAllGuilds();

        // 未登録コマンドのクリーンアップ
        Logger.info('🧹 未登録コマンドのクリーンアップを実行します...');
        await botClient.cleanupUnregisteredCommands();
        
        Logger.success('✅ Bot が正常に起動しました！');
        Logger.info('💡 新しいサーバーに追加すると、自動的にコマンドがデプロイされます。');
        Logger.info(`⚠️ サーバー上限: ${botClient.getMaxGuilds()} (現在: ${botClient.getGuildCount()})`);
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
    if (botClient) {
        await botClient.destroy();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    Logger.info('\n🛑 終了処理を開始します...');
    if (botClient) {
        await botClient.destroy();
    }
    process.exit(0);
});

// アプリケーションを起動
main();
