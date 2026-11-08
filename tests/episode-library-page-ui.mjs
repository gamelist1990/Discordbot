import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// ペイロードは実グルーピング（EpisodeLibrary.ts）をシードデータへ適用して生成したもの。
// UI はその形をそのまま描画することだけを確認する（階層ロジック自体は単体テストで担保）。
const payload = JSON.parse(await fs.readFile('/tmp/episodes/library-mock.json', 'utf-8'));

await fs.mkdir('test-results', { recursive: true });
const port = process.env.UI_TEST_PORT ? parseInt(process.env.UI_TEST_PORT) : 5180;
const base = `http://127.0.0.1:${port}`;
const id = '890315487962095637';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  const { pathname } = url;
  let data = {};
  if (pathname === '/api/auth/session') data = { user: { userId: '123', username: 'Staff', permissionLevel: 3, permissions: [{ guildId: id, level: 3 }] } };
  if (pathname === '/api/staff/guilds') data = { guilds: [{ id, name: 'PEX Community' }] };
  if (pathname === `/api/staff/ai/${id}/episodes`) {
    data = url.searchParams.get('q') ? payload.search : payload.all;
  }
  await route.fulfill({ json: data });
});

try {
  await page.goto(`${base}/staff/episodes`);
  await page.getByRole('heading', { name: '出来事ライブラリ' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText('2026年11月', { exact: true }).waitFor({ state: 'visible' });
  await page.getByText(`PEX Community の出来事 全 ${payload.all.total} 件`, { exact: false }).waitFor({ state: 'visible' });

  // 初期状態: 最新の月だけ開き、過去の月は閉じている
  await page.getByText('AIに対してやっぱりまだゴミだねと述べた。', { exact: false }).waitFor({ state: 'visible' });
  assert.equal(await page.getByText('猫を飼い始めたと写真付きで報告した。', { exact: false }).count(), 0, 'october should be collapsed');

  // ジャンプリンク（元の発言）が付いている
  const jumpHref = await page.locator('a[href^="https://discord.com/channels/890315487962095637/"]').first().getAttribute('href');
  assert.ok(jumpHref && jumpHref.split('/').length >= 6, `jump url: ${jumpHref}`);

  const overflowMobile = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  assert.equal(overflowMobile, false, 'mobile: horizontal overflow');
  await page.screenshot({ path: 'test-results/episode-library-mobile.png', fullPage: true });

  // 10月を開く: 月をまたぐ週（10月26日〜11月1日）と、そこへ入った11月1日の出来事が見える
  await page.locator('button', { hasText: '2026年10月' }).first().click();
  await page.getByText('10月26日〜11月1日', { exact: true }).waitFor({ state: 'visible' });
  await page.getByText('11月のマイクラ建築テーマを発表した。', { exact: false }).waitFor({ state: 'visible' });
  await page.getByText('10月26日〜11月1日', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/episode-library-mobile-weeks.png' });

  // 検索: 一致分だけが階層を保って全月開いた状態で出る
  await page.getByLabel('出来事を検索').fill('マイクラ');
  await page.getByText(`「マイクラ」に一致する出来事 ${payload.search.matched} 件`, { exact: false }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText('マイクラの統合版サーバーを立てたと報告した。', { exact: false }).waitFor({ state: 'visible' });
  assert.equal(await page.getByText('カラオケ大会で優勝したと報告された。', { exact: false }).count(), 0, 'search should filter episodes');
  const overflowSearch = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  assert.equal(overflowSearch, false, 'mobile search: horizontal overflow');
  await page.screenshot({ path: 'test-results/episode-library-mobile-search.png', fullPage: true });

  // デスクトップ幅でも横スクロールなし
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByLabel('出来事を検索').fill('');
  await page.reload();
  await page.getByRole('heading', { name: '出来事ライブラリ' }).waitFor({ state: 'visible', timeout: 20000 });
  const overflowDesktop = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  assert.equal(overflowDesktop, false, 'desktop: horizontal overflow');
  await page.screenshot({ path: 'test-results/episode-library-desktop.png', fullPage: true });

  assert.deepEqual(errors, []);
  console.log(`EpisodeLibrary UI: months/weeks hierarchy, cross-month week, search (${payload.search.matched} hits), jump links, no overflow (390/1440), no runtime errors`);
} finally {
  await browser.close();
}
