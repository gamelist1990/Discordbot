import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { Collection } from "discord.js";
import config from "../src/config.ts";
import {
  normalizeProfile,
  safeWebUrl,
} from "../src/web/shared/profileSafety.ts";
import { ProfileService } from "../src/web/services/ProfileService.ts";
import {
  createProfileController,
  profileWriteOriginAllowed,
} from "../src/web/controllers/ProfileController.ts";
import { createUserRoutes } from "../src/web/routes/user.ts";
import { database } from "../src/core/persistence/Database.ts";
import {
  browserMutationGuard,
  browserSecurityHeaders,
  configuredOrigins,
  spaContentSecurityPolicy,
} from "../src/web/middleware/browserSecurity.ts";
(globalThis as any)._cacheCleanupInterval?.unref?.();
const own = "111111111111111111",
  visible = "222222222222222222",
  hidden = "333333333333333333",
  foreign = "444444444444444444";
const publicProfile = {
  displayName: "公開メンバー",
  privacy: {
    allowPublicView: true,
    showStats: false,
    showServers: false,
    showActivity: false,
  },
};
const makeService = () => {
  const rows = new Map<string, any>([
    [
      `UserProfiles/${own}`,
      { ...publicProfile, displayName: "自分", userId: own },
    ],
    [`UserProfiles/${visible}`, publicProfile],
    [
      `UserProfiles/${hidden}`,
      { displayName: "非公開メンバー", privacy: { allowPublicView: false } },
    ],
    [`UserProfiles/${foreign}`, publicProfile],
  ]);
  return {
    rows,
    service: new ProfileService({
      get: async (_scope: string, key: string) => rows.get(key) || null,
      set: async (_scope: string, key: string, data: unknown) => {
        rows.set(key, structuredClone(data));
      },
    } as any),
  };
};

test("profile validation rejects executable URLs, CSS payloads and malformed structures", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "https://user:password@example.com/",
  ]) {
    assert.equal(safeWebUrl(value), undefined);
    assert.ok(normalizeProfile({ website: value }).errors.length);
    assert.ok(
      normalizeProfile({ banner: { type: "image", value } }).errors.length,
    );
    assert.ok(
      normalizeProfile({
        overviewConfig: { cards: [{ id: "x", type: "image", content: value }] },
      }).errors.length,
    );
  }
  for (const input of [
    null,
    [],
    12,
    { privacy: [] },
    { banner: "bad" },
    { favoriteEmojis: [null] },
    { overviewConfig: { cards: [null] } },
  ])
    assert.ok(normalizeProfile(input).errors.length);
  assert.ok(normalizeProfile({ overviewConfig: { cards: [{ type: 'text', content: 'test', meta: { fontWeight: { toString: 'not callable', valueOf: 'not callable' } } }] } }).errors.length);
  assert.ok(
    normalizeProfile({ themeColor: "red;background:url(https://evil.example)" })
      .errors.length,
  );
  const result = normalizeProfile({
    userId: hidden,
    badges: [{ name: "Admin" }],
    html: "<script>alert(1)</script>",
    overviewConfig: {
      cards: [
        {
          id: "text",
          type: "text",
          content: "<script>alert(1)</script>",
          meta: {
            color: "#123456",
            position: "fixed",
            background: "url(https://evil.example)",
          },
        },
      ],
    },
  });
  assert.equal(result.errors.length, 0);
  assert.equal("userId" in result.profile, false);
  assert.equal("badges" in result.profile, false);
  assert.equal("html" in result.profile, false);
  assert.deepEqual(result.profile.overviewConfig.cards[0].meta, {
    color: "#123456",
  });
});

test("stored legacy URLs are sanitized and partial privacy edits keep hidden fields hidden", async () => {
  const { rows, service } = makeService();
  rows.set(`UserProfiles/${own}`, {
    userId: own,
    website: "javascript:alert(1)",
    privacy: {
      allowPublicView: false,
      showStats: false,
      showServers: false,
      showActivity: false,
    },
    createdAt: "2020-01-01",
    badges: [
      { id: "earned", name: "参加バッジ", icon: "🌿", earnedAt: "2020-01-01" },
    ],
  });
  assert.equal((await service.getCustomProfile(own))?.website, undefined);
  await service.saveCustomProfile(own, {
    bio: "<img src=x onerror=alert(1)>",
    privacy: { showStats: true },
    badges: [{ id: "forged", name: "Admin" }],
  } as any);
  assert.equal(rows.get(`UserProfiles/${own}`).privacy.allowPublicView, false);
  assert.equal(rows.get(`UserProfiles/${own}`).privacy.showServers, false);
  assert.equal(rows.get(`UserProfiles/${own}`).createdAt, "2020-01-01");
  assert.equal(rows.get(`UserProfiles/${own}`).website, undefined);
  assert.equal(rows.get(`UserProfiles/${own}`).badges[0].id, "earned");
});

test("origin checks reject foreign websites and cross-site writes", () => {
  assert.equal(
    profileWriteOriginAllowed(
      "https://community.example",
      "https://community.example/path",
    ),
    true,
  );
  assert.equal(
    profileWriteOriginAllowed(
      "https://community.example.evil.test",
      "https://community.example",
    ),
    false,
  );
  assert.equal(
    profileWriteOriginAllowed(
      "https://community.example",
      "https://community.example",
      "cross-site",
    ),
    false,
  );
  assert.equal(
    profileWriteOriginAllowed(undefined, "https://community.example"),
    false,
  );
  assert.equal(
    profileWriteOriginAllowed("null", "https://community.example"),
    false,
  );
});

