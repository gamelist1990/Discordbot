import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStaffAnsiStatus } from '../src/commands/staff/subcommands/StaffAIAnsiStatus.ts';
import { StaffAIStreamState } from '../src/commands/staff/subcommands/StaffAIStreamState.ts';

test('Truecolor ANSI gives thinking purple, web running cyan and success green', () => {
    const current = renderStaffAnsiStatus(
        [{ name: 'web_search', arguments: '{"query":"news"}', phase: '実行中' }],
        { active: true, characters: 100 },
    );
    assert.match(current, /\u001b\[38;2;180;135;245m/);
    assert.match(current, /\u001b\[38;2;83;196;230m/);
    assert.match(current, /Thinking/);
    assert.match(current, /Web検索/);
    assert.match(current, /\u001b\[0m/);
    assert.ok(current.startsWith('\n\`\`\`ansi\n'));
    assert.ok(current.endsWith('\n\`\`\`'));

    const done = renderStaffAnsiStatus(
        [{ name: 'web_search', arguments: '{"query":"news"}', phase: '完了' }],
        { active: false, characters: 100 },
    );
    assert.match(done, /\u001b\[38;2;71;201;137m/);

    const error = renderStaffAnsiStatus(
        [{ name: 'web_search', arguments: '{}', phase: '失敗' }],
    );
    assert.match(error, /\u001b\[38;2;244;105;105m/);
});

test('plain Markdown remains default for mobile and ANSI is an opt-in', () => {
    const basic = new StaffAIStreamState();
    const colored = new StaffAIStreamState(true);
    for (const view of [basic, colored]) {
        view.consumeResponse({ type: 'thinking', text: 'abc' });
        view.recordToolStep({ phase: 'completed', name: 'web_search', round: 0 });
        view.consumeResponse({ type: 'text', text: '結果は晴れ！' });
    }
    assert.doesNotMatch(basic.renderDiscord(true).content, /\`\`\`ansi/);
    assert.match(basic.renderDiscord(true).content, /✅ Web検索/);
    assert.match(colored.renderDiscord(true).content, /\`\`\`ansi/);
    assert.match(colored.renderDiscord(true).content, /✅ Web検索/);
    assert.match(colored.renderDiscord(true).content, /結果は晴れ！/);
    assert.equal(colored.renderDiscord(true).embeds.length, 0);
});

test('untrusted strings cannot inject control codes, mentions or close ANSI fences', () => {
    const s = renderStaffAnsiStatus([
        {
            name: 'web_search',
            arguments: JSON.stringify({
                query: '@everyone \`\`\`\n\u001b[31mRed <@123456789012345678>',
            }),
            phase: '実行中',
        },
    ]);
    assert.match(s, /@\u200beveryone/);
    assert.equal((s.match(/\`\`\`/g) || []).length, 2);
    assert.equal((s.match(/\u001b\[/g) || []).length, 2);
    assert.equal(s.includes('\u001b[31m'), false);
    assert.equal(s.includes('<@123456789012345678>'), false);
});

test('2000-character Discord limit includes ANSI escape sequences', () => {
    const s = new StaffAIStreamState(true);
    s.consumeResponse({ type: 'thinking', text: 'Thought summary' });
    s.consumeResponse({ type: 'text', text: '長文'.repeat(2200) });
    s.recordToolStep({ phase: 'completed', name: 'web_search', round: 0 });
    const result = s.renderDiscord(true).content;
    assert.ok(result.length <= 2000);
    assert.match(result, /\`\`\`ansi/);
    assert.ok(result.endsWith('toks: 未取得 (API未提供)'));
});

test('non-ANSI special characters in tool args are shown as text', () => {
    const s = renderStaffAnsiStatus([{name:'web_search',arguments:'{"query":"検索"}',phase:'準備中'}]);
    assert.match(s, /\u001b\[38;2;251;190;95m/);
    assert.match(s, /検索/);
});
