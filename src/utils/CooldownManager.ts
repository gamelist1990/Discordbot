/**
 * クールダウンマネージャー
 * コマンドのクールダウンを管理
 */
export class CooldownManager {
    private cooldowns: Map<string, Map<string, number>>;

    constructor() {
        this.cooldowns = new Map();
    }

    /**
     * クールダウンをチェックして設定
     * @param commandName コマンド名
     * @param userId ユーザーID
     * @param cooldownSeconds クールダウン時間（秒）
     * @returns クールダウン中の場合は残り時間、そうでなければ null
     */
    check(commandName: string, userId: string, cooldownSeconds: number): number | null {
        if (!this.cooldowns.has(commandName)) {
            this.cooldowns.set(commandName, new Map());
        }

        const now = Date.now();
        const timestamps = this.cooldowns.get(commandName)!;
        const cooldownAmount = cooldownSeconds * 1000;

        if (timestamps.has(userId)) {
            const expirationTime = timestamps.get(userId)! + cooldownAmount;

            if (now < expirationTime) {
                const timeLeft = (expirationTime - now) / 1000;
                return timeLeft;
            }
        }

        timestamps.set(userId, now);
        setTimeout(() => timestamps.delete(userId), cooldownAmount);

        return null;
    }

    /**
     * 特定のユーザーのクールダウンをクリア
     */
    clear(commandName: string, userId: string): void {
        const timestamps = this.cooldowns.get(commandName);
        if (timestamps) {
            timestamps.delete(userId);
        }
    }

    /**
     * すべてのクールダウンをクリア
     */
    clearAll(): void {
        this.cooldowns.clear();
    }
}

// グローバルガード付きシングルトンインスタンス
const COOLDOWN_KEY = '__cooldownManager_v1';
if (!(global as any)[COOLDOWN_KEY]) {
    (global as any)[COOLDOWN_KEY] = new CooldownManager();
}

export const cooldownManager: CooldownManager = (global as any)[COOLDOWN_KEY];
