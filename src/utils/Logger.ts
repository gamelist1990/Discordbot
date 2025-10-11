/**
 * ロガークラス
 * コンソールに色付きログを出力
 */
export class Logger {
    private static colors = {
        reset: '\x1b[0m',
        bright: '\x1b[1m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        magenta: '\x1b[35m',
        cyan: '\x1b[36m',
        white: '\x1b[37m',
    };

    /**
     * 情報ログ
     */
    static info(message: string, ...args: any[]): void {
        console.log(`${this.colors.cyan}[INFO]${this.colors.reset} ${message}`, ...args);
    }

    /**
     * 成功ログ
     */
    static success(message: string, ...args: any[]): void {
        console.log(`${this.colors.green}[SUCCESS]${this.colors.reset} ${message}`, ...args);
    }

    /**
     * 警告ログ
     */
    static warn(message: string, ...args: any[]): void {
        console.warn(`${this.colors.yellow}[WARN]${this.colors.reset} ${message}`, ...args);
    }

    /**
     * エラーログ
     */
    static error(message: string, ...args: any[]): void {
        console.error(`${this.colors.red}[ERROR]${this.colors.reset} ${message}`, ...args);
    }

    /**
     * デバッグログ
     */
    static debug(message: string, ...args: any[]): void {
        try {
            // lazy import to avoid circular deps
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const config = require('../config').default;
            if (config.DEBUG === 'true') {
                console.log(`${this.colors.magenta}[DEBUG]${this.colors.reset} ${message}`, ...args);
            }
        } catch (err) {
            if (process.env.DEBUG === 'true') {
                console.log(`${this.colors.magenta}[DEBUG]${this.colors.reset} ${message}`, ...args);
            }
        }
    }

    /**
     * コマンド実行ログ
     */
    static command(commandName: string, userId: string, guildId?: string): void {
        const location = guildId ? `Guild: ${guildId}` : 'DM';
        console.log(`${this.colors.blue}[COMMAND]${this.colors.reset} /${commandName} | User: ${userId} | ${location}`);
    }
}
