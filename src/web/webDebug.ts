// Lightweight web-only debug entry for SettingsServer
// Usage:
// WEB_DEBUG_BYPASS_AUTH=1 WEB_DEBUG_NO_PERSIST=1 WEB_DEBUG_PORT=3001 bun run src/web/webDebug.ts
import { SettingsServer } from './SettingsServer.js';

class WebDebugBotStub {
    token: string;
    client: any;
    constructor() {
        this.token = '';
        this.client = { guilds: { cache: new Map() } };
    }
    getClientId(): string {
        return process.env.DEBUG_CLIENT_ID || 'debug-client-id';
    }
    getGuildList(): Array<any> {
        return [];
    }
    getGuildCount(): number {
        return 0;
    }
    getMaxGuilds(): number {
        return 1000;
    }
    async initializeDatabase(): Promise<void> { return; }
}

async function main() {
    const port = process.env.WEB_DEBUG_PORT ? parseInt(process.env.WEB_DEBUG_PORT) : 3000;
    const botStub = new WebDebugBotStub();

    const server = new SettingsServer(botStub as any, port);
    await server.start();

    console.log(`[webDebug] SettingsServer started on port ${port}`);
    if (process.env.WEB_DEBUG_BYPASS_AUTH === '1') {
        console.log('[webDebug] OAuth bypass enabled (WEB_DEBUG_BYPASS_AUTH=1)');
    }
    if (process.env.WEB_DEBUG_NO_PERSIST === '1') {
        console.log('[webDebug] Session persistence disabled (WEB_DEBUG_NO_PERSIST=1)');
    }

    process.on('SIGINT', async () => {
        console.log('\n[webDebug] stopping...');
        await server.stop();
        process.exit(0);
    });
}

main().catch((e) => {
    console.error('[webDebug] failed to start:', e);
    process.exit(1);
});
