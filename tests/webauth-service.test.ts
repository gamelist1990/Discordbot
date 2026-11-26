import test from 'node:test';
import assert from 'node:assert/strict';
import { WebAuthService } from '../src/core/webauth/WebAuthService.ts';
import { WEB_AUTH_BLOCK_MESSAGE } from '../src/core/webauth/WebAuthService.ts';
import { WebAuthTokenStore } from '../src/core/webauth/tokens.ts';
import { WebAuthRecordStore } from '../src/core/webauth/records.ts';
import { IpIntelClient } from '../src/core/webauth/ipIntel.ts';
import { hashFingerprint, hashIp, normalizeFingerprintSignals } from '../src/core/webauth/fingerprint.ts';
import { createWebAuthRecord } from '../src/core/webauth/records.ts';
import { antiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ALT_GRAPH_SETTINGS } from '../src/core/anticheat/types.ts';

const GUILD_ID = 'guild-service';
const USER_ID = '900000000000000123';
const IP = '203.0.113.10';
const SECRET = Buffer.alloc(32, 11);
const ENC = Buffer.alloc(32, 12);

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

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
    // Auth-point block inputs are storage/anti-cheat reads; each test that
    // exercises the block overrides this with the data it needs.
    (service as any).loadBlockContext = async () => ({
        settings: { exact: true, fuzzy: true, graph: true },
        altGraph: { ...DEFAULT_ALT_GRAPH_SETTINGS },
        riskKicks: [],
        watchEntries: []
    });

    return { service, tokens, records, data, member, guild, added };
}

/**
 * Solves the drag check with a jittered, human-like trajectory so the
 * submit gate (challengePassed) is satisfied in the flow tests below.
 */
async function passChallenge(service: WebAuthService, token: string, userAgent = CHROME_UA): Promise<void> {
    const challenge = service.issueChallenge(token);
    assert.ok(challenge, 'challenge issued');
    const item = challenge!.items.find((entry) => entry.id === challenge!.correctItemId)!;
    const target = challenge!.target;
    const dx = target.x - item.x;
    const dy = target.y - item.y;
    const length = Math.hypot(dx, dy) || 1;
    const perpendicularX = -dy / length;
    const perpendicularY = dx / length;
    const count = 40;
    const samples = Array.from({ length: count }, (_value, index) => {
        const ratio = index / (count - 1);
        const wobble = Math.sin(ratio * Math.PI * 3) * 5;
        return {
            t: Math.round(ratio * 800),
            x: Number((item.x + dx * ratio + perpendicularX * wobble).toFixed(1)),
            y: Number((item.y + dy * ratio + perpendicularY * wobble).toFixed(1))
        };
    });
    const result = await service.verifyChallenge({
        token,
        itemId: item.id,
        drop: { x: target.x, y: target.y },
        samples,
        userAgent
    });
    assert.equal(result.ok, true, 'drag check passes');
}

