import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { DEFAULT_ANTICHEAT_SETTINGS } from "../src/core/anticheat/types.ts";

const base = process.env.ANTICHEAT_UI_URL || "http://127.0.0.1:5181";
const output =
  process.env.ANTICHEAT_UI_OUTPUT || "/tmp/discordbot-anticheat-ui";
await mkdir(output, { recursive: true });
const guildId = "890315487962095637";
const channelId = "222222222222222222";
const roleId = "111111111111111111";
const {
  userTrust: _trust,
  recentLogs: _logs,
  ...defaults
} = structuredClone(DEFAULT_ANTICHEAT_SETTINGS);
let stored = { ...defaults, enabled: true };
let saves = [];
let failSave = false;
let failLogs = false;
let failChannels = false;
const errors = [];
const browser = await chromium.launch({
  headless: true,
  channel: process.env.ANTICHEAT_UI_CHANNEL || "chromium",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
  route.abort(),
);
page.on("pageerror", (error) => errors.push(error.message));
const nav = page.getByRole("navigation", { name: "AntiCheat設定カテゴリ" });
const openCategory = async (name) => {
  const button = nav.getByRole("button", { name, exact: false });
  if (await button.isVisible()) await button.click();
  else
    await page.getByLabel("設定カテゴリを選択").selectOption({ label: name });
};
const save = page.getByRole("button", { name: "変更を保存", exact: true });
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  let data = {};
  if (path === "/api/auth/session")
    data = {
      user: {
        userId: "123",
        username: "テスト運営",
        permissions: [{ guildId, level: 3 }],
      },
    };
  else if (path.startsWith("/api/guild/"))
    data = { id: guildId, name: "PEX コミュニティ", iconURL: null, roles: [] };
  else if (path.endsWith("/settings")) {
    if (route.request().method() === "POST") {
      saves.push(route.request().postDataJSON());
      if (failSave)
        return route.fulfill({
          status: 413,
          json: { error: "設定データが大きすぎます（上限 1 MB）。" },
        });
      stored = saves.at(-1);
      data = { success: true, settings: stored };
    } else data = { settings: stored, userTrustCount: 0 };
  } else if (path.endsWith("/exclusion-targets")) {
    if (failChannels)
      return route.fulfill({ status: 503, json: { error: "一覧取得に失敗" } });
    data = {
      channels: [
        { id: channelId, name: "運営ログ", kind: "channel", type: "テキスト" },
      ],
      roles: [{ id: roleId, name: "スタッフ", kind: "role", type: "ロール" }],
    };
  } else if (path.endsWith("/logs")) {
    if (failLogs)
      return route.fulfill({ status: 503, json: { error: "ログ取得に失敗" } });
    data = { logs: [] };
  } else if (path.endsWith("/trust")) data = { userTrust: {} };
  else if (path.endsWith("/active-timeouts")) data = { activeTimeouts: [] };
  else if (path.endsWith("/content-cache/clear")) data = { removed: 3 };
  return route.fulfill({ json: data });
});
const noOverflow = async (label) =>
  assert.equal(
    await page
      .locator(".appMain")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
    false,
    label,
  );
const capture = async (name) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
};

