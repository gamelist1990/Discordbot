import fs from 'fs';
import path from 'path';

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
try {
    const data = fs.readFileSync(configPath, 'utf8');
    raw = JSON.parse(data) as Partial<AppConfig>;
} catch (err) {
    // If config.json is missing or invalid, fall back to process.env for compatibility
    raw = {
        token: process.env.DISCORD_BOT_TOKEN,
        DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
        BASE_URL: process.env.BASE_URL,
        NODE_ENV: process.env.NODE_ENV,
        DEBUG: process.env.DEBUG,
        WEB_BASE_URL: process.env.WEB_BASE_URL,
    };
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
