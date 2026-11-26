import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPanelUsageDescription } from '../src/commands/staff/subcommands/rolepanel.ts';

const base = { description: '説明文' };

test("grant_missing/web は単一のWeb認証フローだけを説明する", () => {
    const text = buildPanelUsageDescription({
        ...base,
        panelType: 'grant_missing',
        authType: 'web'
    });

    assert.match(text, /不足ロールを受け取る/);
    assert.match(text, /Web認証/);
    assert.match(text, /自動で一括付与/);
    // 旧OAuthフローの説明は残らない
    assert.doesNotMatch(text, /Web認証を完了してから/);
    assert.doesNotMatch(text, /認証後に一括付与/);
    // 🔐 ボタンが存在しないので、その案内行も出さない
    assert.doesNotMatch(text, /「Web認証」ボタンからも認証できます/);
});

test('grant_missing/none は 🔐 ボタンの案内を残す', () => {
    const text = buildPanelUsageDescription({
        ...base,
        panelType: 'grant_missing',
        authType: 'none'
    });

    assert.match(text, /不足ロールをそのまま一括付与/);
    assert.match(text, /「Web認証」ボタンからも認証できます/);
});

test('grant_missing/code・math も 🔐 ボタンの案内を残す', () => {
    for (const authType of ['code', 'math'] as const) {
        const text = buildPanelUsageDescription({ ...base, panelType: 'grant_missing', authType });
        assert.match(text, /「Web認証」ボタンからも認証できます/, `${authType} に🔐ボタン案内が無い`);
    }
});

test('toggle パネルは従来どおりロール管理の説明', () => {
    const text = buildPanelUsageDescription({ ...base, panelType: 'toggle' });

    assert.match(text, /ロールを管理する|ロール管理を開始/);
    assert.doesNotMatch(text, /「Web認証」ボタンからも認証できます/);
});
