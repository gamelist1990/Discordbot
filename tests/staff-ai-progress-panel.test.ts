import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MessageFlags } from 'discord.js';
import { Database } from '../src/core/persistence/Database.ts';
import { StaffAIStreamState } from '../src/commands/staff/subcommands/StaffAIStreamState.ts';
import {
    completedStaffAIReply, buildStaffAIProgressView, handleStaffAIProgressInteraction,
} from '../src/commands/staff/subcommands/StaffAIProgressPanel.ts';

const context = {id: '123456789012345678', guildId: '223456789012345678', channelId: '323456789012345678'};
function fixture(count = 17) {
    const state = new StaffAIStreamState(false, true);
    for (let round = 1; round <= count; round++) {
        state.consumeResponse({type: 'thinking', text: `PRIVATE_THINKING_${round}`});
        state.recordToolCall({name: 'web_search', round, callId: `call${round}`, index: 0,
            arguments: JSON.stringify({query: `query${round}`, secret: 'PRIVATE_ARGUMENT'}),
            argumentCharacters: 50, argumentsComplete: true});
        state.recordToolStep({name: 'web_search', round, callId: `call${round}`, phase: 'started'});
        if (round !== count) state.recordToolStep({name: 'web_search', round, callId: `call${round}`,
            phase: round === 2 ? 'failed' : 'completed', resultSummary: round === 2 ? undefined : `検索結果 ${round}件`});
    }
    state.consumeResponse({type: 'text', text: '最終回答です。'});
    return state;
}
function interaction(customId: string, {privateView = false, selection = 'tools', channelId = context.channelId} = {}) {
    const calls: {method: string; payload: any}[] = [];
    return {calls, value: {
        customId, channelId, guildId: context.guildId, replied: false, deferred: false,
        message: {flags: {has: () => privateView}}, values: [selection],
        isStringSelectMenu: () => customId.endsWith(':select'),
        reply: async (payload: any) => { calls.push({method: 'reply', payload}); },
        deferReply: async (payload: any) => { calls.push({method: 'deferReply', payload}); },
        deferUpdate: async () => { calls.push({method: 'deferUpdate', payload: null}); },
        editReply: async (payload: any) => { calls.push({method: 'editReply', payload}); },
    } as any};
}

test('Many tools collapse into a persistent menu without losing the answer or attachments', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'staff-ai-progress-'));
    try {
        const state = fixture();
        const answer = '長い最終回答。'.repeat(500);
        const payload = await completedStaffAIReply(state, context, answer, new Database(directory));
        assert.ok(payload.content.length <= 2000);
        assert.ok(payload.files?.[0].attachment.toString().includes(answer));
        assert.equal(payload.embeds[0].fields!.length, 0);
        assert.match(payload.embeds[0].description!, /ツール 17件/);
        assert.equal(payload.components.length, 1);
        assert.match(JSON.stringify(payload.components), /処理の詳細を見る/);
        assert.doesNotMatch(JSON.stringify(payload.embeds), /query1/);
        // A fresh Database instance must be able to open the menu after a process restart.
        const storage = new Database(directory);
        const saved = await storage.get<any>(context.guildId, `staff-ai-progress-${context.id}`);
        assert.equal(saved.entries.length, 34);
        assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_THINKING|PRIVATE_ARGUMENT|最終回答/);
        const menu = interaction(`staff-ai-progress:${context.id}:open:select`);
        await handleStaffAIProgressInteraction(menu.value, storage);
        assert.equal(menu.calls[0].method, 'deferReply');
        assert.equal(menu.calls[0].payload.flags, MessageFlags.Ephemeral);
        assert.equal(menu.calls[1].payload.embeds[0].fields.length, 6);
        assert.match(menu.calls[1].payload.embeds[0].description, /17件 · 1\/3ページ/);
        assert.equal(menu.calls[1].payload.content, '');
        assert.equal(menu.calls[1].payload.files, undefined);
    } finally { await rm(directory, {recursive: true, force: true}); }
});

