import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SERVER_BUILDER_BUDGET_LIMIT,
    buildPlanMessages,
    buildPromptStructure,
    computeBudgetStatus,
    estimateTokensFromText,
    getStylePreset,
    type GuildStructure,
} from '../src/core/serverBuilder/ServerBuilder.ts';

const GUILD_ID = '999999999999999999';
const CATEGORY_ID = '333333333333333333';
const SYNCED_ID = '111111111111111111';
const UNSYNCED_ID = '222222222222222222';
const LOOSE_ID = '666666666666666666';
const ROLE_ID = '444444444444444444';

function makeStructure(): GuildStructure {
    return {
        guildId: GUILD_ID, guildName: 'テスト',
        categories: [{
            id: CATEGORY_ID, name: '🛡️スタッフ専用', position: 0, isPrivate: true,
            permissionOverwrites: [
                { targetKind: 'everyone', targetId: GUILD_ID, targetName: '@everyone', allow: [], deny: ['ViewChannel'] },
                { targetKind: 'role', targetId: ROLE_ID, targetName: 'Staff', allow: ['ViewChannel', 'SendMessages'], deny: [] },
            ],
        }],
        channels: [
            { id: CATEGORY_ID, name: '🛡️スタッフ専用', kind: 'category', position: 0, permissionOverwrites: [], permissionsSynced: null, isPrivate: true },
            {
                id: SYNCED_ID, name: '💬｜雑談', kind: 'text', parentId: CATEGORY_ID, position: 0, permissionsSynced: true, isPrivate: true,
                permissionOverwrites: [
                    { targetKind: 'everyone', targetId: GUILD_ID, targetName: '@everyone', allow: [], deny: ['ViewChannel'] },
                ],
            },
            {
                id: UNSYNCED_ID, name: 'スタッフ連絡', kind: 'text', parentId: CATEGORY_ID, position: 1, permissionsSynced: false, isPrivate: false,
                topic: 'あ'.repeat(200),
                permissionOverwrites: [
                    { targetKind: 'everyone', targetId: GUILD_ID, targetName: '@everyone', allow: ['ViewChannel'], deny: ['SendMessages'] },
                    { targetKind: 'role', targetId: ROLE_ID, targetName: 'Staff', allow: ['SendMessages'], deny: [] },
                ],
            },
            {
                id: LOOSE_ID, name: '単独チャンネル', kind: 'text', position: 2, permissionsSynced: null, isPrivate: false,
                permissionOverwrites: [],
            },
        ],
        roles: [{ id: ROLE_ID, name: 'Staff' }],
        channelCount: 4,
    };
}

function promptStructureOf(structure: GuildStructure): any {
    return buildPromptStructure(structure) as any;
}

test('プロンプト投影: カテゴリは categories に一本化され channels に重複しない', () => {
    const projected = promptStructureOf(makeStructure());
    assert.equal(projected.categories.length, 1);
    assert.equal(projected.categories[0].id, CATEGORY_ID);
    assert.ok(projected.channels.every((c: any) => c.kind !== 'category'));
    assert.ok(projected.channels.every((c: any) => c.id !== CATEGORY_ID));
    assert.equal(projected.channels.length, 3);
});

test('プロンプト投影: 同期済みチャンネルは上書き詳細を省略し、未同期は保持する', () => {
    const projected = promptStructureOf(makeStructure());
    const synced = projected.channels.find((c: any) => c.id === SYNCED_ID);
    assert.equal(synced.permissionsSynced, true);
    assert.ok(!('permissionOverwrites' in synced), '同期済みは上書きキーを省略する');
    const unsynced = projected.channels.find((c: any) => c.id === UNSYNCED_ID);
    assert.equal(unsynced.permissionsSynced, false);
    assert.ok(Array.isArray(unsynced.permissionOverwrites));
    const loose = projected.channels.find((c: any) => c.id === LOOSE_ID);
    assert.ok(!('permissionsSynced' in loose), 'null の同期状態はキーを省略する');
    assert.deepEqual(loose.permissionOverwrites, []);
});

test('プロンプト投影: 上書きは targetName を落とし、@everyone は targetId を落とす', () => {
    const projected = promptStructureOf(makeStructure());
    const catOw = projected.categories[0].permissionOverwrites;
    const everyone = catOw.find((o: any) => o.targetKind === 'everyone');
    assert.ok(!('targetId' in everyone));
    assert.ok(!('targetName' in everyone));
    assert.deepEqual(everyone.deny, ['ViewChannel']);
    const role = catOw.find((o: any) => o.targetKind === 'role');
    assert.equal(role.targetId, ROLE_ID);
    assert.ok(!('targetName' in role));
    assert.deepEqual(role.allow, ['ViewChannel', 'SendMessages']);
});

test('プロンプト投影: トピックは上限で切り詰められる', () => {
    const projected = promptStructureOf(makeStructure());
    const unsynced = projected.channels.find((c: any) => c.id === UNSYNCED_ID);
    assert.equal(unsynced.topic.length, 121);
    assert.ok(unsynced.topic.endsWith('…'));
});

test('buildPlanMessages: 構造JSONにカテゴリが二重に載らない', () => {
    const messages = buildPlanMessages({ request: 'テスト', style: getStylePreset('plain')!, structure: makeStructure() });
    const user = messages.find(m => m.role === 'user')!.content;
    const jsonText = user.match(/<server-structure>([\s\S]*?)<\/server-structure>/)?.[1];
    assert.ok(jsonText);
    const parsed = JSON.parse(jsonText!);
    assert.equal(parsed.channels.filter((c: any) => c.id === CATEGORY_ID).length, 0);
    assert.equal(parsed.categories.filter((c: any) => c.id === CATEGORY_ID).length, 1);
});

test('見積り: 実測較正した係数（0.45/文字 + 16）で計算する', () => {
    assert.equal(estimateTokensFromText('a'.repeat(1000)), Math.ceil(1000 * 0.45) + 16);
    assert.equal(estimateTokensFromText(''), 16);
});

test('予算上限: 300,000トークンで残量計算される', () => {
    assert.equal(SERVER_BUILDER_BUDGET_LIMIT, 300_000);
    const status = computeBudgetStatus([], Date.now());
    assert.equal(status.limit, 300_000);
    assert.equal(status.remaining, 300_000);
    const used = computeBudgetStatus([{ at: Date.now(), tokens: 120_000 }], Date.now());
    assert.equal(used.remaining, 180_000);
});
