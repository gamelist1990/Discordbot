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
        proxyEndpoints?: string[];
        rateLimitMaxWaitMs?: number;
    };
    pexAi?: {
        endpoint: string;
        model: string;
        fallbackModel: string;
        steps?: Array<{
            model: string;
            level: 0 | 1 | 2 | 3;
        }>;
        visionModel: string;
        apiKey: string;
        level: 0 | 1 | 2 | 3;
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
        proxyEndpoints: Array.isArray(raw.openai?.proxyEndpoints)
            ? raw.openai?.proxyEndpoints.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            : [],
        rateLimitMaxWaitMs: typeof raw.openai?.rateLimitMaxWaitMs === 'number' && Number.isFinite(raw.openai.rateLimitMaxWaitMs)
            ? Math.max(15_000, Math.round(raw.openai.rateLimitMaxWaitMs))
            : 3 * 60 * 1000,
    },
    pexAi: {
        endpoint: raw.pexAi?.endpoint || 'http://api.pexserver.com:9000/v1',
        model: raw.pexAi?.model || 'gemma4-agent',
        fallbackModel: raw.pexAi?.fallbackModel || '@cf/google/gemma-4-26b-a4b-it',
        steps: Array.isArray(raw.pexAi?.steps)
            ? raw.pexAi.steps
                .filter(step =>
                    step
                    && typeof step.model === 'string'
                    && step.model.trim().length > 0
                    && [0, 1, 2, 3].includes(step.level),
                )
                .map(step => ({
                    model: step.model.trim(),
                    level: step.level,
                }))
            : [],
        visionModel: raw.pexAi?.visionModel || 'moondream:1.8b-v2-q2_K',
        apiKey: raw.pexAi?.apiKey || '',
        level: raw.pexAi?.level === 0
            || raw.pexAi?.level === 1
            || raw.pexAi?.level === 2
            || raw.pexAi?.level === 3
            ? raw.pexAi.level
            : 1,
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

