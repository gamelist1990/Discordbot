import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.WORKSPACE_UI_URL || "http://127.0.0.1:5181";
const output =
  process.env.WORKSPACE_UI_OUTPUT || "/tmp/discordbot-workspace-ui";
await mkdir(output, { recursive: true });
const guildId = "999999999999999999",
  channelId = "222222222222222222",
  roleId = "333333333333333333",
  own = "111111111111111111";
const channels = [
  { id: channelId, name: "運営ログ", type: 0 },
  { id: "555555555555555555", name: "メンバー用", type: 0 },
];
const roles = [
  { id: roleId, name: "メンバー", managed: false, color: 0, position: 1 },
];
let chats = [
  {
    chatId: "chat-1",
    channelId,
    userId: own,
    staffId: own,
    roomName: "相談ルーム",
    userName: "メンバー",
    staffName: "運営",
    channelExists: true,
    createdAt: Date.now(),
  },
];
let members = [{ id: own, username: "運営", avatar: null }];
let rolePresets = {};
let rankPresets = [
  {
    name: "コミュニティ",
    description: "活動に合わせたランク",
    ranks: [{ name: "ビギナー", minXp: 0, maxXp: 100, color: "#537763" }],
    rewards: [],
  },
];
let rankSettings = {
  updateIntervalMs: 60000,
  xpRates: {
    messageXp: 10,
    messageXpMin: 5,
    messageXpMax: 15,
    messageCooldownSec: 10,
    vcXpPerMinute: 2,
    vcXpPerMinuteMin: 1,
    vcXpPerMinuteMax: 3,
    vcIntervalSec: 60,
    dailyXpCap: 0,
    globalMultiplier: 1,
    excludeChannels: [],
    excludeRoles: [],
  },
};
let rules = [];
let board = null;
let panel = null;
const features = [
  {
    key: "personality",
    label: "性格診断",
    description: "質問に答えて診断できます。",
    emoji: "🌱",
    webSettings: { spectatorRole: false, requestSettings: false },
  },
  {
    key: "request",
    label: "リクエスト",
    description: "運営へのリクエストを受付。",
    emoji: "✉️",
    webSettings: { spectatorRole: true, requestSettings: true },
  },
];
const defaults = {
  enabled: false,
  channelId: null,
  logBots: false,
  joinTitle: "{user} さんが参加しました",
  joinDescription: "{server} へようこそ！",
  leaveTitle: "{user} さんが退出しました",
  leaveDescription: "また会いましょう。",
  joinColor: 5470051,
  leaveColor: 11964258,
};
let joinSettings = { ...defaults };
let custom = {
  displayName: "Kou",
  bio: '<img src=x onerror="window.__profileXss=1">',
  themeColor: "#537763",
  website: "javascript:window.__profileXss=1",
  banner: { type: "color", value: "red;background:url(https://evil.example/)" },
  overviewConfig: {
    cards: [
      {
        id: "intro",
        type: "text",
        content: "<script>window.__profileXss=1</script>",
        pxW: 700,
        pxH: 160,
        x: 0,
        y: 0,
      },
    ],
  },
  privacy: {
    allowPublicView: false,
    showStats: false,
    showServers: false,
    showActivity: false,
  },
};
let failNextWrite = false,
  savedProfiles = [],
  resetCalls = 0;
const errors = [],
  maliciousLoads = [];