async function appFixture(t: any) {
  const { rows, service } = makeService();
  const users = new Collection<string, any>(
    [own, visible, hidden, foreign].map((id, i) => [
      id,
      {
        id,
        username: [
          "viewer",
          "public_person",
          "private_person",
          "foreign_person",
        ][i],
        bot: false,
        displayAvatarURL: () =>
          "https://cdn.discordapp.com/embed/avatars/0.png",
      },
    ]),
  );
  const members = new Collection(
    [own, visible, hidden].map((id) => [
      id,
      {
        id,
        user: users.get(id),
        displayName: users.get(id).username,
        roles: { highest: { name: "Member" } },
      },
    ]),
  );
  let memberCalls = 0;
  const guild = {
    id: "999999999999999999",
    name: "共通サーバー",
    iconURL: () => null,
    members: {
      cache: members,
      fetch: async (id: any) => {
        memberCalls++;
        return typeof id === "string" ? members.get(id) || null : members;
      },
    },
  };
  const nonMutual = {
    id: "888888888888888888",
    name: "非共通サーバー",
    members: {
      cache: new Collection([
        [
          foreign,
          {
            id: foreign,
            user: users.get(foreign),
            displayName: "foreign_person",
          },
        ],
      ]),
      fetch: async () => null,
    },
  };
  const bot = {
    client: {
      users: {
        cache: users,
        fetch: async (id: string) => users.get(id) || null,
      },
      guilds: {
        cache: new Collection([
          [guild.id, guild],
          [nonMutual.id, nonMutual],
        ]),
      },
    },
  } as any;
  const sessions = new Map([
    [
      "test-session",
      {
        userId: own,
        username: "viewer",
        guildIds: [guild.id],
        expiresAt: Date.now() + 60000,
      } as any,
    ],
  ]);
  const app = express();
  app.use(browserSecurityHeaders);
  app.use(
    "/api",
    browserMutationGuard(
      configuredOrigins([config.BASE_URL, config.WEB_BASE_URL]),
    ),
  );
  app.post("/api/write-probe", (_req, res) => res.json({ success: true }));
  app.get("/csp-probe", spaContentSecurityPolicy, (_req, res) =>
    res.type("html").send("<!doctype html><title>test</title>"),
  );
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.cookies =
      req.get("cookie") === "sessionId=test-session"
        ? { sessionId: "test-session" }
        : {};
    next();
  });
  app.use("/api/user", createUserRoutes(sessions, bot, service));
  app.use("/api/user/profile", createProfileController(sessions, service));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address() as any;
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init,
      headers: { Cookie: "sessionId=test-session", ...init.headers },
    });
  return { call, rows, calls: () => memberCalls };
}

test("profile HTTP writes enforce authentication, origin, owner identity and URL validation", async (t) => {
  const { call, rows } = await appFixture(t);
  const endpoint = "/api/user/profile/custom";
  const put = (body: unknown, origin = new URL(config.BASE_URL).origin) =>
    call(endpoint, {
      method: "PUT",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await call(endpoint, { headers: { Cookie: "" } })).status, 401);
  assert.equal(
    (await put({ bio: "changed" }, "https://evil.example")).status,
    403,
  );
  assert.equal((await put({ userId: hidden, bio: "changed" })).status, 403);
  assert.equal((await put({ website: "javascript:alert(1)" })).status, 400);
  assert.equal((await put(null)).status, 400);
  assert.equal((await call(endpoint + "?userId=../../config")).status, 400);
  assert.equal((await call(endpoint + "?userId=" + hidden)).status, 403);
  assert.equal(
    (await put({ bio: "保存テスト", themeColor: "#123456" })).status,
    200,
  );
  assert.equal(rows.get(`UserProfiles/${own}`).bio, "保存テスト");
  assert.equal(
    rows.get(`UserProfiles/${hidden}`).displayName,
    "非公開メンバー",
  );
});

test("browser middleware rejects foreign writes and serves restrictive SPA headers", async (t) => {
  const { call } = await appFixture(t);
  const origin = new URL(config.BASE_URL).origin;
  assert.equal(
    (
      await call("/api/write-probe", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/write-probe", {
        method: "POST",
        headers: { Origin: origin, "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/write-probe", {
        method: "POST",
        headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" },
      })
    ).status,
    200,
  );
  const response = await call("/csp-probe");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const policy = response.headers.get("content-security-policy")!;
  assert.match(policy, /script-src 'self'/);
  assert.equal(policy.includes("unsafe-inline"), false);
  assert.match(policy, /object-src 'none'/);
});

test("private profiles expose neither membership nor stats; public privacy flags apply to API payloads", async (t) => {
  const { call, calls } = await appFixture(t);
  let statReads = 0;
  const original = database.getUserGuildData;
  database.getUserGuildData = async () => {
    statReads++;
    return { totalMessages: 999 } as any;
  };
  t.after(() => {
    database.getUserGuildData = original;
  });
  assert.equal((await call("/api/user/profile?userId=" + hidden)).status, 403);
  assert.equal(calls(), 0);
  const response = await call("/api/user/profile?userId=" + visible);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.guilds, []);
  assert.equal(body.totalStats.totalMessages, 0);
  assert.deepEqual(body.visibility, {
    stats: false,
    servers: false,
    activity: false,
  });
  assert.equal(statReads, 0);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("profile search returns only visible mutual members, supports custom display names and limits repeated searches", async (t) => {
  const { call } = await appFixture(t);
  const response = await call(
    "/api/user/profile/search?q=" + encodeURIComponent("公開メンバー"),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(
    body.users.map((user: any) => user.id),
    [visible],
  );
  assert.equal((await call("/api/user/profile/search?q=person")).status, 429);
});
