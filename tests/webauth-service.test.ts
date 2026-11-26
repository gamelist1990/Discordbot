import test from 'node:test';
import assert from 'node:assert/strict';
import { WebAuthService } from '../src/core/webauth/WebAuthService.ts';
import { WebAuthTokenStore } from '../src/core/webauth/tokens.ts';
import { WebAuthRecordStore } from '../src/core/webauth/records.ts';
import { IpIntelClient } from '../src/core/webauth/ipIntel.ts';
import { hashFingerprint, hashIp, normalizeFingerprintSignals } from '../src/core/webauth/fingerprint.ts';
import { createWebAuthRecord } from '../src/core/webauth/records.ts';
import { antiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';

const GUILD_ID = 'guild-service';
const USER_ID = '900000000000000123';
const IP = '203.0.113.10';
const SECRET = Buffer.alloc(32, 11);
const ENC = Buffer.alloc(32, 12);

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

const SIGNALS = {
    userAgent: CHROME_UA,
    uaCh: { platform: 'Windows', platformVersion: '15.0.0', mobile: false, brands: [{ brand: 'Google Chrome', version: '131' }] },
    screen: { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
    timezone: 'Asia/Tokyo',
    languages: ['ja-JP'],
    hardwareConcurrency: 8,
    deviceMemory: 8,
    canvasHash: 'abc123',
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE',
    touch: { maxTouchPoints: 0, touchEvent: false }
};

function setup(intelVerdict: 'clean' | 'blocked' = 'clean') {
    const data = new Map<string, any>();
    const db = {
        get: async (_guildId: string, key: string) => data.get(key) ?? null,
        set: async (_guildId: string, key: string, value: any) => { data.set(key, structuredClone(value)); }
    };
    const tokens = new WebAuthTokenStore();
    const records = new WebAuthRecordStore(db as any);
    const intel = new IpIntelClient({
        fetchImpl: (async () => new Response(JSON.stringify({
            status: 'success',
            proxy: intelVerdict === 'blocked',
            hosting: false
        }), { status: 200 })) as any
    });

    const roles = new Map<string, any>();
    const added: string[] = [];
    const member: any = {
        id: USER_ID,
        displayName: 'Test User',
        user: { id: USER_ID, username: 'testuser', bot: false, tag: 'testuser#0001', createdTimestamp: Date.now() - 365 * 24 * 60 * 60 * 1000 },
        roles: { cache: new Set<string>(), add: async (role: any) => { added.push(role.id); } }
    };
    const guild: any = {
        id: GUILD_ID,
        name: 'Test Guild',
        ownerId: 'owner-id',
        members: {
            cache: new Map([[USER_ID, member]]),
            fetch: async (id: string) => (id === USER_ID ? member : null)
        },
        roles: { cache: roles }
    };
    const botClient: any = { client: { guilds: { cache: new Map([[GUILD_ID, guild]]), fetch: async () => guild } } };

    const service = new WebAuthService({ tokens, records, intel });
    service.setBotClient(botClient);
    (service as any).keysPromise = Promise.resolve({
        hmacSecret: SECRET, encryptionKey: ENC,
        hmacSource: 'env', encryptionSource: 'env', dataDir: ''
    });
    (service as any).grantVerifiedRoles = async () => ({ granted: ['verified'], errors: [], skipped: [] });

    return { service, tokens, records, data, member, guild, added };
}

test('submit stores hashes + sealed data, consumes the token and never stores raw values', async () => {
    const { service, tokens, records } = setup();
    const { token } = service.createToken({ guildId: GUILD_ID, userId: USER_ID, presetId: 'preset', roleIds: ['role-a'] });

    const result = await service.submit({
        token, clientIp: IP, socketIp: '10.0.0.97', signals: SIGNALS as any
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.roleGranted, true);
    assert.equal(result.matchCount, 0);

    const stored = await records.list(GUILD_ID);
    assert.equal(stored.length, 1);
    const record = stored[0];
    assert.equal(record.userId, USER_ID);
    assert.equal(record.source, 'web');
    assert.equal(record.browser.name, 'chrome');
    assert.equal(record.intel.verdict, 'clean');
    assert.equal(record.ipHash, hashIp(SECRET, IP));
    assert.equal(record.fpHash, hashFingerprint(SECRET, normalizeFingerprintSignals(SIGNALS as any)));
    assert.match(record.sealed || '', /^[0-9a-f]+$/);

    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes(IP), false, 'raw IP not stored in plain text');
    assert.equal(serialized.includes(CHROME_UA), false, 'raw UA not stored in plain text');
    assert.equal(serialized.includes('Asia/Tokyo'), false, 'raw timezone not stored in plain text');

    assert.equal(tokens.peek(token).status, 'missing', 'token consumed');
    const replay = await service.submit({
        token, clientIp: IP, socketIp: '10.0.0.97', signals: SIGNALS as any
    });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.status, 'invalid');
    assert.equal((await records.list(GUILD_ID)).length, 1);
});

test('VPN-flagged IPs and non-Chromium browsers are refused and the token stays usable', async () => {
    const { service, tokens } = setup('blocked');
    const { token } = service.createToken({ guildId: GUILD_ID, userId: USER_ID });

    const vpn = await service.submit({ token, clientIp: IP, socketIp: '10.0.0.97', signals: SIGNALS as any });
    assert.equal(vpn.ok, false);
    if (!vpn.ok) assert.equal(vpn.status, 'vpn');
    assert.equal(tokens.peek(token).status, 'valid', 'failed attempt does not burn the token');

    const firefox = await service.submit({
        token, clientIp: IP, socketIp: '10.0.0.97',
        signals: { ...SIGNALS, userAgent: FIREFOX_UA, uaCh: { ...SIGNALS.uaCh, brands: [] } } as any
    });
    assert.equal(firefox.ok, false);
    if (!firefox.ok) assert.equal(firefox.status, 'browser');
    assert.equal(tokens.peek(token).status, 'valid');
});

test('a correlated risk match flags the new user and logs once', async () => {
    const { service, records } = setup();
    const fpHash = hashFingerprint(SECRET, normalizeFingerprintSignals(SIGNALS as any));
    const peer = createWebAuthRecord({
        guildId: GUILD_ID,
        userId: 'risk-peer',
        source: 'web',
        browser: { name: 'chrome', reason: 'ok' },
        intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
        ipHash: hashIp(SECRET, IP),
        fpHash,
        sealed: null
    });
    await records.add(GUILD_ID, peer);

    (service as any).annotateRisks = async (_guildId: string, matches: any[]) =>
        matches.map((match) => ({ ...match, risks: ['raid-kick'] }));

    const flagCalls: any[] = [];
    const logCalls: any[] = [];
    const originalFlag = antiCheatManager.flagWatchUserFromWebAuth;
    const originalLog = antiCheatManager.sendWebAuthCorrelationLog;
    (antiCheatManager as any).flagWatchUserFromWebAuth = async (...args: any[]) => { flagCalls.push(args); return true; };
    (antiCheatManager as any).sendWebAuthCorrelationLog = async (...args: any[]) => { logCalls.push(args); };
    try {
        const { token } = service.createToken({ guildId: GUILD_ID, userId: USER_ID });
        const result = await service.submit({ token, clientIp: IP, socketIp: '10.0.0.97', signals: SIGNALS as any });
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.matchCount, 1);
        assert.equal(result.flagged, true);
        assert.equal(flagCalls.length, 1);
        assert.equal(logCalls.length, 1);
        assert.equal(flagCalls[0][2].matches[0].risks[0], 'raid-kick');
    } finally {
        (antiCheatManager as any).flagWatchUserFromWebAuth = originalFlag;
        (antiCheatManager as any).sendWebAuthCorrelationLog = originalLog;
    }
});

test('intel unavailable still verifies and records the unverified verdict', async () => {
    const { service, records } = setup();
    (service as any).intel = new IpIntelClient({
        fetchImpl: (async () => { throw new Error('down'); }) as any
    });
    (service as any).annotateRisks = async () => [];
    const { token } = service.createToken({ guildId: GUILD_ID, userId: USER_ID });
    const result = await service.submit({ token, clientIp: IP, socketIp: '10.0.0.97', signals: SIGNALS as any });
    assert.equal(result.ok, true);
    const record = (await records.list(GUILD_ID))[0];
    assert.equal(record.intel.verdict, 'unavailable');
});
