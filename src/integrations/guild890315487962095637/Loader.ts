import type { Client } from 'discord.js';
import { ChatAIChannelManager } from '../../core/ChatAIChannel/index.js';
import { Guild890315487962095637ServerStatusIntegration } from './ServerStatusIntegration.js';
import { TARGET_GUILD_ID } from './constants.js';

export const CHAT_AI_CHANNEL_ENABLED = true;
export const CHAT_AI_CHANNEL_ID = '1467503521669841052';
export const CHAT_AI_BOT_NAME = 'ぺぺちゃん';

export class Guild890315487962095637IntegrationLoader {
    private readonly serverStatus = new Guild890315487962095637ServerStatusIntegration();
    private readonly chatAI = new ChatAIChannelManager({
        enabled: CHAT_AI_CHANNEL_ENABLED,
        guildId: TARGET_GUILD_ID,
        channelId: CHAT_AI_CHANNEL_ID,
        botName: CHAT_AI_BOT_NAME,
        historyLimit: 40,
        responseDelayMs: 350,
    });

    async initialize(client: Client): Promise<void> {
        await this.serverStatus.initialize(client);
        if (CHAT_AI_CHANNEL_ENABLED) {
            await this.chatAI.initialize(client);
        }
    }

    async destroy(): Promise<void> {
        await Promise.all([
            this.serverStatus.destroy(),
            this.chatAI.destroy(),
        ]);
    }
}
