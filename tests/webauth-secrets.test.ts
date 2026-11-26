import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    WEBAUTH_KEYS_RELATIVE_PATH,
    loadWebAuthKeys,
    openSealedPayload,
    parseKeyMaterial,
    sealPayload,
    keyToHex
} from '../src/core/webauth/secrets.ts';

test('key material accepts 32-byte hex and base64 but rejects weak values', () => {
    const key = Buffer.alloc(32, 9);
    assert.deepEqual(parseKeyMaterial(keyToHex(key)), key);
    assert.deepEqual(parseKeyMaterial(key.toString('base64')), key);
    assert.deepEqual(parseKeyMaterial(key.toString('base64url')), key);
    assert.equal(parseKeyMaterial('short'), null);
    assert.equal(parseKeyMaterial(''), null);
    assert.equal(parseKeyMaterial(null), null);
});

test('AES-256-GCM seal/open round-trips and rejects tampering', () => {
    const key = Buffer.alloc(32, 4);
    const sealed = sealPayload('{"ip":"203.0.113.10"}', key);
    assert.match(sealed, /^[0-9a-f]+$/);
    assert.equal(openSealedPayload(sealed, key), '{"ip":"203.0.113.10"}');

    const tampered = `${sealed.slice(0, -2)}00`;
    assert.throws(() => openSealedPayload(tampered, key));
    assert.throws(() => openSealedPayload(sealed, Buffer.alloc(32, 5)));
});

test('generated keys are persisted once and reused on the next load', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webauth-keys-'));
    try {
        const first = await loadWebAuthKeys({ env: {}, configValues: {}, dataDir: dir });
        assert.equal(first.hmacSource, 'generated');
        assert.equal(first.encryptionSource, 'generated');
        assert.equal(first.hmacSecret.length, 32);
        assert.equal(first.encryptionKey.length, 32);

        const filePath = path.join(dir, WEBAUTH_KEYS_RELATIVE_PATH);
        const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
        assert.equal(stored.hmacSecret, keyToHex(first.hmacSecret));
        assert.equal(stored.encryptionKey, keyToHex(first.encryptionKey));

        const second = await loadWebAuthKeys({ env: {}, configValues: {}, dataDir: dir });
        assert.equal(second.hmacSource, 'file');
        assert.equal(second.encryptionSource, 'file');
        assert.deepEqual(second.hmacSecret, first.hmacSecret);
        assert.deepEqual(second.encryptionKey, first.encryptionKey);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('env overrides config, and config overrides the stored file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webauth-keys-'));
    const envKey = Buffer.alloc(32, 1);
    const configKey = Buffer.alloc(32, 2);
    const configEnc = Buffer.alloc(32, 3);
    try {
        await loadWebAuthKeys({
            env: {},
            configValues: { hmacSecret: keyToHex(configKey), encryptionKey: keyToHex(configEnc) },
            dataDir: dir
        });
        const fromConfig = await loadWebAuthKeys({
            env: {},
            configValues: { hmacSecret: keyToHex(configKey), encryptionKey: keyToHex(configEnc) },
            dataDir: dir
        });
        assert.equal(fromConfig.hmacSource, 'config');
        assert.deepEqual(fromConfig.hmacSecret, configKey);

        const fromEnv = await loadWebAuthKeys({
            env: { WEBAUTH_HMAC_SECRET: keyToHex(envKey) },
            configValues: { hmacSecret: keyToHex(configKey), encryptionKey: keyToHex(configEnc) },
            dataDir: dir
        });
        assert.equal(fromEnv.hmacSource, 'env');
        assert.deepEqual(fromEnv.hmacSecret, envKey);
        assert.equal(fromEnv.encryptionSource, 'config');
        assert.deepEqual(fromEnv.encryptionKey, configEnc);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
