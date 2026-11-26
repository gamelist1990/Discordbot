import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../../config.js';
import { database } from '../persistence/Database.js';
import { Logger } from '../../utils/Logger.js';

/** Private key storage inside the bot data directory (never web-served, gitignored). */
export const WEBAUTH_KEYS_RELATIVE_PATH = path.join('system', 'webauth', 'keys.json');
export const WEBAUTH_HMAC_ENV = 'WEBAUTH_HMAC_SECRET';
export const WEBAUTH_ENCRYPTION_ENV = 'WEBAUTH_ENCRYPTION_KEY';
export const KEY_BYTES = 32;

export type KeySource = 'env' | 'config' | 'file' | 'generated';

export interface WebAuthKeys {
    hmacSecret: Buffer;
    encryptionKey: Buffer;
    hmacSource: KeySource;
    encryptionSource: KeySource;
    dataDir: string;
}

interface StoredKeys {
    hmacSecret?: string;
    encryptionKey?: string;
    createdAt?: string;
}

/** Accepts 32-byte hex or standard/base64url base64. */
export function parseKeyMaterial(value: unknown): Buffer | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;
    if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, 'hex');
    try {
        const decoded = Buffer.from(text, 'base64');
        if (decoded.length === KEY_BYTES) return decoded;
    } catch {
        /* fall through */
    }
    try {
        const decoded = Buffer.from(text, 'base64url');
        if (decoded.length === KEY_BYTES) return decoded;
    } catch {
        /* fall through */
    }
    return null;
}

export function generateKey(): Buffer {
    return crypto.randomBytes(KEY_BYTES);
}

export function keyToHex(key: Buffer): string {
    return key.toString('hex');
}

async function readStoredKeys(filePath: string): Promise<StoredKeys> {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as StoredKeys;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

async function writeStoredKeys(filePath: string, keys: StoredKeys): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(keys, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, filePath);
}

export interface KeyResolutionOptions {
    env?: Record<string, string | undefined>;
    configValues?: { hmacSecret?: string; encryptionKey?: string };
    dataDir?: string;
    persist?: boolean;
}

/**
 * Resolution order: environment variable, config.json `webAuth.*`, then the
 * bot's private key file. Missing keys are generated once and persisted with
 * mode 0600 at `<Database>/system/webauth/keys.json`.
 */
export async function loadWebAuthKeys(options: KeyResolutionOptions = {}): Promise<WebAuthKeys> {
    const env = options.env || process.env;
    const configValues = options.configValues || (config as any).webAuth || {};
    const dataDir = options.dataDir || database.getDataDir();
    const filePath = path.join(dataDir, WEBAUTH_KEYS_RELATIVE_PATH);
    const stored = await readStoredKeys(filePath);
    const persist = options.persist !== false;

    const pick = (envName: string, configValue: unknown, storedValue: unknown): { key: Buffer; source: KeySource } => {
        const fromEnv = parseKeyMaterial(env[envName]);
        if (fromEnv) return { key: fromEnv, source: 'env' };
        const fromConfig = parseKeyMaterial(configValue);
        if (fromConfig) return { key: fromConfig, source: 'config' };
        const fromFile = parseKeyMaterial(storedValue);
        if (fromFile) return { key: fromFile, source: 'file' };
        return { key: generateKey(), source: 'generated' };
    };

    const hmac = pick(WEBAUTH_HMAC_ENV, configValues.hmacSecret, stored.hmacSecret);
    const encryption = pick(WEBAUTH_ENCRYPTION_ENV, configValues.encryptionKey, stored.encryptionKey);

    const storedUpdate: StoredKeys = { ...stored };
    let changed = false;
    if (hmac.source === 'generated') {
        storedUpdate.hmacSecret = keyToHex(hmac.key);
        changed = true;
    }
    if (encryption.source === 'generated') {
        storedUpdate.encryptionKey = keyToHex(encryption.key);
        changed = true;
    }
    if (changed && persist) {
        storedUpdate.createdAt = storedUpdate.createdAt || new Date().toISOString();
        try {
            await writeStoredKeys(filePath, storedUpdate);
            Logger.info(`[WebAuth] Generated and persisted key material at ${WEBAUTH_KEYS_RELATIVE_PATH}`);
        } catch (error) {
            Logger.error('[WebAuth] Failed to persist generated key material:', error);
        }
    }

    return {
        hmacSecret: hmac.key,
        encryptionKey: encryption.key,
        hmacSource: hmac.source,
        encryptionSource: encryption.source,
        dataDir
    };
}

/** AES-256-GCM, hex-encoded as iv(12) + tag(16) + ciphertext. */
export function sealPayload(plaintext: string, key: Buffer, iv: Buffer = crypto.randomBytes(12)): string {
    if (key.length !== KEY_BYTES) throw new Error('WebAuth encryption key must be 32 bytes');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('hex');
}

export function openSealedPayload(sealedHex: string, key: Buffer): string {
    if (key.length !== KEY_BYTES) throw new Error('WebAuth encryption key must be 32 bytes');
    const data = Buffer.from(String(sealedHex || ''), 'hex');
    if (data.length < 12 + 16) throw new Error('Sealed payload is too short');
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
