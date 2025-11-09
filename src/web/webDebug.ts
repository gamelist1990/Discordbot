import { SettingsServer } from './SettingsServer.js';

// スタブLogger
global.Logger = {
    info: console.log,
    success: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.log
};

// 軽量なBotClientスタブ（Bot本体を起動せずにWebサーバーのみ動作させる）
class StubBotClient {
    public client: any;
    public commands: any;
    public token: string;
    public eventManager: any;
    public rest: any;

    constructor(token = 'stub-token') {
        this.token = token;
        this.commands = new Map();
        this.client = {
            guilds: {
                cache: new Map()
            },
            user: {
                id: 'stub-user-id',
                username: 'StubBot'
            }
        };
        this.eventManager = {};
        this.rest = {};
    }

    getCommands() {
        return this.commands;
    }

    getGuildCount() {
        return this.client.guilds.cache.size;
    }

    getMaxGuilds() {
        return 50;
    }

    getClientId() {
        return this.client.user.id;
    }

    registerCommand(command: any) {
        this.commands.set(command.data.name, command);
        console.log(`StubBotClient: registerCommand ${command.data.name}`);
    }

    registerCommands(commands: any[]) {
        for (const command of commands) {
            this.registerCommand(command);
        }
    }

    getGuildList() {
        return [];
    }

    async login() {
        // スタブなので何もしない
        console.log('StubBotClient: login (no-op)');
    }

    async initializeDatabase() {
        // スタブなので何もしない
        console.log('StubBotClient: initializeDatabase (no-op)');
    }

    async deployCommandsToAllGuilds() {
        // スタブなので何もしない
        console.log('StubBotClient: deployCommandsToAllGuilds (no-op)');
    }

    async cleanupUnregisteredCommands() {
        // スタブなので何もしない
        console.log('StubBotClient: cleanupUnregisteredCommands (no-op)');
    }

    async destroy() {
        // スタブなので何もしない
        console.log('StubBotClient: destroy (no-op)');
    }
}

async function main() {
    try {
        console.log('🌐 Web Debug Server を起動しています...');

        // スタブBotClientを作成
        const stubBotClient = new StubBotClient();

        // データベース初期化（スタブでも必要）
        await stubBotClient.initializeDatabase();

        // 設定サーバーを起動
        const port = process.env.WEB_DEBUG_PORT ? parseInt(process.env.WEB_DEBUG_PORT) : 3001;
        const settingsServer = new SettingsServer(stubBotClient, port);
        await settingsServer.start();

        console.log('✅ Web Debug Server が正常に起動しました！');
        console.log(`🌐 Web ダッシュボード: http://localhost:${port}`);
    } catch (error) {
        console.error('Web Debug Server 起動エラー:', error);
        process.exit(1);
    }
}

// アプリケーションを起動
main();