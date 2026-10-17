import test from 'node:test';
import assert from 'node:assert/strict';
import { STAFF_AI_SYSTEM_PROMPT } from '../src/commands/staff/subcommands/StaffAIStyle.ts';
import {
    getStaffEmojiImageParts,
    selectStaffEmojis,
} from '../src/commands/staff/subcommands/StaffAIEmojiContext.ts';

function fakeGuild(count = 30) {
    const values = Array.from({ length: count }, (_, index) => {
        const id = String(100000000000000000n + BigInt(index));
        const name = index === 1 ? 'happy' : index === 2 ? 'sad' : `emote_${index}`;
        return {
            id, name, animated: index === 1, available: true,
            url: `https://cdn.discordapp.com/emojis/${id}.png`,
            roles: { cache: { size: 0, some: () => false } },
        };
    });
    return {
        emojis: { cache: { values: () => values.values() } },
        members: { me: { roles: { cache: { has: () => true } } } },
    } as any;
}

test('通常の雑談では絵文字カタログを送らず、systemも短い', () => {
    const context = selectStaffEmojis(fakeGuild(200), '暇なんや〜w');
    assert.deepEqual(context, { catalog: '', images: [] });
    assert.ok(STAFF_AI_SYSTEM_PROMPT.length < 350);
    assert.match(STAFF_AI_SYSTEM_PROMPT, /暇なんや〜/);
});

test('Discordカスタム絵文字のIDを正確に認識しアニメーション表記を保つ', () => {
    const context = selectStaffEmojis(fakeGuild(), 'これ何の絵文字？ <a:happy:100000000000000001>');
    assert.match(context.catalog, /<a:happy:100000000000000001>/);
    assert.deepEqual(context.images.map(image => image.id), ['100000000000000001']);
    assert.ok(context.catalog.split(/<a?:/g).length - 1 <= 12);
});

test('前のチャンネル発言にある絵文字にも対応し、未知IDは無視する', () => {
    const guild = fakeGuild();
    const context = selectStaffEmojis(guild, 'この絵文字って何？', [
        'ちょっと前 <a:happy:100000000000000001>',
        'さっきの <::100000000000000003>',
        '最後に <::100000000000000008> <:sad:100000000000000002>',
    ]);
    assert.deepEqual(context.images.map(image => image.id), ['100000000000000002']);
    const fake = selectStaffEmojis(guild, '<:fake:999999999999999999>');
    assert.deepEqual(fake, { catalog: '', images: [] });
});

test('絵文字一覧を要求されても最大12個の参照データだけにする', () => {
    const context = selectStaffEmojis(fakeGuild(300), 'このサーバーの絵文字を使って');
    assert.equal(context.catalog.split(/<a?:/g).length - 1, 12);
    assert.equal(context.images.length, 0);
});

test('実画像が必要な場合だけCDN絵文字を小さなPNGとして送る', async () => {
    const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2p6dUAAAAASUVORK5CYII=', 'base64');
    let calls = 0;
    const imageParts = await getStaffEmojiImageParts([
        { id: '100000000000000001', tag: '<a:happy:100000000000000001>', url: 'https://cdn.discordapp.com/emojis/100000000000000001.gif' },
    ], (async () => {
        calls++;
        return new Response(tinyPng, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }) as typeof fetch);
    assert.equal(calls, 1);
    assert.equal(imageParts.length, 2);
    assert.match(imageParts[1].image_url!.url, /^data:image\/png;base64,/);
});

test('絵文字URLがCDN外なら取得しない', async () => {
    let calls = 0;
    const parts = await getStaffEmojiImageParts([
        { id: '100000000000000001', tag: '<:safe:100000000000000001>', url: 'https://untrusted.example/emoji.png' },
    ], (async () => { calls++; throw Error('must not be requested'); }) as typeof fetch);
    assert.equal(calls, 0);
    assert.deepEqual(parts, []);
});
