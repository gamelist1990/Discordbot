import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const output = process.env.UI_REDESIGN_OUTPUT || "test-results/ui-redesign";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  colorScheme: "light",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const guildId = "890315487962095637";
const guild = {
  id: guildId,
  name: "PEX コミュニティ",
  iconURL: null,
  roles: [
    { id: "staff", name: "運営スタッフ", position: 2, color: 0 },
    { id: "member", name: "認証済みメンバー", position: 1, color: 0 },
  ],
};
const leaderboard = [
  "Kou",
  "はる",
  "sora",
  "Mizuki",
  "あおい",
  "Nagi",
  "Hinata",
  "Yuki",
  "Ren",
  "Tomo",
].map((username, i) => ({
  userId: String(100000000000000000n + BigInt(i)),
  username,
  xp: 28450 - i * 2310,
  rank: i < 3 ? "Diamond" : "Gold",
  rankColor: i < 3 ? "#6498b7" : "#b39a60",
}));
let saved = null;
let failCommands = false;
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  let data = {};
  if (path === "/api/auth/session")
    data = {
      user: {
        userId: "123",
        username: "Kou",
        permissionLevel: 3,
        permissions: [{ guildId, level: 3 }],
      },
    };
  else if (path === "/api/status")
    data = {
      ready: true,
      guildCount: 12,
      maxGuilds: 100,
      uptimeFormatted: "3日 12時間",
    };
  else if (path.startsWith("/api/guild/")) data = guild;
  else if (path.startsWith("/api/settings/")) {
    if (route.request().method() === "POST") {
      saved = route.request().postDataJSON();
      data = { success: true };
    } else
      data = {
        guildId,
        staffRoleId: "staff",
        webAuthRoleId: "member",
        updatedAt: 1788822000000,
      };
  } else if (path === "/api/staff/commands") {
    if (failCommands)
      return route.fulfill({
        status: 503,
        json: { error: "コマンドを取得できません" },
      });
    data = {
      subcommands: [
        {
          name: "anticheat",
          description: "AntiCheatの設定を表示します。",
          options: [],
        },
        {
          name: "timeout",
          description: "メンバーをタイムアウトします。",
          options: [
            {
              name: "user",
              description: "対象メンバー",
              type: "USER",
              required: true,
              choices: [],
            },
          ],
        },
      ],
    };
  } else if (path.startsWith("/api/rank/panel/"))
    data = {
      guild,
      panel: {
        preset: "コミュニティ",
        lastUpdate: "2026-09-08T10:00:00+09:00",
        topCount: 10,
      },
      preset: {
        description: "みんなの活動を、ひとつずつ。",
        ranks: [
          { name: "Diamond", color: "#6498b7" },
          { name: "Gold", color: "#b39a60" },
        ],
      },
      leaderboard,
    };
  else if (path.startsWith("/api/rank/guild/")) data = { guild, panels: [{ id: "panel-1761736551216", preset: "コミュニティ", lastUpdate: "2026-09-08T10:00:00+09:00", topCount: 10 }] };
  else if (path.startsWith("/api/rank/leaderboard/")) data = { leaderboard };
  else if (path === "/api/user/guilds" || path === "/api/rank/guilds")
    data = { guilds: [{ ...guild, owner: true }] };
  return route.fulfill({ json: data });
});
const routes = {
  home: "/",
  "settings-list": "/settings",
  "rank-home": "/rank",
  "rank-guild": `/rank/${guildId}`,
  settings: `/settings/${guildId}`,
  staff: "/staff",
  rank: `/rank/${guildId}/panel-1761736551216`,
};
try {
  for (const [name, path] of Object.entries(routes)) {
    await page.goto(`http://127.0.0.1:5177${path}`);
    await page.waitForSelector("h1");
    if (name === "settings") await page.waitForSelector("select");
    if (name === "rank") await page.getByLabel("メンバーを検索").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/${name}-desktop.png` });
    assert.equal(
      await page.evaluate(() => {
        const el = document.querySelector(".appMain");
        return el.scrollWidth > el.clientWidth + 1;
      }),
      false,
      `${name} desktop overflow`,
    );
    if (name === "settings") {
      await page
        .getByLabel("スタッフロール", { exact: false })
        .first()
        .selectOption("member");
      await page.getByRole("button", { name: "権限設定を保存" }).click();
      await page.waitForTimeout(100);
      assert.equal(saved.staffRoleId, "member");
    }
    if (name === "staff") {
      await page.getByLabel("ツールを検索").fill("AntiCheat");
      assert.equal(await page.locator("main h3").count(), 1);
      await page.getByLabel("ツールを検索").fill("");
      await page.getByRole("button", { name: "コマンド一覧" }).click();
      await page.getByLabel("コマンドを検索").fill("timeout");
      await page.getByRole("button", { name: /staff timeout/ }).click();
      await page.getByText("対象メンバー", { exact: true }).waitFor();
      await page.getByRole("button", { name: /すべてのツール/ }).click();
    }
    if (name === "rank") {
      await page.getByLabel("メンバーを検索").fill("Mizuki");
      const rows = page.locator('[class*="rankEntry"]');
      assert.equal(await rows.count(), 1);
      assert.match(await rows.first().innerText(), /^4\s/);
      await page.getByLabel("メンバーを検索").fill("");
      await page.getByRole("button", { name: "ランク別", exact: true }).click();
      await page.getByRole("button", { name: /Diamond/ }).click();
      assert.equal(
        await page
          .getByRole("button", { name: /Diamond/ })
          .getAttribute("aria-expanded"),
        "false",
      );
      await page.getByRole("button", { name: "トップ 10" }).click();
    }
    await page.reload();
    await page.waitForSelector("h1");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${output}/${name}-mobile.png` });
    assert.equal(
      await page.evaluate(() => {
        const el = document.querySelector(".appMain");
        return el.scrollWidth > el.clientWidth + 1;
      }),
      false,
      `${name} mobile overflow`,
    );
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.getByRole("button", { name: "ダークテーマへ切り替え" }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/${name}-dark.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${output}/${name}-mobile-dark.png` });
    assert.equal(await page.evaluate(() => {
      const el = document.querySelector('.appMain');
      return el.scrollWidth > el.clientWidth + 1;
    }), false, `${name} mobile dark overflow`);
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.getByRole("button", { name: "ライトテーマへ切り替え" }).click();
  }
  failCommands = true;
  await page.goto("http://127.0.0.1:5177/staff");
  await page.getByLabel("ツールを検索").waitFor();
  assert.equal(await page.locator("main h3").count(), 8);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "メニューを切り替え" }).click();
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("button", { name: "ホーム", exact: true })
    .click();
  await page.waitForURL("http://127.0.0.1:5177/");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checked:
          "7 pages × desktop/mobile/light/dark; search, save, filtering, collapse, navigation, API failure isolation",
        output,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
