import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDiscordResponse, discordDisplayWidth, clipDiscordResponse } from '../src/core/ai/DiscordResponseFormatting.ts';
import { StaffAIStreamState } from '../src/commands/staff/subcommands/StaffAIStreamState.ts';
import { toolResultSummary } from '../src/core/ai/ToolResultSummary.ts';
import { describeStaffTool } from '../src/commands/staff/subcommands/StaffAIToolFormatting.ts';
import { stripDiscordStreamMetadata } from '../src/core/ai/AIConversationHistory.ts';

const table = '| 原因 | 説明 |\n|---|---|\n| **AI需要** | メモリの供給不足です。一般向けの価格が高騰しています。 |\n| 円安 | 調達コストの上昇 |';

test('Japanese Markdown tables become aligned, wrapped ASCII tables and horizontal rules are visible', () => {
    const formatted = formatDiscordResponse('価格の比較\n\n---\n\n' + table + '\n\n結論です。');
    assert.match(formatted, /────────────────────/);
    assert.match(formatted, /```text\n\+/);
    assert.doesNotMatch(formatted, /\|---\||\*\*AI需要\*\*/);
    assert.match(formatted, /AI需要/);
    assert.ok(formatted.endsWith('結論です。'));
    const rows = formatted.split('```text\n')[1].split('\n```')[0].split('\n');
    const widths = rows.map(discordDisplayWidth);
    assert.equal(new Set(widths).size, 1);
    assert.ok(widths[0] <= 54);
    assert.equal(formatDiscordResponse(formatted), formatted);
});

test('Escaped pipes and inline code do not create false columns; existing code blocks stay untouched', () => {
    const input = '| 項目 | 内容 |\n| :--- | ---: |\n| A\\|B | `x|y` |';
    const formatted = formatDiscordResponse(input);
    assert.match(formatted, /A\|B/);
    assert.match(formatted, /x\|y/);
    const code = '```markdown\n' + table + '\n---\n```\n\n~~~text\n---\n~~~';
    assert.equal(formatDiscordResponse(code), code);
    assert.equal(formatDiscordResponse('a | b\nnot a table'), 'a | b\nnot a table');
    assert.equal(discordDisplayWidth('日本語abc'), 9);
    assert.equal(discordDisplayWidth('👩‍💻e\u0301'), 3);
});

test('Partial streaming tables convert once the separator arrives, and clipping keeps fences balanced', () => {
    const state = new StaffAIStreamState(false, true);
    state.consumeResponse({type: 'text', text: '| 項目 | 値 |\n|---|---|\n| 平方根 | 1.414'});
    assert.match(state.renderDiscord().content, /```text/);
    state.consumeResponse({type: 'text', text: '21356 |\n\n---\n結果です。'});
    const complete = state.renderDiscord(true);
    assert.match(complete.content, /1\.41421356/);
    assert.match(complete.content, /────────────────────/);
    const clipped = clipDiscordResponse(formatDiscordResponse(table.repeat(30)), 300);
    assert.ok(clipped.length <= 300);
    assert.equal((clipped.match(/```/g) ?? []).length % 2, 0);
});

test('Wide tables become compact records without dropping headers or values', () => {
    const header = '| A | B | C | D | E | F | G |';
    const separator = '|---|---|---|---|---|---|---|';
    const formatted = formatDiscordResponse(header + '\n' + separator + '\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 |');
    assert.match(formatted, /項目/);
    assert.match(formatted, /G.*7/);
    assert.match(formatDiscordResponse(header + '\n' + separator), /G/);
});

test('Long converted replies retain the complete formatted answer in an attachment', () => {
    for (const native of [false, true]) {
        const state = new StaffAIStreamState(false, native);
        state.content = (table + '\n\n---\n\n').repeat(15) + '回答の最後まで残す';
        const reply = state.renderDiscord(true);
        assert.ok(reply.content.length <= 2000);
        assert.equal(reply.files?.length, 1);
        const full = reply.files![0].attachment.toString('utf8');
        assert.ok(full.endsWith('回答の最後まで残す'));
        assert.match(full, /```text/);
        assert.equal((reply.content.match(/```/g) ?? []).length % 2, 0);
    }
});

test('Tool results produce useful summaries without copying private records, page contents or source code', () => {
    assert.match(toolResultSummary('web_search', {}, '1. [IDC](https://example.com)\n情報\n2. [Acer](https://example.net)\n情報'), /検索結果 2件.*IDC.*Acer/);
    assert.equal(toolResultSummary('web_search', {}, 'SEARCH_EMPTY: none'), '検索結果 0件');
    assert.match(toolResultSummary('fetch_url', {}, 'URL: https://example.com\n\nabc123'), /6文字/);
    assert.equal(toolResultSummary('manage_memory', {}, {memos: [{content: 'SECRET'}]}), 'メモリー 1件を取得');
    assert.equal(toolResultSummary('calculate_bash', {}, {stdout: '1024', success: true}), '計算結果：1024');
    assert.equal(toolResultSummary('calculate_bash', {}, {stdout: 'SECRET_CODE'}), '計算結果を取得しました');
    assert.match(toolResultSummary('fetch_url', {}, 'FETCH_BLOCKED: SECRET_URL'), /失敗/);
    assert.equal(toolResultSummary('unrecognized_tool', {}, {content: 'SECRET_CONTENT'}), '実行結果を受信しました');
});

test('Progress uses actual names for unrecognized tools and renders result metadata dynamically', () => {
    const unknown = describeStaffTool({name: 'custom_research', arguments: '{}', phase: '完了', resultSummary: '結果 3件を取得'});
    assert.match(unknown.name, /custom/);
    assert.doesNotMatch(unknown.value, /ツール処理を処理/);
    const state = new StaffAIStreamState(false, true);
    state.recordToolStep({name: 'web_search', callId: 'search', round: 1, phase: 'started'});
    assert.doesNotMatch(JSON.stringify(state.renderDiscord()), /検索結果 2件/);
    state.recordToolStep({name: 'web_search', callId: 'search', round: 1, phase: 'completed', resultSummary: '検索結果 2件：IDC / Acer'});
    assert.match(JSON.stringify(state.renderDiscord()), /検索結果 2件/);
    assert.equal(stripDiscordStreamMetadata('回答\n-# 15.7 toks/s · 合計 54067 toks (in 53045 / out 1022)'), '回答');
});
