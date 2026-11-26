import test from 'node:test';
import assert from 'node:assert/strict';
import { AntiCheatManager } from '../src/core/anticheat/AntiCheatManager.ts';
import { DEFAULT_ANTICHEAT_SETTINGS } from '../src/core/anticheat/types.ts';
import { CacheManager } from '../src/utils/CacheManager.ts';
import { createWebAuthRecord } from '../src/core/webauth/records.ts';

(globalThis as any)._cacheCleanupInterval?.unref?.();

const DAY = 24 * 60 * 60 * 1000;

function setup() {
    CacheManager.clear();
    const manager = new AntiCheatManager();
    const settings = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
    settings.enabled = true;
    settings.watch.enabled = true;
    settings.logChannelId = 'log-channel';
    // Graph integration only; avoid unrelated raid evaluation.
    settings.detectors.raidDetection.enabled = false;

    manager.getSettings = async () => settings;
    manager.setSettings = async (_guildId: string, next: any) => {
        Object.assign(settings, structuredClone(next));
    };

    const sent: any[] = [];
    (manager as any).fetchLogChannel = async () => ({
        send: async (payload: any) => { sent.push(payload); return null; }
    });

    const members = new Map<string, any>();
    let guild: any;
    const member = (id: string, overrides: Record<string, any> = {}) => {
        const created: any = {
            id,
            guild,
            displayName: 'Friendly Name',
            user: {
                id,
                bot: false,
                tag: `${id}#0001`,
                username: id,
                globalName: null,
                avatar: null,
                createdTimestamp: Date.now() - 365 * DAY
            },
            roles: { cache: new Set<string>() },
            permissions: { has: () => false },
            kickable: true,
            ...overrides
        };
        members.set(id, created);
        return created;
    };

    guild = {
        id: 'guild',
        name: 'Guild',
        ownerId: 'owner',
        members: {
            cache: members,
            fetch: async (id: string) => members.get(id) ?? null
        },
        channels: { cache: new Map() }
    };
    (manager as any).client = {
        guilds: {
            cache: new Map([['guild', guild]]),
            fetch: async () => guild
        }
    };

    return { manager, settings, sent, guild, member };
}

function record(userId: string, overrides: Record<string, unknown> = {}) {
    return createWebAuthRecord({
        guildId: 'guild',
        userId,
        source: 'web',
        browser: { name: 'chrome', reason: 'ok' },
        intel: { verdict: 'clean', flags: [], source: 'ip-api.com' },
        ipHash: null,
        fpHash: null,
        sealed: null,
        ...overrides
    } as any);
}

const kick = (userId: string) => ({ userId, ts: Date.now(), source: 'raid' as const, reason: 'raid' });

test('a WebAuth event flags a user through the graph and logs exactly one embed', async () => {
    const { manager, settings, sent, member } = setup();
    member('target');
    member('bad');

    const flagged = await manager.evaluateAltGraphForUser('guild', 'target', 'webauth', {
        webAuthRecords: [
            record('target', { fpHash: 'f'.repeat(64) }),
            record('bad', { fpHash: 'f'.repeat(64) })
        ],
        riskKicks: [kick('bad')]
    });

    assert.equal(flagged, true);
    const entry = settings.watchUsers.target;
    assert.equal(entry.reason, 'graph');
    assert.deepEqual(entry.signals, ['graph']);
    assert.equal(entry.source, 'graph');
    assert.equal(entry.dismissed, null);

    assert.equal(sent.length, 1);
    const embed = sent[0].embeds[0];
    assert.match(embed.data.title, /相関グラフで危険アカウントと連結/);
    assert.equal(embed.data.fields.find((field: any) => field.name === '相関スコア').value, '5 / 5');
    assert.match(
        embed.data.fields.find((field: any) => field.name === '主要リンク').value,
        /端末ハッシュ一致 \+5.*bad#0001 \(bad\)/
    );
});

test('subnet+ASN alone never flags, even toward a bad node', async () => {
    const { manager, settings, sent, member } = setup();
    member('target');
    member('bad');

    const flagged = await manager.evaluateAltGraphForUser('guild', 'target', 'webauth', {
        webAuthRecords: [
            record('target', { subnetHash: 'a1'.repeat(32), asn: 'AS2516' }),
            record('bad', { subnetHash: 'a1'.repeat(32), asn: 'AS2516' })
        ],
        riskKicks: [kick('bad')]
    });

    assert.equal(flagged, false);
    assert.equal(settings.watchUsers.target, undefined);
    assert.equal(sent.length, 0);
});

test('a graph flag is sticky through a clean watch re-evaluation', async () => {
    const { manager, settings, sent, member } = setup();
    const target = member('target');
    member('bad');

    await manager.evaluateAltGraphForUser('guild', 'target', 'webauth', {
        webAuthRecords: [
            record('target', { fpHash: 'f'.repeat(64) }),
            record('bad', { fpHash: 'f'.repeat(64) })
        ],
        riskKicks: [kick('bad')]
    });
    assert.equal(settings.watchUsers.target.reason, 'graph');

    // No heuristic signal matches, but the hard correlation must survive.
    await (manager as any).evaluateWatchMember(target, settings, 'message');
    assert.equal(settings.watchUsers.target.reason, 'graph');
    assert.deepEqual(settings.watchUsers.target.signals, ['graph']);
    assert.equal(sent.length, 1, 'no second flag embed');
});

test('already-flagged users and self-links are never re-flagged', async () => {
    const { manager, settings, sent, member } = setup();
    member('target');
    settings.watchUsers.target = {
        reason: 'new-account',
        signals: ['new-account'],
        since: new Date().toISOString(),
        source: 'join',
        nameSnapshot: 'Friendly Name',
        dismissed: null
    };

    const flagged = await manager.evaluateAltGraphForUser('guild', 'target', 'webauth', {
        webAuthRecords: [record('target', { fpHash: 'f'.repeat(64) })],
        riskKicks: [kick('target')]
    });
    assert.equal(flagged, false);
    assert.equal(settings.watchUsers.target.reason, 'new-account');
    assert.equal(sent.length, 0);
});
