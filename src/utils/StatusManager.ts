import fs from 'fs/promises';
import path from 'path';
import { Logger } from './Logger.js';


/**
 * Bot ステータス情報
 */
export interface BotStatus {
    startTime: number;
    lastUpdate: number;
    guildCount: number;
    uptime: number;
    version: string;
    ready: boolean;
}

/**
 * Bot のステータス管理クラス
 * 起動時間やサーバー数などの情報を JSON ファイルで永続化
 */
export class StatusManager {
    private statusFile: string;
    private status: BotStatus;
    private updateInterval: NodeJS.Timeout | null = null;

    constructor(dataDir?: string) {
        const baseDir = dataDir || path.join(process.cwd(), 'Data');
        this.statusFile = path.join(baseDir, 'bot_status.json');
        
        this.status = {
            startTime: Date.now(),
            lastUpdate: Date.now(),
            guildCount: 0,
            uptime: 0,
            version: '0.0.1',
            ready: false,
        };
    }

    /**
     * ステータスを初期化
     */
    async initialize(): Promise<void> {
        try {
            // ディレクトリを作成
            await fs.mkdir(path.dirname(this.statusFile), { recursive: true });

            // 既存のステータスファイルを読み込み（起動時間は保持）
            try {
                const data = await fs.readFile(this.statusFile, 'utf-8');
                const existing = JSON.parse(data) as BotStatus;
                
                // 前回の起動時間がある場合は保持、それ以外は更新
                if (existing.startTime) {
                    this.status.startTime = existing.startTime;
                }
            } catch {
                // ファイルがない場合は新規作成
                Logger.info('新しいステータスファイルを作成します');
            }

            // 現在の状態を保存
            await this.save();

            // 定期的に更新（10秒ごと）
            this.startAutoUpdate();

            Logger.info('✅ StatusManager を初期化しました');
        } catch (error) {
            Logger.error('StatusManager の初期化に失敗:', error);
            throw error;
        }
    }

    /**
     * 自動更新を開始
     */
    private startAutoUpdate(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        this.updateInterval = setInterval(async () => {
            this.status.lastUpdate = Date.now();
            this.status.uptime = Date.now() - this.status.startTime;
            await this.save();
        }, 10000); // 10秒ごと
    }

    /**
     * ステータスを保存
     */
    private async save(): Promise<void> {
        try {
            const json = JSON.stringify(this.status, null, 2);
            await fs.writeFile(this.statusFile, json, 'utf-8');
        } catch (error) {
            Logger.error('ステータスの保存に失敗:', error);
        }
    }

    /**
     * ステータスを更新
     */
    async updateStatus(updates: Partial<BotStatus>): Promise<void> {
        this.status = { ...this.status, ...updates };
        this.status.lastUpdate = Date.now();
        this.status.uptime = Date.now() - this.status.startTime;
        await this.save();
    }

    /**
     * 現在のステータスを取得
     */
    getStatus(): BotStatus {
        return {
            ...this.status,
            uptime: Date.now() - this.status.startTime,
            lastUpdate: Date.now(),
        };
    }

    /**
     * Bot が準備完了したことをマーク
     */
    async markReady(guildCount: number): Promise<void> {
        await this.updateStatus({
            ready: true,
            guildCount,
        });
        Logger.success('✅ Bot のステータスを「準備完了」に更新しました');
    }

    /**
     * サーバー数を更新
     */
    async updateGuildCount(count: number): Promise<void> {
        await this.updateStatus({ guildCount: count });
    }

    /**
     * クリーンアップ
     */
    async cleanup(): Promise<void> {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        await this.updateStatus({ ready: false });
        Logger.info('StatusManager をクリーンアップしました');
    }
}

// グローバルインスタンス
export const statusManager = new StatusManager();
