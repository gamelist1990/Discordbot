import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

await fs.mkdir('test-results', { recursive: true });
const port = process.env.UI_TEST_PORT ? parseInt(process.env.UI_TEST_PORT) : 5180;
const base = `http://127.0.0.1:${port}`;
const id = '890315487962095637';
const now = new Date().toISOString();

const longSummary = 'サーバーの雰囲気は、マイクラの建築と雑談が中心で、夜の時間帯にVCへ集まる流れが定着している。'
  + '新しい企画が出るとまず小さく試してから広げることが多く、絵文字は控えめだが合いの手のリアクションは早い。'
  + 'AIへの呼びかけは短い一言で済ませる人が多く、長い説明よりも結論を先に聞きたがる傾向がある。'
  + '週末はイベント告知への反応が平日の倍近くになり、告知への質問は短く具体的に返ってくる。'
  + '新しく入ったメンバーへの声かけは早いが、内輪の言い回しが多く、初見では少し分かりにくい面もある。'
  + 'この傾向は直近1週間の観測でも大きくは変わっていない。';

const staffAiData = {
  metrics: {
    requests: 128, inputTokens: 412000, outputTokens: 98000, cachedTokens: 301000,
    totalTokens: 510000, promptTokens: 412000, completionTokens: 98000,
    thoughtsTokens: 12000, toolTokens: 3000, updatedAt: now,
    byPurpose: {
      'dot-judge': { requests: 300, totalTokens: 90000 },
      'dot-generation': { requests: 40, totalTokens: 120000 },
      'staff-ai': { requests: 12, totalTokens: 60000 },
    },
  },
  globalMetrics: { requests: 512, inputTokens: 1600000, totalTokens: 2000000 },
  personality: {
    tone: 'friendly', humor: 'balanced', emojiUsage: 'occasional', responseLength: 'balanced',
    customInstructions: '短く、人間っぽく返して。',
    learnedSummary: longSummary,
    learnedMessageCount: 4321, learningEnabled: true,
    persona: {
      name: 'キナコ', role: 'サーバーの常駐AI', speechStyle: '短くフレンドリー',
      personality: '明るくて少し辛口', background: 'サーバーに常駐している', behavior: '具体に触れて言い切る',
    },
  },
  memories: [
    {
      id: 'd1', kind: 'daily', title: '2026-11-08 の出来事', day: '2026-11-08',
      content: 'マイクラの拠点で大規模な建築が進み、夜にはVCで雑談が盛り上がった。'.repeat(6),
      createdAt: now, updatedAt: now,
    },
  ],
  customMemos: [
    { id: 'c1', title: '建築ルール', content: '拠点周辺の木を植え直す', authorName: 'Staff', createdAt: now, updatedAt: now },
  ],
};

