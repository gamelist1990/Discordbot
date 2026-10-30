import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_GUILD_AI_PERSONALITY, buildGuildAIPersonalityPrompt, buildRoleplayDefinition, parseGeneratedPersona,
} from '../src/core/ai/GuildAIPersonality.ts';

const persona = { name: 'ミナト', character: '好奇心旺盛で面倒見がよい', speakingStyle: '明るい口調', behavior: 'まず受け止める',
    generatedAt: '2026-10-30T00:00:00.000Z', source: 'generated' as const };

test('roleplay definition is always applied, even before the AI has chosen its character', () => {
    const prompt = buildGuildAIPersonalityPrompt(DEFAULT_GUILD_AI_PERSONALITY);
    assert.match(prompt, /ロールプレイ定義/);
    assert.match(prompt, /友好的でフレンドリー/);
    assert.match(prompt, /AIであることは隠さず/);
});

test('the persona chosen by the AI is part of both full and compact prompts', () => {
    const personality = { ...DEFAULT_GUILD_AI_PERSONALITY, persona };
    for (const compact of [false, true]) {
        const prompt = buildGuildAIPersonalityPrompt(personality, compact);
        assert.match(prompt, /ミナト/);
        assert.match(prompt, /明るい口調/);
    }
    assert.ok(buildRoleplayDefinition(persona, true).length < buildRoleplayDefinition(persona, false).length);
});

test('generated persona JSON is parsed leniently but incomplete answers are rejected', () => {
    const parsed = parseGeneratedPersona('```json\n{"name":"ハル","character":"元気","speakingStyle":"明るい","behavior":"提案する"}\n```');
    assert.equal(parsed?.name, 'ハル');
    assert.equal(parseGeneratedPersona('{"name":"ハル"}'), null);
    assert.equal(parseGeneratedPersona('not json'), null);
});
