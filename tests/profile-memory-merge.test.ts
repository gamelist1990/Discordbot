import test from 'node:test';
import assert from 'node:assert/strict';
import { appendProfileFacts, mergeProfileMemory } from '../src/core/ai/ProfileMemoryMerge.ts';

test('recent profile extraction preserves earlier facts and public interests', () => {
    const previous = { content: 'Minecraft統合版の爆破音を消すパックを制作。', publicInterests: 'Minecraft', evidenceCount: 19 };
    const updated = mergeProfileMemory(previous, {
        content: 'HTMLのファイル作成にも関心がある。', publicInterests: '（特になし）', evidenceCount: 20,
    });
    assert.equal(updated.content, `${previous.content}\nHTMLのファイル作成にも関心がある。`);
    assert.equal(updated.publicInterests, 'Minecraft');
    assert.equal(previous.content, 'Minecraft統合版の爆破音を消すパックを制作。');
});

test('repeated extraction and no-information fields do not accumulate duplicates', () => {
    assert.equal(appendProfileFacts('- Minecraftが好き。', 'Minecraftが好き\n興味・話題: 特になし\n観測できる話し方: この期間の発言では判断できる材料なし', 6000), '- Minecraftが好き。');
});

test('saving against a newer record retains concurrent additions and the highest count', () => {
    const updated = mergeProfileMemory(
        { content: '以前の活動\n別の更新で追加された活動', publicInterests: 'Minecraft', evidenceCount: 30 },
        { content: '今回の活動', publicInterests: 'HTML制作', evidenceCount: 20 },
    );
    assert.equal(updated.content, '以前の活動\n別の更新で追加された活動\n今回の活動');
    assert.equal(updated.publicInterests, 'Minecraft\nHTML制作');
    assert.equal(updated.evidenceCount, 30);
});

test('capacity never truncates an existing fact or saves half a new fact', () => {
    assert.equal(appendProfileFacts('過去の記録', '追加する長い新情報', 8), '過去の記録');
    assert.equal(appendProfileFacts('以前から上限より長い記録', '新情報', 5), '以前から上限より長い記録');
});
