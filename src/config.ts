import fs from 'fs';
import path from 'path';
import { Logger } from './utils/Logger.js';

export interface AppConfig {
    token?: string;
    DISCORD_CLIENT_SECRET?: string;
    BASE_URL?: string;
    NODE_ENV?: string;
    DEBUG?: string;
    WEB_BASE_URL?: string;
}

const configPath = path.resolve(__dirname, '..', 'config.json');

let raw: Partial<AppConfig> = {};
let rawSource: 'file' | 'missing' = 'missing';
try {
    let data = fs.readFileSync(configPath, 'utf8');
    // remove UTF-8 BOM if present
    if (data.charCodeAt(0) === 0xfeff) data = data.slice(1);
    // also trim whitespace
    const cleaned = data.trim();
    raw = JSON.parse(cleaned) as Partial<AppConfig>;
    rawSource = 'file';
} catch (err) {
    // config.json がないか不正な場合は起動を停止する（env からのフォールバックは禁止）
    try {
        const exists = fs.existsSync(configPath);
        Logger.error(`[Config] Failed to read/parse config.json at ${configPath}. exists=${exists}. error=${String(err)}`);
    } catch (e) {
        Logger.error(`[Config] Failed to read config.json and cannot stat path: ${String(e)}. error=${String(err)}`);
    }
    Logger.error('[Config] config.json is required. Please create a valid config.json (you can copy env.example). Exiting.');
    process.exit(1);
}

export const config: Required<AppConfig> = {
    token: raw.token || '',
    DISCORD_CLIENT_SECRET: raw.DISCORD_CLIENT_SECRET || '',
    BASE_URL: raw.BASE_URL || 'http://localhost:3000',
    NODE_ENV: raw.NODE_ENV || 'development',
    DEBUG: raw.DEBUG || 'false',
    WEB_BASE_URL: raw.WEB_BASE_URL || raw.BASE_URL || 'http://localhost:3000',
};

export default config;

// ログ: BASE_URL の供給元を明示
Logger.info(`[Config] BASE_URL=${config.BASE_URL} (source=${rawSource})`);