const memberMemosData = {
  canManage: true,
  memos: [
    {
      userId: '111111111111111111', name: 'メモ検証タロウ',
      memo: 'マイクラの建築企画をよく立てる。夜のVCに活発で、告知への反応が早い。',
      messageCount: 812, updatedAt: '2026-11-08T10:24:00.000Z', lastSeenAt: Date.now() - 3600_000,
    },
    {
      userId: '222222222222222222', name: 'メモ検証ジロウ',
      memo: 'AIの話題に反応が早く、検証や比較の話が好き。返信は短め。',
      messageCount: 640, updatedAt: '2026-11-07T21:10:00.000Z', lastSeenAt: Date.now() - 7200_000,
    },
    {
      userId: '333333333333333333', name: 'メモ検証サブロウ',
      memo: '', messageCount: 3, updatedAt: '1970-01-01T00:00:00.000Z', lastSeenAt: Date.now() - 86400_000,
    },
  ],
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const deletedUrls = [];
page.on('dialog', dialog => void dialog.accept());

await page.route('**/api/**', async route => {
  const { pathname } = new URL(route.request().url());
  const method = route.request().method();
  let data = {};
  if (pathname === '/api/auth/session') data = { user: { userId: '123', username: 'Staff', permissionLevel: 3, permissions: [{ guildId: id, level: 3 }] } };
  if (pathname === '/api/staff/guilds') data = { guilds: [{ id, name: 'PEX Community' }] };
  if (pathname === `/api/staff/ai/${id}`) data = staffAiData;
  if (pathname === `/api/staff/ai/${id}/member-memos` && method === 'GET') data = memberMemosData;
  if (pathname.startsWith(`/api/staff/ai/${id}/member-memos/`) && method === 'DELETE') {
    deletedUrls.push(pathname);
    data = { removed: true };
  }
  await route.fulfill({ json: data });
});

try {
  await page.goto(`${base}/staff/ai`);
  await page.getByText('サーバーになじむAI', { exact: true }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText('利用状況', { exact: true }).waitFor({ state: 'visible' });

  // 初期状態: 詳細セクションは閉じていて、中身（性格の保存ボタン・メンバーメモの名前）は描画されない
  assert.equal(await page.getByRole('button', { name: /話し方を保存/ }).count(), 0, 'personality body should be collapsed');
  assert.equal(await page.getByText('メモ検証タロウ', { exact: true }).count(), 0, 'member memos should be collapsed');

  const overflowMobile = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  assert.equal(overflowMobile, false, 'mobile: horizontal overflow');
  await page.screenshot({ path: 'test-results/staff-ai-mobile-collapsed.png', fullPage: true });

  // 性格セクションを開く: 学習サマリは畳まれて「全文を表示」で開ける
  await page.locator('button', { hasText: 'サーバーになじむAI' }).first().click();
  await page.getByRole('button', { name: /話し方を保存/ }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '全文を表示' }).first().waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '全文を表示' }).first().click();
  await page.getByRole('button', { name: '閉じる' }).first().waitFor({ state: 'visible' });
  await page.screenshot({ path: 'test-results/staff-ai-mobile-personality.png', fullPage: true });
  await page.locator('button', { hasText: 'サーバーになじむAI' }).first().click();

  // メンバーメモを開く
  await page.locator('button', { hasText: 'メンバーメモ' }).first().click();
  await page.getByText('メモ検証タロウ', { exact: true }).waitFor({ state: 'visible' });
  await page.getByText('メモ検証サブロウ', { exact: true }).waitFor({ state: 'visible' });
  await page.getByText('メモはまだ生成されていません（発言の観測だけが記録されています）。', { exact: false }).waitFor({ state: 'visible' });
  await page.getByText('メモ検証タロウ', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/staff-ai-mobile-member-memos.png', fullPage: true });

  // 名前で絞り込み
  await page.getByLabel('メンバーメモ検索').fill('ジロウ');
  await page.getByText('メモ検証ジロウ', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByText('メモ検証タロウ', { exact: true }).count(), 0, 'search should filter members');
  await page.getByLabel('メンバーメモ検索').fill('');

  // 削除: 管理者なのでボタンがあり、確認後に行が消え、DELETEが飛ぶ
  await page.getByRole('button', { name: 'メモ検証タロウ のメンバーメモを削除' }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('メモ検証タロウ'), null, { timeout: 5000 });
  assert.equal(deletedUrls.length, 1, 'DELETE should be called once');
  assert.ok(deletedUrls[0].endsWith('/member-memos/111111111111111111'));

  // デスクトップ幅でも初期は畳まれ、横スクロールなし
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.reload();
  await page.getByText('サーバーになじむAI', { exact: true }).waitFor({ state: 'visible', timeout: 20000 });
  const overflowDesktop = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  assert.equal(overflowDesktop, false, 'desktop: horizontal overflow');
  await page.screenshot({ path: 'test-results/staff-ai-desktop.png', fullPage: true });

  assert.deepEqual(errors, []);
  console.log('StaffAI UI: collapsed by default, clamp toggle, member memos view/search/delete, no overflow (390/1440), no runtime errors');
} finally {
  await browser.close();
}
