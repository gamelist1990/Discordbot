import test from 'node:test';
import assert from 'node:assert/strict';
import { fillMissingConfig } from '../src/utils/configDefaults.ts';

test('older host config gains lfm3 without changing credentials or selected models', () => {
    const original = { pexAi: { apiKey: 'private', model: 'custom', steps: [], extra: true }, custom: 42 };
    const result = fillMissingConfig(original, { pexAi: { apiKey: '', model: 'qwen', contentSafetyModel: 'lfm3', steps: [{ model: 'gemini' }] } });
    assert.deepEqual(result.value, { pexAi: { ...original.pexAi, contentSafetyModel: 'lfm3' }, custom: 42 });
    assert.deepEqual(result.added, ['pexAi.contentSafetyModel']);
    assert.equal('contentSafetyModel' in original.pexAi, false);
    assert.deepEqual(fillMissingConfig(result.value, { pexAi: { contentSafetyModel: 'lfm3' } }).added, []);
});

test('absent sections are added and explicit false, zero, empty and null remain', () => {
    const result = fillMissingConfig({ enabled: false, level: 0, text: '', nullable: null }, { enabled: true, level: 1, text: 'default', nullable: {}, pexAi: { contentSafetyModel: 'lfm3' } });
    assert.deepEqual(result.value, { enabled: false, level: 0, text: '', nullable: null, pexAi: { contentSafetyModel: 'lfm3' } });
    assert.deepEqual(result.added, ['pexAi']);
});
