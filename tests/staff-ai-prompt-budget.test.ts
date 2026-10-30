import test from 'node:test';
import assert from 'node:assert/strict';
import { STAFF_AI_PROMPT_BUDGET } from '../src/commands/staff/subcommands/StaffAIStyle.ts';
import { buildConversationHistory } from '../src/core/ai/AIConversationHistory.ts';
import { buildGuildAIPersonalityPrompt, DEFAULT_GUILD_AI_PERSONALITY } from '../src/core/ai/GuildAIPersonality.ts';
import { staffMemoryContext } from '../src/core/ai/StaffAIMemory.ts';
import { database } from '../src/core/persistence/Database.ts';
import { isStaffAIContextLimitError } from '../src/commands/staff/subcommands/StaffAIRequestError.ts';

test('A single oversized history message cannot bypass the total budget, including instructions', () => {
    const history = buildConversationHistory({dataset: [], channelId: 'channel',
        maxCharacters: STAFF_AI_PROMPT_BUDGET.historyCharacters,
        channelMessages: [{id: 'huge', timestamp: 1, role: 'user', authorName: 'Alice', content: '長い履歴'.repeat(4000)}]});
    const length = history.reduce((sum, message) => sum + String(message.content).length, 0);
    assert.ok(length <= STAFF_AI_PROMPT_BUDGET.historyCharacters);
    assert.equal(history[0].role, 'system');
    assert.match(String(history[1].content), /Alice/);
    assert.ok(String(history[1].content).endsWith('…'));
    assert.deepEqual(buildConversationHistory({dataset: [], channelId: 'channel', maxCharacters: 1,
        channelMessages: [{id: 'tiny', timestamp: 1, role: 'user', authorName: 'Alice', content: 'test'}]}), []);
});

test('Compact style omits unused defaults but preserves actual server style and user instructions', () => {
    // The roleplay definition is always present; unused style defaults are still omitted from the compact prompt.
    const defaults = buildGuildAIPersonalityPrompt(DEFAULT_GUILD_AI_PERSONALITY, true);
    assert.match(defaults, /ロールプレイ定義/);
    assert.doesNotMatch(defaults, /口調:|ユーモア:|絵文字:|詳しさ:/);
    assert.ok(buildGuildAIPersonalityPrompt(DEFAULT_GUILD_AI_PERSONALITY).length > 0);
    const configured = buildGuildAIPersonalityPrompt({...DEFAULT_GUILD_AI_PERSONALITY,
        tone: 'polite', verbosity: 'detailed', customInstructions: '語尾は落ち着いた表現にする。', learnedSummary: 'ゲーム制作の話題が多い。'}, true);
    assert.match(configured, /丁寧|詳しく|語尾|ゲーム制作/);
    assert.match(configured, /本人の希望を優先/);
    assert.ok(configured.length < 900);
});

test('Compact memory excludes retired per-user profiles and recalls daily notes only when requested', async () => {
    const original = database.get;
    database.get = (async () => [
        {kind: 'user', userId: 'alice', title: 'Alice', content: '本人の好み', updatedAt: '2026-10-21'},
        {kind: 'user', userId: 'bob', title: 'Bob', content: '他人の非公開情報', updatedAt: '2026-10-21'},
        {kind: 'daily', title: '日次要約', content: 'サーバーの出来事', updatedAt: '2026-10-21'},
    ]) as typeof database.get;
    try {
        const casual = await staffMemoryContext('guild', 'alice', 'こんにちは', true);
        assert.equal(casual, ''); // Retired per-user profiles must not be loaded.
        assert.doesNotMatch(casual, /本人の好み|他人の非公開|サーバーの出来事/);
        const recall = await staffMemoryContext('guild', 'alice', '昨日の出来事は？', true);
        assert.match(recall, /サーバーの出来事/);
        assert.doesNotMatch(recall, /本人の好み|他人の非公開情報/);
        assert.ok(recall.length <= STAFF_AI_PROMPT_BUDGET.memoryCharacters);
    } finally { database.get = original; }
});

test('Context-limit messages are distinguished from authentication, network and unrelated server failures', () => {
    for (const message of ['context_length_exceeded', 'maximum context length is 8192',
        'the request exceeds the available context size', 'prompt is too long', 'input exceeds token limit']) {
        assert.equal(isStaffAIContextLimitError(message), true, message);
    }
    for (const message of ['HTTP 500 Internal Server Error', 'HTTP 401 Unauthorized', 'fetch failed', 'RateLimitReached']) {
        assert.equal(isStaffAIContextLimitError(message), false, message);
    }
});
