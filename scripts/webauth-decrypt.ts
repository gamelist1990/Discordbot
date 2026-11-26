#!/usr/bin/env bun
/**
 * Local-only decryption tool for WebAuth sealed records.
 *
 * Usage:
 *   bun run scripts/webauth-decrypt.ts --guild <guildId> [--user <userId>] [--record <recordId>]
 *   bun run scripts/webauth-decrypt.ts --guild <guildId> --list
 *
 * Key resolution matches the server: WEBAUTH_ENCRYPTION_KEY env var, then
 * config.json `webAuth.encryptionKey`, then Database/system/webauth/keys.json.
 *
 * Output contains raw IPs and browser signals. It is printed to stdout only;
 * nothing is sent over the network or written to a log.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function usage(message?: string): never {
    if (message) console.error(`error: ${message}`);
    console.error('usage: bun run scripts/webauth-decrypt.ts --guild <guildId> [--user <userId>] [--record <recordId>] [--list] [--data-dir <dir>] [--keys-file <file>]');
    process.exit(2);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
    const out: Record<string, string | boolean> = {};
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('--')) usage(`unexpected argument: ${arg}`);
        const key = arg.slice(2);
        if (key === 'list') {
            out[key] = true;
            continue;
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) usage(`missing value for --${key}`);
        out[key] = value;
        index += 1;
    }
    return out;
}

function parseKeyMaterial(value: unknown): Buffer | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const text = value.trim();
    if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, 'hex');
    for (const encoding of ['base64', 'base64url'] as const) {
        try {
            const decoded = Buffer.from(text, encoding);
            if (decoded.length === 32) return decoded;
        } catch {
            /* ignore */
        }
    }
    return null;
}

function readJson(filePath: string): any {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function resolveEncryptionKey(args: Record<string, string | boolean>): Buffer {
    const fromEnv = parseKeyMaterial(process.env.WEBAUTH_ENCRYPTION_KEY);
    if (fromEnv) return fromEnv;
    const fromConfig = parseKeyMaterial(readJson(path.join(ROOT, 'config.json'))?.webAuth?.encryptionKey);
    if (fromConfig) return fromConfig;
    const dataDir = typeof args['data-dir'] === 'string'
        ? path.resolve(String(args['data-dir']))
        : path.join(ROOT, 'Database');
    const keysFile = typeof args['keys-file'] === 'string'
        ? path.resolve(String(args['keys-file']))
        : path.join(dataDir, 'system', 'webauth', 'keys.json');
    const fromFile = parseKeyMaterial(readJson(keysFile)?.encryptionKey);
    if (fromFile) return fromFile;
    throw new Error(`encryption key not found (env WEBAUTH_ENCRYPTION_KEY, config.json webAuth.encryptionKey, or ${keysFile})`);
}

function openSealed(sealedHex: string, key: Buffer): any {
    const data = Buffer.from(String(sealedHex || ''), 'hex');
    if (data.length < 28) throw new Error('sealed payload is too short');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext);
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const guildId = typeof args.guild === 'string' ? args.guild : '';
    if (!/^[0-9A-Za-z_-]{1,64}$/.test(guildId)) usage('--guild is required');
    const dataDir = typeof args['data-dir'] === 'string'
        ? path.resolve(String(args['data-dir']))
        : path.join(ROOT, 'Database');
    const recordsPath = path.join(dataDir, 'guilds', guildId, 'webauth', 'records.json');
    const document = readJson(recordsPath);
    const records: any[] = Array.isArray(document?.records) ? document.records : [];
    if (!records.length) {
        console.error(`no WebAuth records at ${recordsPath}`);
        process.exit(1);
    }

    if (args.list) {
        console.log(JSON.stringify(records.map((record) => ({
            id: record.id,
            userId: record.userId,
            createdAt: record.createdAt,
            source: record.source,
            verified: record.verified,
            browser: record.browser,
            intel: record.intel,
            hasIpHash: !!record.ipHash,
            hasFpHash: !!record.fpHash,
            hasSealed: !!record.sealed
        })), null, 2));
        return;
    }

    const userId = typeof args.user === 'string' ? args.user : '';
    const recordId = typeof args.record === 'string' ? args.record : '';
    const selected = records.filter((record) => (
        (!userId || record.userId === userId) && (!recordId || record.id === recordId)
    ));
    if (!selected.length) {
        console.error('no matching record (specify --user or --record; use --list to inspect)');
        process.exit(1);
    }
    if (selected.length > 1 && !recordId) {
        console.error(`${selected.length} records match; add --record <id> (use --list)`);
        process.exit(1);
    }

    const key = resolveEncryptionKey(args);
    const output = selected.map((record) => {
        if (!record.sealed) return { id: record.id, userId: record.userId, source: record.source, sealed: null };
        let payload: any;
        try {
            payload = openSealed(record.sealed, key);
        } catch (error) {
            return { id: record.id, userId: record.userId, error: `decrypt failed: ${error instanceof Error ? error.message : String(error)}` };
        }
        return { id: record.id, userId: record.userId, createdAt: record.createdAt, payload };
    });
    console.log(JSON.stringify(output.length === 1 ? output[0] : output, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
