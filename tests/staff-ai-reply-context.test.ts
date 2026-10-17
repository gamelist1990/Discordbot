import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStaffReplyTarget, buildStaffReplyContext } from '../src/commands/staff/subcommands/StaffAIReplyContext.ts';
import { buildConversationHistory } from '../src/core/ai/AIConversationHistory.ts';

const guild = '123456789012345678';
const channel = '234567890123456789';
const target = '345678901234567890';

test('メッセージリンクとIDの返信先を正しく検証', () => {
    assert.equal(parseStaffReplyTarget(target, guild, channel), target);
    assert.equal(parseStaffReplyTarget(`https://discord.com/channels/${guild}/${channel}/${target}`, guild, channel), target);
    assert.equal(parseStaffReplyTarget(`<https://discord.com/channels/${guild}/${channel}/${target}>`, guild, channel), target);
    assert.throws(() => parseStaffReplyTarget(`https://discord.com/channels/${guild}/444444444444444444/${target}`, guild, channel), /今のサーバー/);
    assert.throws(() => parseStaffReplyTarget('https://example.com/', guild, channel), /メッセージ/);
});

test('参照先の著者・本文・画像をAI入力に渡す（周辺投稿ではない）', () => {
    const fake = {
        id: target, content: 'なにそれ', member: { displayName: 'すず' },
        author: { username: 'suzu' }, embeds: [],
        stickers: { map: () => [] },
        attachments: new Map([
            ['one', { name: 'sample.png', url: 'https://cdn.discordapp.com/attachments/111/222/sample.png', contentType: 'image/png' }],
            ['two', { name: 'secret.png', url: 'https://evil.example/image.png', contentType: 'image/png' }],
        ]),
    };
    const context = buildStaffReplyContext(fake as any);
    assert.match(context.text, /すず/);
    assert.match(context.text, /なにそれ/);
    assert.match(context.text, /sample.png/);
    assert.equal(context.imageParts.length, 1);
    assert.match(context.imageParts[0].image_url.url, /cdn.discordapp.com/);
});

test('返信の紐付けが会話履歴に残る', () => {
    const history = buildConversationHistory({
        dataset: [],
        channelId: channel,
        channelMessages: [
            {
                id: 'first', timestamp: 10, role: 'user',
                authorName: 'すず', content: 'なにそれ',
                replyTo: {
                    id: 'original', authorName: 'こう', content: 'Minecraftの新しいマップだよ',
                    attachments: ['画像: minecraft.png'],
                },
            },
        ],
    });
    const content = history.map(m => String(m.content)).join('\n');
    assert.match(content, /この投稿の返信先: こう \/ ID original/);
    assert.match(content, /Minecraftの新しいマップだよ/);
    assert.match(content, /minecraft.png/);
});

test('本文がなく添付だけの投稿でも返信先として説明できる', () => {
    const fake = {
        id: target, content: '', member: null,
        author: { username: 'suzu' }, embeds: [],
        stickers: { map: () => [] },
        attachments: new Map([
            ['one', { name: 'capture.jpg', url: 'https://media.discordapp.net/attachments/111/222/capture.jpg', contentType: 'image/jpeg' }],
        ]),
    };
    const context = buildStaffReplyContext(fake as any);
    assert.match(context.text, /本文なし/);
    assert.match(context.text, /画像: capture.jpg/);
    assert.equal(context.imageParts.length, 1);
});
