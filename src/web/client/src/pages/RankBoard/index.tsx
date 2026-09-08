import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAppToast } from "../../AppToastProvider";
import styles from "./RankBoard.module.css";

interface RankEntry {
  userId: string;
  username: string;
  xp: number;
  rank: string;
  rankColor?: string;
  avatar?: string;
}

interface RankPanel {
  channelId: string;
  messageId: string;
  preset: string;
  lastUpdate: string;
  topCount?: number;
}

interface RankPreset {
  name: string;
  description?: string;
  ranks: Array<{
    name: string;
    minXp: number;
    maxXp: number;
    color?: string;
  }>;
}

interface GuildInfo {
  id: string;
  name: string;
  icon?: string | null;
  iconURL?: string | null;
}

type TabType = "top" | "all" | "byrank";

const RankBoard: React.FC = () => {
  const { guildId, panelId } = useParams<{
    guildId: string;
    panelId: string;
  }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [guild, setGuild] = useState<GuildInfo | null>(null);
  const [panel, setPanel] = useState<RankPanel | null>(null);
  const [preset, setPreset] = useState<RankPreset | null>(null);
  const [topRankings, setTopRankings] = useState<RankEntry[]>([]);
  const [allRankings, setAllRankings] = useState<RankEntry[]>([]);
  const [rankingsByRank, setRankingsByRank] = useState<
    Map<string, RankEntry[]>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("top");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({});
  useAppToast();

  useEffect(() => {
    if (guildId && panelId) {
      fetchRankBoard();
    }
  }, [guildId, panelId]);

  useEffect(() => {
    const key = `rankCollapsed:${guildId}:${panelId}`;
    try {
      if (guildId && panelId) {
        const raw = localStorage.getItem(key);
        if (raw) setCollapsedSections(JSON.parse(raw));
      }
    } catch (e) {
      // ignore
    }
  }, [guildId, panelId]);

  useEffect(() => {
    const key = `rankCollapsed:${guildId}:${panelId}`;
    try {
      if (guildId && panelId)
        localStorage.setItem(key, JSON.stringify(collapsedSections));
    } catch (e) {}
  }, [collapsedSections, guildId, panelId]);

  const toggleCollapse = (name: string) => {
    setCollapsedSections((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const fetchRankBoard = async () => {
    try {
      setLoading(true);
      setError(null);

      // パネルレスポンスにはランキングデータも含まれている
      const panelRes = await fetch(`/api/rank/panel/${guildId}/${panelId}`);

      if (!panelRes.ok) {
        throw new Error("ランキングデータが見つかりません");
      }

      const panelData = await panelRes.json();

      setGuild(panelData.guild);
      setPanel(panelData.panel);
      setPreset(panelData.preset);
      setTopRankings(panelData.leaderboard || []);

      // 全体ランキングを取得
      const allRes = await fetch(
        `/api/rank/leaderboard/${guildId}?preset=${panelData.panel.preset}&limit=1000`,
      );
      if (allRes.ok) {
        const allData = await allRes.json();
        setAllRankings(allData.leaderboard || []);

        // ランク別ランキングを生成
        const byRank = new Map<string, RankEntry[]>();
        if (panelData.preset && panelData.preset.ranks) {
          panelData.preset.ranks.forEach((r: any) => {
            byRank.set(r.name, []);
          });
        }
        (allData.leaderboard || []).forEach((entry: RankEntry) => {
          if (byRank.has(entry.rank)) {
            const arr = byRank.get(entry.rank)!;
            arr.push(entry);
          }
        });
        setRankingsByRank(byRank);
      }
    } catch (err) {
      console.error("Failed to fetch rank board:", err);
      setError("ランキングデータの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const getRankNumber = (index: number) => {
    return `${index + 1}`;
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return "未取得";
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return "未取得";
      return date.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "未取得";
    }
  };

  const getAvatarUrl = (userId: string, avatar?: string) => {
    if (!avatar) return "https://cdn.discordapp.com/embed/avatars/0.png";
    if (/^https?:\/\//.test(avatar)) return avatar;

    const isAnimated = avatar.startsWith("a_");
    const ext = isAnimated ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}?size=64`;
  };

  const getGuildIconUrl = (
    guildId: string,
    icon?: string | null,
    iconURL?: string | null,
  ) => {
    const resolvedIcon = icon || iconURL;
    if (!resolvedIcon) return "";
    if (/^https?:\/\//.test(resolvedIcon)) return resolvedIcon;
    return `https://cdn.discordapp.com/icons/${guildId}/${resolvedIcon}.png`;
  };

  const renderRankingsList = (
    rankings: RankEntry[],
    startIndex: number = 0,
  ) => {
    const visible = rankings
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) =>
        `${entry.username} ${entry.userId}`
          .toLowerCase()
          .includes(searchQuery.trim().toLowerCase()),
      );
    if (visible.length === 0) {
      return (
        <div className={styles.empty}>
          <span
            className="material-icons"
            style={{ fontSize: "48px", marginBottom: "16px" }}
          >
            leaderboard
          </span>
          <p>このビューにランキングデータがありません</p>
        </div>
      );
    }

    return visible.map(({ entry, index }) => {
      const rankClass =
        startIndex + index === 0
          ? styles.rank1
          : startIndex + index === 1
            ? styles.rank2
            : startIndex + index === 2
              ? styles.rank3
              : styles.rankOther;

      return (
        <div
          key={`${entry.userId}-${startIndex + index}`}
          className={styles.rankEntry}
        >
          <div className={`${styles.rankPosition} ${rankClass}`}>
            <span>{getRankNumber(startIndex + index)}</span>
          </div>

          <div className={styles.userInfo}>
            <img
              src={getAvatarUrl(entry.userId, entry.avatar)}
              alt={entry.username}
              className={styles.avatar}
              onError={(e) => {
                e.currentTarget.src =
                  "https://cdn.discordapp.com/embed/avatars/0.png";
              }}
            />
            <div className={styles.userDetails}>
              <span className={styles.username}>{entry.username}</span>
              <span className={styles.userId}>ID: {entry.userId}</span>
            </div>
          </div>

          <div className={styles.rankInfo}>
            <div
              className={styles.rankBadge}
              style={
                {
                  "--rank-color": entry.rankColor || "var(--app-ink-soft)",
                } as React.CSSProperties
              }
            >
              {entry.rank}
            </div>
            <div className={styles.xpInfo}>
              <span className={styles.xpValue}>
                {entry.xp.toLocaleString()}
              </span>
              <span className={styles.xpLabel}>XP</span>
            </div>
          </div>
        </div>
      );
    });
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>ランキングデータを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !guild || !panel) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <span className="material-icons" aria-hidden="true">
            error
          </span>
          <h2>エラー</h2>
          <p>{error || "ランキングデータが見つかりません"}</p>
          <button
            className={styles.backBtn}
            onClick={() => navigate(`/rank/${guildId}`)}
          >
            戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.hero}>
        <button
          className={styles.breadcrumb}
          type="button"
          onClick={() => navigate(`/rank/${guildId}`)}
        >
          <span className="material-icons" aria-hidden="true">
            arrow_back
          </span>
          ランキング一覧
        </button>
        <div className={styles.boardHeading}>
          <div className={styles.boardIdentity}>
            {(guild.icon || guild.iconURL) && (
              <img
                src={getGuildIconUrl(guild.id, guild.icon, guild.iconURL)}
                alt=""
                className={styles.guildIcon}
              />
            )}
            <div>
              <span className={styles.eyebrow}>{guild.name}</span>
              <h1 className={styles.heroTitle}>{panel.preset} ランキング</h1>
              <p className={styles.heroSubtitle}>
                {preset?.description || "日々の会話と活動の記録。"}
              </p>
            </div>
          </div>
          <div className={styles.updateInfo}>
            <span>最終更新</span>
            <time>{formatDate(panel.lastUpdate)}</time>
          </div>
        </div>
        {topRankings.length > 0 && (
          <section className={styles.leaders} aria-label="上位メンバー">
            {topRankings.slice(0, 3).map((entry, index) => (
              <div key={entry.userId} className={styles.leader}>
                <span className={styles.leaderNumber}>0{index + 1}</span>
                <img
                  src={getAvatarUrl(entry.userId, entry.avatar)}
                  alt=""
                  className={styles.avatar}
                />
                <div className={styles.leaderDetails}>
                  <span>{entry.username}</span>
                  <strong>
                    {entry.xp.toLocaleString()} <small>XP</small>
                  </strong>
                </div>
              </div>
            ))}
          </section>
        )}
      </header>

      <div className={styles.mainContent}>
        {/* タブメニュー */}
        <div className={styles.toolbar}>
          <div
            className={styles.tabContainer}
            aria-label="ランキングの表示切り替え"
          >
            <button
              className={`${styles.tabButton} ${activeTab === "top" ? styles.tabActive : ""}`}
              onClick={() => setActiveTab("top")}
              aria-pressed={activeTab === "top"}
            >
              <span className="material-icons" aria-hidden="true">
                military_tech
              </span>
              トップ {panel.topCount || 10}
            </button>
            <button
              className={`${styles.tabButton} ${activeTab === "all" ? styles.tabActive : ""}`}
              onClick={() => setActiveTab("all")}
              aria-pressed={activeTab === "all"}
            >
              <span className="material-icons" aria-hidden="true">
                leaderboard
              </span>
              全体ランキング
            </button>
            <button
              className={`${styles.tabButton} ${activeTab === "byrank" ? styles.tabActive : ""}`}
              onClick={() => setActiveTab("byrank")}
              aria-pressed={activeTab === "byrank"}
            >
              <span className="material-icons" aria-hidden="true">
                category
              </span>
              ランク別
            </button>
          </div>

          <label className={styles.searchBox}>
            <span className="material-icons" aria-hidden="true">
              search
            </span>
            <input
              aria-label="メンバーを検索"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="メンバーを検索"
            />
          </label>
        </div>
        {activeTab !== "byrank" && (
          <div className={styles.tableHeading}>
            <span>順位</span>
            <span>メンバー</span>
            <span>ランク / XP</span>
          </div>
        )}
        {/* Tab Content: Top N */}
        {activeTab === "top" && (
          <div className={styles.rankingsList}>
            {renderRankingsList(topRankings)}
          </div>
        )}

        {/* Tab Content: All Rankings */}
        {activeTab === "all" && (
          <div className={styles.rankingsList}>
            {renderRankingsList(allRankings)}
          </div>
        )}

        {/* Tab Content: By Rank */}
        {activeTab === "byrank" && (
          <div className={styles.rankByRankContainer}>
            {preset && preset.ranks.length > 0 ? (
              preset.ranks.map((rankDef) => (
                <div
                  key={rankDef.name}
                  className={`${styles.rankSection} ${collapsedSections[rankDef.name] ? styles.collapsed : ""}`}
                >
                  <div
                    className={styles.rankSectionHeader}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsedSections[rankDef.name]}
                    onClick={() => toggleCollapse(rankDef.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleCollapse(rankDef.name);
                      }
                    }}
                  >
                    <div
                      className={styles.rankSectionBadge}
                      style={
                        {
                          "--rank-color":
                            rankDef.color || "var(--app-ink-soft)",
                        } as React.CSSProperties
                      }
                    >
                      {rankDef.name}
                    </div>
                    <span className={styles.rankSectionCount}>
                      {rankingsByRank.get(rankDef.name)?.length || 0} 人
                    </span>
                    <span className={styles.collapseIcon} aria-hidden="true">
                      <span className="material-icons" aria-hidden="true">
                        {collapsedSections[rankDef.name]
                          ? "expand_more"
                          : "expand_less"}
                      </span>
                    </span>
                  </div>
                  <div className={styles.rankSectionList}>
                    {(rankingsByRank.get(rankDef.name)?.length || 0) === 0 ? (
                      <div className={styles.empty} style={{ padding: "20px" }}>
                        <p>このランクにはプレイヤーがいません</p>
                      </div>
                    ) : (
                      renderRankingsList(rankingsByRank.get(rankDef.name) || [])
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.empty}>
                <p>ランク定義が見つかりません</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RankBoard;
