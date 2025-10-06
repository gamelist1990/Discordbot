import { Request, Response } from 'express';
import { statusManager } from '../../utils/StatusManager.js';
import { BotClient } from '../../core/BotClient.js';

/**
 * ステータスコントローラー
 */
export class StatusController {
    private botClient: BotClient;

    constructor(botClient: BotClient) {
        this.botClient = botClient;
    }

    /**
     * Bot ステータスの取得
     */
    async getStatus(_req: Request, res: Response): Promise<void> {
        try {
            const status = statusManager.getStatus();
            const guildCount = this.botClient.getGuildCount();
            const maxGuilds = this.botClient.getMaxGuilds();

            res.json({
                ...status,
                guildCount,
                maxGuilds,
                uptimeFormatted: this.formatUptime(status.uptime),
            });
        } catch (error) {
            console.error('ステータス取得エラー:', error);
            res.status(500).json({ error: 'Failed to fetch status' });
        }
    }

    /**
     * アップタイムをフォーマット
     */
    private formatUptime(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}日 ${hours % 24}時間 ${minutes % 60}分`;
        } else if (hours > 0) {
            return `${hours}時間 ${minutes % 60}分`;
        } else if (minutes > 0) {
            return `${minutes}分 ${seconds % 60}秒`;
        } else {
            return `${seconds}秒`;
        }
    }
}
