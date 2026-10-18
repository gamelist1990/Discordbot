import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useResource,
  ResourceState,
  Tabs,
  ui,
} from "../../components/Workspace/Workspace";
import { safeWebUrl } from "../../../../shared/profileSafety";
import { ProfileView } from "./ProfileView";
type User = {
  id: string;
  username: string;
  displayName: string;
  avatar?: string | null;
};
type Profile = {
  id: string;
  username: string;
  avatar?: string | null;
  isOwnProfile: boolean;
  customProfile?: Record<string, any>;
  visibility: { stats: boolean; servers: boolean; activity: boolean };
  totalStats: {
    totalMessages: number;
    totalLinks: number;
    totalMedia: number;
    totalServers: number;
  };
  guilds: {
    id: string;
    name: string;
    role?: string;
    joinedAt?: string;
    totalMessages: number;
  }[];
};
export default function UserProfile() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const resource = useResource<Profile>(
    "/api/user/profile" +
      (userId ? "?userId=" + encodeURIComponent(userId) : ""),
  );
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const directory = useResource<{ users: User[] }>(
    search ? "/api/user/profile/search?q=" + encodeURIComponent(search) : null,
  );
  const [tab, setTab] = useState<"about" | "stats" | "servers">("about");
  const profile = resource.data;
  return (
    <div className={ui.page}>
      <header className={ui.header}>
        <div>
          <span className={ui.eyebrow}>COMMUNITY / MEMBERS</span>
          <h1>プロフィール</h1>
          <p>
            メンバーを探してプロフィールを見る。自分のページは自由にカスタマイズできます。
          </p>
        </div>
      </header>
      <form
        className={ui.toolbar}
        style={{ marginTop: 24 }}
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query.trim());
        }}
      >
        <label style={{ flex: 1 }}>
          ユーザーを検索
          <input
            type="search"
            minLength={2}
            maxLength={80}
            required
            placeholder="ユーザー名・表示名・ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="submit" className={ui.primary}>
          検索
        </button>
        <button
          type="button"
          className={ui.secondary}
          onClick={() => {
            setSearch("");
            setQuery("");
            navigate("/profile");
          }}
        >
          自分のプロフィール
        </button>
      </form>
      <p className={ui.muted}>
        共通サーバーのメンバーのうち、プロフィールを公開しているユーザーを検索します。
      </p>
      {search && (
        <section className={ui.card} style={{ marginTop: 20 }}>
          <div className={ui.row}>
            <h2>検索結果</h2>
            <button
              type="button"
              className={ui.secondary}
              onClick={() => setSearch("")}
            >
              検索を閉じる
            </button>
          </div>
          {directory.loading || directory.error ? (
            <ResourceState {...directory} retry={directory.reload} />
          ) : (
            <div className={ui.results}>
              {directory.data?.users.map((user) => (
                <button
                  type="button"
                  className={ui.listButton}
                  key={user.id}
                  onClick={() => {
                    navigate("/profile/" + encodeURIComponent(user.id));
                    setSearch("");
                    setTab("about");
                  }}
                >
                  <span className={ui.actions}>
                    {safeWebUrl(user.avatar) && (
                      <img
                        className={ui.avatar}
                        src={safeWebUrl(user.avatar)}
                        referrerPolicy="no-referrer"
                        alt=""
                      />
                    )}
                    <span>
                      <strong>{user.displayName}</strong>
                      <small>@{user.username}</small>
                    </span>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
              {directory.data?.users.length === 0 && (
                <ResourceState
                  loading={false}
                  empty="公開プロフィールが見つかりませんでした。ユーザー名やIDを変えてお試しください。"
                />
              )}
            </div>
          )}
        </section>
      )}
      <div style={{ marginTop: 28 }} className={ui.stack}>
        {resource.loading || resource.error || !profile ? (
          <>
            <ResourceState {...resource} retry={resource.reload} />
            <a className={ui.secondary} href="/api/auth/discord">
              Discordでログイン
            </a>
          </>
        ) : (
          <>
            <div className={ui.toolbar}>
              <span className={ui.badge}>
                {profile.isOwnProfile
                  ? profile.customProfile?.privacy?.allowPublicView
                    ? "自分のプロフィール · 公開中"
                    : "自分のプロフィール · 非公開"
                  : "公開プロフィール"}
              </span>
              {profile.isOwnProfile && (
                <button
                  type="button"
                  className={ui.primary}
                  onClick={() => navigate("/settings/profile")}
                >
                  プロフィールを編集
                </button>
              )}
            </div>
            <ProfileView
              custom={profile.customProfile || {}}
              username={profile.username}
              avatar={profile.avatar}
            />
            <Tabs
              value={tab}
              onChange={setTab}
              options={[
                ["about", "自己紹介"],
                ...(profile.visibility.stats
                  ? [["stats", "活動の統計"] as const]
                  : []),
                ...(profile.visibility.servers
                  ? [["servers", "参加サーバー"] as const]
                  : []),
              ]}
            />
            {tab === "about" && (
              <section className={ui.card}>
                <h2>
                  {profile.isOwnProfile
                    ? "自分らしいプロフィールに"
                    : "このプロフィールについて"}
                </h2>
                <p>
                  {profile.isOwnProfile
                    ? "編集画面でバナー、テーマカラー、自己紹介、画像やカードを設定できます。公開する情報も選べます。"
                    : "本人が公開を許可した情報を表示しています。"}
                </p>
              </section>
            )}
            {tab === "stats" && profile.visibility.stats && (
              <section className={ui.card}>
                <h2>公開されている活動の統計</h2>
                <div className={ui.formGrid}>
                  {Object.entries({
                    メッセージ: profile.totalStats.totalMessages,
                    リンク: profile.totalStats.totalLinks,
                    "画像・動画": profile.totalStats.totalMedia,
                    サーバー: profile.totalStats.totalServers,
                  }).map(([label, value]) => (
                    <div className={ui.preview} key={label}>
                      <small>{label}</small>
                      <strong>{value.toLocaleString("ja-JP")}</strong>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {tab === "servers" && profile.visibility.servers && (
              <section className={ui.card}>
                <h2>
                  {profile.isOwnProfile ? "参加サーバー" : "共通の参加サーバー"}
                </h2>
                {profile.guilds.map((guild) => (
                  <div className={ui.entry} key={guild.id}>
                    <div>
                      <strong>{guild.name}</strong>
                      <small>
                        {guild.role}
                        {guild.joinedAt &&
                          " · 参加 " +
                            new Date(guild.joinedAt).toLocaleDateString(
                              "ja-JP",
                            )}
                      </small>
                    </div>
                    <button
                      className={ui.secondary}
                      type="button"
                      onClick={() =>
                        navigate("/rank/" + encodeURIComponent(guild.id))
                      }
                    >
                      ランキングを見る
                    </button>
                  </div>
                ))}
                {!profile.guilds.length && (
                  <p>表示できるサーバーはありません。</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