try {
  await page.goto(`${base}/staff/anticheat/${guildId}`);
  await page.getByRole("heading", { name: "基本設定", exact: true }).waitFor();
  assert.equal(await save.isDisabled(), true);
  await capture("desktop-basic");
  await noOverflow("desktop basic");
  await page
    .getByRole("switch", { name: "自動タイムアウト", exact: true })
    .click();
  await openCategory("AIフィルター");
  await page
    .getByRole("switch", { name: "AIコンテンツフィルターを有効にする" })
    .click();
  await page
    .getByRole("switch", { name: "画像・GIF・MP4を検査", exact: true })
    .click();
  await page.getByRole("button", { name: "変更を取り消す" }).click();
  // Unhandled confirm dialogs are dismissed: cancelling keeps the draft.
  assert.equal(await save.isEnabled(), true);
  await save.click();
  await page
    .getByText("AntiCheat設定を保存しました。", { exact: true })
    .waitFor();
  assert.equal(stored.autoTimeout.enabled, true);
  assert.equal(stored.detectors.contentSafety.config.scanImages, 0);
  assert.equal("userTrust" in saves[0], false);
  assert.equal("recentLogs" in saves[0], false);
  await capture("desktop-ai");
  await page.getByRole("switch", { name: "文章を検査", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "変更を取り消す" }).click();
  assert.equal(
    await page
      .getByRole("switch", { name: "文章を検査", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  assert.equal(await save.isDisabled(), true);
  await page.getByRole("switch", { name: "文章を検査", exact: true }).click();
  failSave = true;
  await save.click();
  await page
    .getByRole("alert")
    .filter({ hasText: "設定データが大きすぎます" })
    .waitFor();
  assert.equal(await save.isEnabled(), true);
  assert.equal(
    await page
      .getByRole("switch", { name: "文章を検査", exact: true })
      .getAttribute("aria-checked"),
    "false",
  );
  failSave = false;
  await save.click();
  await page
    .getByText("AntiCheat設定を保存しました。", { exact: true })
    .waitFor();

  await openCategory("スパム・メンション");
  await page.getByLabel("検知機能を検索").fill("横断");
  await page
    .getByRole("heading", { name: "チャンネル横断スパム", exact: true })
    .waitFor();
  await page.getByLabel("同文の検知開始件数", { exact: true }).fill("4");
  await page.getByLabel("検知機能を検索").fill("見つからない機能");
  await page
    .getByText(
      "一致する検知機能がありません。別のキーワードで検索してください。",
    )
    .waitFor();
  await page.getByLabel("検知機能を検索").fill("");
  await capture("desktop-spam");

  await openCategory("NGワード");
  await page
    .getByRole("switch", { name: "ワードフィルターを有効にする" })
    .click();
  await page.getByRole("button", { name: "ルール追加", exact: true }).click();
  await page.getByLabel("ラベル", { exact: true }).fill("広告対策");
  await page.getByLabel("パターン", { exact: true }).fill("spam-example");
  await openCategory("自動処罰");
  await page.getByRole("button", { name: "しきい値追加" }).click();
  await page.getByLabel("しきい値", { exact: true }).fill("20");
  await page.getByRole("button", { name: "処置追加", exact: true }).click();
  assert.equal(await page.getByLabel("処置", { exact: true }).count(), 2);

  await openCategory("ログ通知");
  await openCategory("画像・リンク");
  await page
    .getByRole("navigation", { name: "検知機能" })
    .getByRole("button", { name: /広告・紹介リンク/ })
    .click();
  await page
    .getByLabel("ブロックドメイン", { exact: true })
    .fill("example.com");
  await page.getByLabel("ブロックドメイン", { exact: true }).press("End");
  await page.getByLabel("ブロックドメイン", { exact: true }).press("Enter");
  assert.equal(
    await page.getByLabel("ブロックドメイン", { exact: true }).inputValue(),
    "example.com\n",
    "list editor preserves a trailing newline",
  );
  await page
    .getByLabel("ブロックドメイン", { exact: true })
    .pressSequentially("spam.example");
  await openCategory("ログ通知");
  await page
    .getByLabel("検知ログの通知先", { exact: true })
    .selectOption(channelId);
  assert.equal(
    await page
      .getByLabel("検知ログのチャンネルID", { exact: true })
      .inputValue(),
    channelId,
  );
  await save.click();
  await page
    .getByText("AntiCheat設定を保存しました。", { exact: true })
    .waitFor();
  assert.equal(stored.detectors.crossChannelSpam.config.duplicateThreshold, 4);
  assert.equal(
    stored.detectors.wordFilter.config.rules[0].pattern,
    "spam-example",
  );
  assert.equal(stored.punishments[0].threshold, 20);
  assert.equal(stored.logChannelId, channelId);
  assert.deepEqual(stored.detectors.inviteReferral.config.blockedDomains, [
    "example.com",
    "spam.example",
  ]);

  await openCategory("除外対象");
  await page
    .getByRole("button", { name: "除外ロールのIDを追加", exact: true })
    .click();
  await page.getByLabel("ロール名で候補を検索、またはIDを入力").fill(roleId);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await page.getByText("@スタッフ", { exact: true }).waitFor();
  await save.click();
  await page
    .getByText("AntiCheat設定を保存しました。", { exact: true })
    .waitFor();
  assert.deepEqual(stored.excludedRoles, [roleId]);

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const section of [
      "基本設定",
      "AIフィルター",
      "スパム・メンション",
      "画像・リンク",
      "NGワード",
      "自動処罰",
      "除外対象",
      "ログ通知",
      "検知・対応履歴",
    ]) {
      await openCategory(section);
      await noOverflow(`${width}px ${section}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openCategory("AIフィルター");
  await capture("mobile-ai");
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await capture("mobile-ai-dark");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await capture("desktop-ai-dark");
  assert.equal(
    await page
      .getByRole("heading", { name: "AIフィルター", exact: true })
      .count(),
    1,
    "category survives viewport changes",
  );
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));

  failLogs = true;
  await openCategory("検知・対応履歴");
  await page
    .getByRole("navigation", { name: "履歴の種類" })
    .getByRole("button", { name: "検知ログ", exact: true })
    .click();
  await page.getByRole("button", { name: "再取得", exact: true }).click();
  await page.getByRole("alert").waitFor();
  failLogs = false;
  await page.getByRole("button", { name: "再取得", exact: true }).click();
  await page.getByText("検知ログはありません。", { exact: true }).waitFor();
  failChannels = true;
  await openCategory("ログ通知");
  await page.getByRole("alert").waitFor();
  await page
    .getByLabel("検知ログのチャンネルID", { exact: true })
    .fill("333333333333333333");
  failChannels = false;
  await page.getByRole("button", { name: "再取得", exact: true }).click();
  await page
    .getByLabel("検知ログの通知先", { exact: true })
    .selectOption(channelId);
  assert.equal(
    await save.isDisabled(),
    true,
    "returning to the saved value clears dirty state",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        saves: saves.length,
        screenshots: output,
        checked:
          "9 categories at 5 widths; light/dark; search; cross-category save; discard; failed save/retry; rule/action/exclusion editing; channel selection/fallback; monitoring retry; resize persistence",
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
