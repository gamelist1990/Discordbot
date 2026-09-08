import test from 'node:test';
import assert from 'node:assert/strict';

import {
    formatMentionAIContext,
    MENTION_AI_SUPPORT_MODEL,
} from '../src/core/ai-support/MentionAISupportManager.ts';
import { CONTENT_SAFETY_MODEL } from '../src/core/anticheat/detectors/ContentSafetyDetector.ts';

const message = (id: string, timestamp: number, content: string, author: string) => ({
    id,
    content,
    createdTimestamp: timestamp,
    author: { id: author, bot: false, username: author, displayName: author },
    member: { displayName: author },
    attachments: { size: 0, map: () => [] },
});

test('メンションAIはコンテンツフィルターと同じモデルに固定される', () => {
    assert.equal(MENTION_AI_SUPPORT_MODEL, CONTENT_SAFETY_MODEL);
    assert.equal(MENTION_AI_SUPPORT_MODEL, 'lfm2.5-vl-3b-q4-k-m');
});

test('周辺会話をDiscordの新しい順取得から時系列へ並べ直す', () => {
    const formatted = formatMentionAIContext([
        message('2', 2_000, '@bot どう思う？', '相談者'),
        message('1', 1_000, 'この案で進めたい', '参加者'),
    ] as any, 'bot');

    assert.ok(formatted.indexOf('この案で進めたい') < formatted.indexOf('@bot どう思う？'));
});

test('Botの過去回答はAIアシスタントとして表記する', () => {
    const botMessage = message('1', 1_000, '前回の回答', 'bot');
    botMessage.author.bot = true;
    const formatted = formatMentionAIContext([botMessage] as any, 'bot');
    assert.match(formatted, /AIアシスタント: 前回の回答/);
});