test('Every historical tool is accessible with pagination and filters, with bounded Discord payloads', () => {
    const details = fixture(40).completedProgressDetails()!;
    const titles: string[] = [];
    for (let page = 0; page < 7; page++) {
        const payload = buildStaffAIProgressView(details, context.id, 'tools', page, true);
        assert.ok(payload.embeds[0].fields!.length <= 6);
        assert.ok(JSON.stringify(payload.embeds).length < 6000);
        titles.push(...payload.embeds[0].fields!.map(field => field.value));
    }
    assert.equal(titles.length, 40);
    for (let round = 1; round <= 40; round++) assert.ok(titles.some(value => value.includes(`「query${round}」`)));
    const timeline = buildStaffAIProgressView(details, context.id, 'timeline', 0, true);
    assert.match(timeline.embeds[0].fields![0].name, /Thinking 1/);
    assert.match(timeline.embeds[0].fields![1].name, /Web検索/);
    assert.match(timeline.embeds[0].fields![2].name, /Thinking 2/);
    const attention = buildStaffAIProgressView(details, context.id, 'attention', 0, true);
    assert.equal(attention.embeds[0].fields!.length, 2);
    assert.match(attention.embeds[0].fields![0].value, /query2/);
    assert.match(attention.embeds[0].fields![1].value, /query40/);
    const thinking = buildStaffAIProgressView(details, context.id, 'thinking', 999, true);
    assert.match(thinking.embeds[0].description!, /40件 · 7\/7ページ/);
    assert.doesNotMatch(JSON.stringify(thinking), /PRIVATE_THINKING/);
    const collapsed = buildStaffAIProgressView(details, context.id, 'overview', 0, true);
    assert.equal(collapsed.embeds[0].fields!.length, 0);
    assert.equal(collapsed.components.length, 1);
});

test('Small and legacy replies keep their existing display', async () => {
    const state = fixture(2);
    const payload = await completedStaffAIReply(state, context);
    assert.equal(payload.content, '最終回答です。');
    assert.equal(payload.embeds[0].fields!.length, 2);
    assert.equal(payload.components.length, 0);
    const legacy = new StaffAIStreamState(false, false);
    assert.equal(legacy.completedProgressDetails(), undefined);
});

test('Private navigation folds details, missing history is acknowledged, and other channels cannot read it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'staff-ai-progress-'));
    try {
        const storage = new Database(directory);
        await completedStaffAIReply(fixture(), context, undefined, storage);
        const next = interaction(`staff-ai-progress:${context.id}:view:tools:1`, {privateView: true});
        await handleStaffAIProgressInteraction(next.value, storage);
        assert.equal(next.calls[0].method, 'deferUpdate');
        assert.match(next.calls[1].payload.embeds[0].description, /2\/3ページ/);
        const collapse = interaction(`staff-ai-progress:${context.id}:view:overview:0`, {privateView: true});
        await handleStaffAIProgressInteraction(collapse.value, storage);
        assert.equal(collapse.calls[1].payload.embeds[0].fields.length, 0);
        assert.equal(collapse.calls[1].payload.components.length, 1);
        const otherChannel = interaction(`staff-ai-progress:${context.id}:open:select`, {channelId: '999999999999999999'});
        await handleStaffAIProgressInteraction(otherChannel.value, storage);
        assert.match(otherChannel.calls[1].payload.content, /見つかりません/);
        const missing = interaction('staff-ai-progress:999999999999999999:open:select');
        await handleStaffAIProgressInteraction(missing.value, storage);
        assert.match(missing.calls[1].payload.content, /見つかりません/);
        const forgedPublicNavigation = interaction(`staff-ai-progress:${context.id}:view:tools:1`);
        await handleStaffAIProgressInteraction(forgedPublicNavigation.value, storage);
        assert.equal(forgedPublicNavigation.calls[0].method, 'reply');
        assert.equal(forgedPublicNavigation.calls[0].payload.flags, MessageFlags.Ephemeral);
    } finally { await rm(directory, {recursive: true, force: true}); }
});