test('submit stores hashes + sealed data, consumes the token and never stores raw values', async () => {
    const { service, tokens, records } = setup();
    const { token } = service.createToken({ guildId: GUILD_ID, userId: USER_ID, presetId: 'preset', roleIds: ['role-a'] });
    await passChallenge(service, token);

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

test('an iOS Safari submit is stored with browser name safari and degrades gracefully', async () => {
    const { service, records } = setup();
    const { token } = service.createToken({ guildId: GUILD_ID, userId: USER_ID });
    await passChallenge(service, token, SAFARI_UA);

    // Safari-shaped payload: no UA-CH, no deviceMemory, restricted WebGL.
    const safariSignals = {
        userAgent: SAFARI_UA,
        uaCh: {},
        screen: { width: 390, height: 844, colorDepth: 24, pixelDepth: 24 },
        timezone: 'Asia/Tokyo',
        languages: ['ja-JP'],
        hardwareConcurrency: 4,
        deviceMemory: 0,
        canvasHash: 'safari-canvas',
        webglVendor: '',
        webglRenderer: '',
        touch: { maxTouchPoints: 5, touchEvent: true }
    };
    const result = await service.submit({ token, clientIp: IP, socketIp: '10.0.0.97', signals: safariSignals as any });
    assert.equal(result.ok, true);
    const record = (await records.list(GUILD_ID))[0];
    assert.equal(record.browser.name, 'safari');
    assert.ok(record.signalHashes, 'component hashes stored');
    assert.equal(record.signalHashes.webgl, undefined, 'missing WebGL is simply absent');
    assert.ok(record.signalHashes.platform, 'the platform component survives without UA-CH');
    assert.equal(JSON.stringify(record).includes(SAFARI_UA), false);
});

test('VPN-flagged IPs and non-Chromium browsers are refused and the token stays usable', async () => {
    const { service, tokens } = setup('blocked');
    const { token } = service.createToken({ guildId: GUILD_ID, userId: USER_ID });

    await passChallenge(service, token);

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
        await passChallenge(service, token);
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
    await passChallenge(service, token);
    const result = await service.submit({ token, clientIp: IP, socketIp: '10.0.0.97', signals: SIGNALS as any });
    assert.equal(result.ok, true);
    const record = (await records.list(GUILD_ID))[0];
    assert.equal(record.intel.verdict, 'unavailable');
});

test('a kicked-device match blocks the auth before any role grant and consumes the token', async () => {
    const { service, tokens, records } = setup();
    const fpHash = hashFingerprint(SECRET, normalizeFingerprintSignals(SIGNALS as any));
    await records.add(GUILD_ID, createWebAuthRecord({
        guildId: GUILD_ID,
        userId: 'kicked-peer',
        source: 'web',
        browser: { name: 'chrome', reason: 'ok' },
        intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
        ipHash: hashIp(SECRET, IP),
        fpHash,
        sealed: null
    }));
    (service as any).loadBlockContext = async () => ({
        settings: { exact: true, fuzzy: true, graph: true },
        altGraph: { ...DEFAULT_ALT_GRAPH_SETTINGS },
        riskKicks: [{ userId: 'kicked-peer', ts: Date.now(), source: 'raid', reason: 'raid' }],
        watchEntries: []
    });

    let grants = 0;
    (service as any).grantVerifiedRoles = async () => {
        grants += 1;
        return { granted: ['verified'], errors: [], skipped: [] };
    };
    const flagCalls: any[] = [];
    const blockLogs: any[] = [];
    const originalFlag = antiCheatManager.flagWatchUserFromWebAuth;
    const originalBlockLog = antiCheatManager.sendWebAuthBlockLog;
    (antiCheatManager as any).flagWatchUserFromWebAuth = async (...args: any[]) => { flagCalls.push(args); return true; };
    (antiCheatManager as any).sendWebAuthBlockLog = async (...args: any[]) => { blockLogs.push(args); };
    try {
        const { token } = service.createToken({ guildId: GUILD_ID, userId: USER_ID });
        await passChallenge(service, token);
        const result = await service.submit({ token, clientIp: IP, socketIp: '10.0.0.97', signals: SIGNALS as any });

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.status, 'risk');
        assert.equal(result.message, WEB_AUTH_BLOCK_MESSAGE);
        // No role and no verification.
        assert.equal(grants, 0, 'roles are never granted on a block');
        assert.equal(flagCalls.length, 0, 'a blocked attempt is not also watch-flagged');
        assert.equal(blockLogs.length, 1, 'exactly one staff block embed');
        assert.equal(blockLogs[0][1], USER_ID);
        assert.deepEqual(blockLogs[0][2].rules, ['exact', 'graph']);

        // The token is burned, not released for a retry.
        assert.equal(tokens.peek(token).status, 'missing');
        const replay = await service.submit({ token, clientIp: IP, socketIp: '10.0.0.97', signals: SIGNALS as any });
        assert.equal(replay.ok, false);
        if (!replay.ok) assert.equal(replay.status, 'invalid');

        // The attempt is recorded as blocked, with the evidence kept.
        const blocked = (await records.list(GUILD_ID)).find((entry) => entry.userId === USER_ID);
        assert.ok(blocked);
        assert.equal(blocked!.verified, false);
        assert.equal(blocked!.roleGranted, false);
        assert.deepEqual(blocked!.blocked?.rules, ['exact', 'graph']);
        assert.deepEqual(blocked!.blocked?.matchedUserIds, ['kicked-peer']);
        assert.equal(JSON.stringify(blocked).includes(IP), false, 'no raw IP in the blocked record');
    } finally {
        (antiCheatManager as any).flagWatchUserFromWebAuth = originalFlag;
        (antiCheatManager as any).sendWebAuthBlockLog = originalBlockLog;
    }
});

test('staff force-verify still grants roles to a blocked user (false-positive escape hatch)', async () => {
    const { service, records } = setup();
    await records.add(GUILD_ID, createWebAuthRecord({
        guildId: GUILD_ID,
        userId: USER_ID,
        source: 'web',
        browser: { name: 'chrome', reason: 'ok' },
        intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
        ipHash: hashIp(SECRET, IP),
        fpHash: null,
        sealed: null,
        verified: false,
        blocked: {
            rules: ['exact'],
            matchedUserIds: ['kicked-peer'],
            at: new Date().toISOString()
        }
    }));

    const result = await service.forceVerify({ guildId: GUILD_ID, userId: USER_ID, note: 'shared PC' });
    assert.equal('error' in result, false);
    if ('error' in result) return;
    assert.equal(result.record.source, 'staff');
    assert.equal(result.record.verified, true);
    assert.deepEqual(result.grant.granted, ['verified']);

    const staffRecord = (await records.list(GUILD_ID)).find((entry) => entry.source === 'staff');
    assert.ok(staffRecord, 'force-verify writes its own verified staff record');
    assert.equal(staffRecord!.blocked, null);
});
