import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './utils/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AppConfig {
    token?: string;
    DISCORD_CLIENT_SECRET?: string;
    BASE_URL?: string;
    NODE_ENV?: string;
    DEBUG?: string;
    brave?: string;
    WEB_BASE_URL?: string;
    owner?: string[];
    openai?: {
        apiKey: string;
        apiEndpoint: string;
        defaultModel: string;
    };
}

const configPath = path.resolve(__dirname, '..', 'config.json');

let raw: Partial<AppConfig> = {};
try {
    let data = fs.readFileSync(configPath, 'utf8');
    // remove UTF-8 BOM if present
    if (data.charCodeAt(0) === 0xfeff) data = data.slice(1);
    // also trim whitespace
    const cleaned = data.trim();
    raw = JSON.parse(cleaned) as Partial<AppConfig>;
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
    brave: raw.brave || '',
    WEB_BASE_URL: raw.WEB_BASE_URL || raw.BASE_URL || 'http://localhost:3000',
    owner: raw.owner || [],
    openai: {
        apiKey: raw.openai?.apiKey || '',
        apiEndpoint: raw.openai?.apiEndpoint || '',
        defaultModel: raw.openai?.defaultModel || '',
    },
};


export default config;

/**
 * Check if a given userId is listed as an owner in config
 */
export function isOwner(userId: string): boolean {
    try {
        return Array.isArray(config.owner) && config.owner.includes(userId);
    } catch (e) {
        return false;
    }
}

