import test from 'node:test';
import assert from 'node:assert/strict';
import { compactDotConversationNoise, formatDotSpeakerEvidence } from '../src/core/ai/DotSpeakerContext.ts';

// Regression for Discord conversation on 2026-11-11 23:22–23:29:
// Person A acquired the signature weapon, person B wanted to focus on HoYoverse.
test('fragmented ownership statements stay attached to the correct speaker', () => {
    const entries = [
        {id:'1',authorId:'owner',authorName:'こう君',content:'相変わらずの',isBot:false},
        {id:'2',authorId:'owner',authorName:'こう君',content:'スタレ',isBot:false},
        {id:'3',authorId:'owner',authorName:'こう君',content:'☆5が',isBot:false},
        {id:'4',authorId:'other',authorName:'冷笑系熱血ゴミムシ',content:'スタレだけに',isBot:false},
        {id:'5',authorId:'owner',authorName:'こう君',content:'餅武器',isBot:false},
        {id:'6',authorId:'other',authorName:'冷笑系熱血ゴミムシ',content:'ヒｨｯ↑w'.repeat(140),isBot:false},
        {id:'7',authorId:'owner',authorName:'こう君',content:'ゲットできたわ',isBot:false},
        {id:'8',authorId:'other',authorName:'冷笑系熱血ゴミムシ',content:'俺はホヨバゲーを極めようかな',isBot:false},
        {id:'9',authorId:'other',authorName:'冷笑系熱血ゴミムシ',content:'マイクラpvpやめてやることなくなったし',isBot:false},
        {id:'10',authorId:'bot',authorName:'PEXserver',content:'誤って所有者を断定した以前の返信',isBot:true},
    ];
    const indexed = formatDotSpeakerEvidence(entries,'bot');
    const personA = indexed.split('\n').find(line => line.includes('userId=owner')) || '';
    const personB = indexed.split('\n').find(line => line.includes('userId=other')) || '';
    assert.match(personA,/☆5が/);
    assert.match(personA,/餅武器/);
    assert.match(personA,/ゲットできたわ/);
    assert.doesNotMatch(personA,/ホヨバゲーを極めようかな/);
    assert.match(personB,/ホヨバゲーを極めようかな/);
    assert.doesNotMatch(personB,/ゲットできたわ/);
    assert.doesNotMatch(indexed,/誤って所有者を断定した以前の返信/);
    assert.ok(indexed.length < 4200);
    assert.ok(indexed.includes('所有者'));
});

test('different message authors are kept distinct even if display names are identical', () => {
    const indexed = formatDotSpeakerEvidence([
        {id:'1',authorId:'u1',authorName:'guest',content:'RTXのGPU買った',isBot:false},
        {id:'2',authorId:'u2',authorName:'guest',content:'マイクラやめた',isBot:false},
    ]);
    assert.match(indexed,/userId=u1/);
    assert.match(indexed,/userId=u2/);
    assert.equal(indexed.split('\n').filter(line=>line.includes('guest (userId=')).length,2);
});

test('repetition compression is bounded and preserves surrounding content', () => {
    const input='面白い '.repeat(8)+'ヒｨｯ↑w'.repeat(120)+' 餅武器を見せて';
    const compressed=compactDotConversationNoise(input);
    assert.ok(compressed.length <= 300);
    assert.ok(compressed.includes('連呼省略'));
    assert.ok(compressed.includes('餅武器を見せて'));
});