const browser = await chromium.launch({
  headless: true,
  channel: process.env.WORKSPACE_UI_CHANNEL || "chrome",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
  route.abort(),
);
await page.route("**/evil.example/**", (route) => {
  maliciousLoads.push(route.request().url());
  return route.abort();
});
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/api/**", async (route) => {
  const request = route.request(),
    path = new URL(request.url()).pathname,
    method = request.method();
  const body =
    method === "GET" || method === "DELETE" ? {} : request.postDataJSON() || {};
  if (!["GET", "HEAD"].includes(method) && failNextWrite) {
    failNextWrite = false;
    return route.fulfill({
      status: 503,
      json: { error: "保存テスト：一時的に失敗しました。" },
    });
  }
  let data = {};
  if (path === "/api/auth/session")
    data = {
      user: {
        userId: own,
        username: "Kou",
        permissionLevel: 3,
        permissions: [{ guildId, level: 3 }],
      },
    };
  else if (path === "/api/staff/guilds")
    data = { guilds: [{ id: guildId, name: "PEX コミュニティ" }] };
  else if (path.endsWith("/roles")) data = { roles };
  else if (path.endsWith("/channels")) data = { channels };
  else if (path.endsWith("/privatechats/stream"))
    return route.fulfill({ contentType: "text/event-stream", body: "\n" });
  else if (path === "/api/staff/privatechats") {
    if (method === "POST") {
      chats.push({ ...chats[0], chatId: "new-chat", roomName: body.roomName });
      data = { success: true, chat: chats.at(-1) };
    } else data = { chats };
  } else if (/\/privatechats\/[^/]+\/members\//.test(path)) {
    members = members.filter((member) => member.id !== path.split("/").at(-1));
    data = { success: true };
  } else if (path.endsWith("/members")) {
    if (method === "POST")
      members.push({ id: roleId, username: body.userName, avatar: null });
    data = { members, success: true };
  } else if (path === "/api/staff/searchusers")
    data = {
      users: [
        {
          id: roleId,
          username: "test_member",
          displayName: "テストメンバー",
          avatar: null,
        },
      ],
    };
  else if (path.includes("/role-presets")) {
    if (method === "GET") data = { presets: rolePresets };
    else if (method === "DELETE") {
      delete rolePresets[path.split("/").at(-1)];
      data = { success: true };
    } else {
      const id = body.id || "preset-new";
      data = { ...body, id };
      rolePresets[id] = data;
    }
  } else if (path.startsWith("/api/staff/corepanel/")) {
    if (method === "POST") {
      panel = { ...body };
      data = {
        config: panel,
        panelUrl:
          "https://discord.com/channels/" + guildId + "/" + channelId + "/123",
      };
    } else data = { features, config: panel, panelUrl: null };
  } else if (path.startsWith("/api/staff/join-log/")) {
    if (method === "PUT") joinSettings = body;
    data = {
      settings: joinSettings,
      defaults,
      channels,
      placeholders: ["{user}", "{server}", "{mention}"],
    };
  } else if (path.startsWith("/api/staff/todo/")) {
    if (method === "POST") board = { ...body, messageId: "todo-message" };
    data = {
      todo: board
        ? {
            board,
            jumpUrl:
              "https://discord.com/channels/" +
              guildId +
              "/" +
              channelId +
              "/123",
          }
        : null,
      boardCount: board ? 1 : 0,
      boardLimit: 2,
    };
  } else if (path.startsWith("/api/staff/rankmanager/")) {
    if (path.endsWith("/presets")) {
      if (method === "POST") {
        rankPresets.push(body);
        data = { preset: body };
      } else data = rankPresets;
    } else if (path.endsWith("/settings")) {
      if (method === "PUT") rankSettings = body;
      data = method === "PUT" ? { settings: rankSettings } : rankSettings;
    } else if (path.endsWith("/panels")) data = {};
    else if (path.endsWith("/rules")) {
      if (method === "POST") rules.push(body);
      data = method === "GET" ? rules : { success: true };
    } else if (path.endsWith("/reset")) {
      resetCalls++;
      data = { success: true };
    } else if (method === "PUT" && path.includes("/presets/")) {
      rankPresets = rankPresets.map((preset) =>
        preset.name === body.name ? body : preset,
      );
      data = { preset: body };
    }
  } else if (path === "/api/user/profile/search")
    data = {
      users: [
        {
          id: roleId,
          username: "test_member",
          displayName: "公開メンバー",
          avatar: null,
        },
      ],
    };
  else if (path === "/api/user/profile/custom") {
    if (method === "PUT") {
      savedProfiles.push(body);
      custom = body;
      data = { success: true, profile: custom };
    } else data = custom;
  } else if (path === "/api/user/profile") {
    const target = new URL(request.url()).searchParams.get("userId");
    data = {
      id: target || own,
      username: target ? "test_member" : "Kou",
      avatar: null,
      isOwnProfile: !target || target === own,
      customProfile: target
        ? { displayName: "公開メンバー", bio: "こんにちは" }
        : custom,
      visibility: { stats: true, servers: true, activity: true },
      totalStats: {
        totalMessages: 120,
        totalLinks: 12,
        totalMedia: 8,
        totalServers: 1,
      },
      guilds: [
        {
          id: guildId,
          name: "PEX コミュニティ",
          role: "メンバー",
          totalMessages: 120,
        },
      ],
    };
  } else if (path === "/api/staff/commands") data = { subcommands: [] };
  return route.fulfill({ json: data });
});
const goto = async (path) => {
  await page.goto(base + path);
  await page.locator("h1").first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].every(el => !el.textContent.includes('読み込んでいます')));
};
const waitNotice = (text) =>
  page.getByRole("status").filter({ hasText: text }).first().waitFor();
const noOverflow = async (label) =>
  assert.equal(
    await page
      .locator(".appMain")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
    false,
    label,
  );
const shot = async (name) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: output + "/" + name + ".png" });
};
const tab = (name) =>
  page
    .getByRole("navigation", { name: "ページ内メニュー" })
    .getByRole("button", { name, exact: true });
try {
  await goto("/staff/privatechat");
  await page.getByRole("button", { name: "部屋を作成", exact: true }).click();
  await page.getByLabel("部屋名", { exact: true }).fill("新しい相談室");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await waitNotice("部屋を作成しました");
  await page.getByRole("button", { name: /新しい相談室/ }).click();
  await page.getByLabel("ユーザー名を検索", { exact: true }).fill("test");
  await page
    .getByRole("button", { name: "ユーザーを検索", exact: true })
    .click();
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await waitNotice("メンバーを追加しました");
  assert.equal(members.length, 2);
  await shot("privatechat-desktop");

  await goto("/staff/rolemanager");
  await page
    .getByRole("button", { name: "プリセットを作成", exact: true })
    .click();
  await page.getByLabel("プリセット名", { exact: true }).fill("参加者ロール");
  await page.getByLabel("メンバー", { exact: true }).check();
  failNextWrite = true;
  await page
    .getByRole("button", { name: "プリセットを保存", exact: true })
    .click();
  await page.getByRole("alert").filter({ hasText: "一時的に失敗" }).waitFor();
  assert.equal(
    await page.getByLabel("プリセット名", { exact: true }).inputValue(),
    "参加者ロール",
  );
  await page
    .getByRole("button", { name: "プリセットを保存", exact: true })
    .click();
  await waitNotice("ロールプリセットを保存しました");
  assert.deepEqual(rolePresets["preset-new"].roles, [roleId]);
  await shot("roles-desktop");

  await goto("/staff/corepanel");
  await page
    .getByLabel("パネルの投稿先", { exact: true })
    .selectOption(channelId);
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await waitNotice("パネル設定を保存しました");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "この設定で投稿・更新", exact: true })
    .click();
  await waitNotice("Discordにパネルを投稿");
  assert.equal(panel.channelId, channelId);
  await shot("corepanel-desktop");

  await goto("/staff/rankmanager");
  await page.getByRole("button", { name: /コミュニティ.*1 段階/ }).click();
  await page.getByLabel("ランク1の名前", { exact: true }).fill("新メンバー");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await waitNotice("ランク設定を保存しました");
  assert.equal(rankPresets[0].ranks[0].name, "新メンバー");
  await tab("XPの基本設定").click();
  await page.getByLabel("メッセージ1件のXP", { exact: true }).fill("18");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await waitNotice("XPの設定を保存しました");
  assert.equal(rankSettings.xpRates.messageXp, 18);
  await tab("XP獲得ルール").click();
  await page
    .getByRole("button", { name: "XPルールを作成", exact: true })
    .click();
  await page.getByLabel("ルール名", { exact: true }).fill("会話への参加");
  await page.getByRole("button", { name: "ルールを保存", exact: true }).click();
  await waitNotice("XPルールを保存しました");
  assert.equal(rules.length, 1);
  await tab("データのリセット").click();
  await page.getByLabel("リセット対象", { exact: true }).selectOption("all");
  assert.equal(
    await page
      .getByRole("button", { name: "対象データをリセット", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(resetCalls, 0);
  await tab("ランクと報酬").click();
  await shot("ranking-desktop");

  await goto("/staff/todo");
  await page.getByRole("button", { name: "タスクを追加", exact: true }).click();
  await page.getByLabel("タスク名", { exact: true }).fill("新しいタスクの確認");
  await page.getByLabel("タスクの状態", { exact: true }).selectOption("doing");
  await page
    .getByRole("button", { name: "Discordへ保存", exact: true })
    .click();
  await waitNotice("Todoを保存し");
  assert.equal(board.items[0].status, "doing");
  await shot("todo-desktop");

  await goto("/staff/join-log");
  await page.getByLabel("参加・退出通知を有効にする", { exact: true }).check();
  await page
    .getByLabel("通知先チャンネル", { exact: true })
    .selectOption(channelId);
  await page
    .getByLabel("タイトル", { exact: true })
    .fill("{user} さん、こんにちは");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await waitNotice("参加・退出ログの設定を保存しました");
  assert.equal(joinSettings.enabled, true);
  assert.equal(joinSettings.joinTitle, "{user} さん、こんにちは");
  await shot("join-log-desktop");

  await goto("/profile");
  await page.getByRole("heading", { name: "Kou", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__profileXss), undefined);
  if (process.env.WORKSPACE_UI_REQUIRE_CSP === '1') {
    await page.evaluate(() => { const script = document.createElement('script'); script.textContent = 'window.__inlineProfileScriptExecuted = true'; document.body.append(script); script.remove(); });
    assert.equal(await page.evaluate(() => window.__inlineProfileScriptExecuted), undefined, 'production CSP blocks inline script execution');
  }
  assert.deepEqual(maliciousLoads, []);
  assert.equal(
    await page
      .locator('a[href^="javascript:"], img[src^="javascript:"]')
      .count(),
    0,
  );
  await page.getByLabel("ユーザーを検索", { exact: true }).fill("test");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: /公開メンバー/ }).click();
  await page
    .getByRole("heading", { name: "公開メンバー", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "プロフィールを編集", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "自分のプロフィール", exact: true })
    .click();
  await page
    .getByRole("button", { name: "プロフィールを編集", exact: true })
    .click();
  await page.getByLabel("表示名", { exact: true }).fill("Kou のプロフィール");
  await tab('デザイン').click();
  await page.getByLabel('お気に入りの絵文字（スペース区切り・最大10個）', { exact: true }).fill('🌿 🎮');
  await tab("自由に並べるカード").click();
  await page.getByRole("button", { name: "カードを追加", exact: true }).click();
  await page
    .getByLabel("カード2の内容", { exact: true })
    .fill('<img src=x onerror="window.__profileXss=2">');
  await tab("公開範囲").click();
  await page
    .getByLabel("他のユーザーにプロフィールを公開する", { exact: true })
    .check();
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await waitNotice("プロフィールを保存しました");
  assert.equal(savedProfiles[0].privacy.allowPublicView, true);
  assert.equal(savedProfiles[0].displayName, "Kou のプロフィール");
  assert.deepEqual(savedProfiles[0].favoriteEmojis.map(entry => entry.emoji), ['🌿', '🎮']);
  assert.equal(savedProfiles[0].overviewConfig.cards.length, 2);
  assert.equal("userId" in savedProfiles[0], false);
  assert.equal(await page.evaluate(() => window.__profileXss), undefined);
  await shot("profile-editor-desktop");
  await tab("基本情報").click();
  await page
    .getByLabel("ウェブサイト", { exact: true })
    .fill("javascript:alert(1)");
  await tab("公開範囲").click();
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "http / https" }).waitFor();
  assert.equal(savedProfiles.length, 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "変更を取り消す", exact: true })
    .click();

  const paths = [
    "/staff/privatechat",
    "/staff/rolemanager",
    "/staff/corepanel",
    "/staff/rankmanager",
    "/staff/todo",
    "/staff/join-log",
    "/profile",
    "/settings/profile",
  ];
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await goto(path);
      await page.getByRole("heading").first().waitFor();
      if (width <= 390) {
        if (path === '/staff/privatechat') await page.getByRole('button', { name: /相談ルーム/ }).first().click();
        if (path === '/staff/rolemanager') await page.getByRole('button', { name: /参加者ロール/ }).first().click();
        if (path === '/staff/rankmanager') await page.getByRole('button', { name: /コミュニティ.*段階/ }).first().click();
        if (path === '/staff/todo') await page.getByRole('button', { name: /新しいタスクの確認/ }).first().click();
      }
      await noOverflow(width + "px " + path);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of paths) {
    await goto(path);
    await shot(path.replaceAll("/", "-").slice(1) + "-mobile");
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await shot("profile-editor-mobile-dark");
  await goto("/staff/channel-manager");
  assert.equal(
    await page.getByText("チャンネル管理", { exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(maliciousLoads, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        output,
        checked:
          "6 management pages + profile/view editor at 5 widths; mocked CRUD; retry; preview; rank reset guard; user search; persisted customization; XSS URL/CSS/text regression; removed channel route",
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({ path: output + "/failure.png" }).catch(() => {});
  console.error("Browser errors:", errors);
  throw error;
} finally {
  await browser.close();
}
