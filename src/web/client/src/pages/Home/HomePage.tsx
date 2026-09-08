import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchBotStatus } from "../../services/api";
import type { BotStatusResponse } from "../../types";
import styles from "./HomePage.module.css";

const destinations = [
  {
    number: "01",
    title: "サーバー設定",
    text: "権限とロール、日々の運用を整える。",
    icon: "tune",
    path: "/settings",
  },
  {
    number: "02",
    title: "ランキング",
    text: "会話や活動の積み重ねを見てみよう。",
    icon: "leaderboard",
    path: "/rank",
  },
  {
    number: "03",
    title: "プロフィール",
    text: "自分の記録と、みんなに見せるページ。",
    icon: "person_outline",
    path: "/profile",
  },
];
const HomePage: React.FC = () => {
  const [user, setUser] = useState<{
    username: string;
    permissionLevel?: number;
  } | null>(null);
  const [status, setStatus] = useState<BotStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch("/api/auth/session", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetchBotStatus().catch(() => null),
    ]).then(([session, bot]) => {
      if (mounted) {
        setUser(session?.user || null);
        setStatus(bot);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>PEXServer / COMMUNITY</p>
          <h1>
            いつもの場所を、
            <br />
            もっと心地よく。
          </h1>
          <p className={styles.description}>
            集まる、話す、一緒に楽しむ。
            <br />
            その時間を支える、サーバーの管理ツール。
          </p>
          <div className={styles.actions}>
            {loading ? (
              <span className={styles.loading} role="status">
                アカウントを確認中…
              </span>
            ) : user ? (
              <Link className={styles.primary} to="/settings">
                サーバーを管理する{" "}
                <span className="material-icons" aria-hidden="true">
                  arrow_forward
                </span>
              </Link>
            ) : (
              <a className={styles.primary} href="/api/auth/discord">
                Discordでログイン{" "}
                <span className="material-icons" aria-hidden="true">
                  arrow_forward
                </span>
              </a>
            )}
            <Link className={styles.textLink} to="/rank">
              ランキングを見る
            </Link>
          </div>
          {user && (
            <p className={styles.welcome}>
              おかえりなさい、{user.username}さん。
            </p>
          )}
        </div>
        <aside className={styles.directory} aria-label="サーバーの管理機能">
          <div className={styles.directoryHeading}>
            <span>YOUR COMMUNITY</span>
            <span className="material-icons" aria-hidden="true">
              north_east
            </span>
          </div>
          <h2>
            運営のことは、
            <br />
            ここから。
          </h2>
          <div className={styles.directoryLinks}>
            <Link to="/settings">
              <span className="material-icons" aria-hidden="true">
                dns
              </span>
              <span>
                サーバーを選ぶ<small>設定・権限・ロール</small>
              </span>
              <span aria-hidden="true">↗</span>
            </Link>
            <Link to="/staff">
              <span className="material-icons" aria-hidden="true">
                shield
              </span>
              <span>
                スタッフツール<small>モデレーション・ログ・個別対応</small>
              </span>
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <p className={styles.directoryNote}>
            Discordのアカウントで利用できます。
          </p>
        </aside>
      </section>
      <section className={styles.statusBar} aria-label="Botの稼働状況">
        <div className={styles.statusTitle}>
          <span
            className={`${styles.statusDot} ${status?.ready ? styles.online : ""}`}
          />
          {loading
            ? "稼働状況を確認中"
            : status
              ? status.ready
                ? "システム稼働中"
                : "Bot停止中"
              : "稼働状況を取得できません"}
        </div>
        <div>
          <span>接続サーバー</span>
          <strong>{status ? status.guildCount.toLocaleString() : "—"}</strong>
        </div>
        <div>
          <span>連続稼働</span>
          <strong>{status?.uptimeFormatted || "—"}</strong>
        </div>
        <span className={styles.statusLabel}>SYSTEM STATUS</span>
      </section>
      <section className={styles.explore}>
        <div className={styles.sectionHeading}>
          <h2>何をしましょうか。</h2>
          <span>EXPLORE PEX</span>
        </div>
        <div className={styles.links}>
          {destinations.map((item) => (
            <Link to={item.path} key={item.path} className={styles.destination}>
              <div className={styles.destinationTop}>
                <span>{item.number}</span>
                <span className="material-icons" aria-hidden="true">
                  {item.icon}
                </span>
              </div>
              <h3>
                {item.title}
                <span aria-hidden="true">↗</span>
              </h3>
              <p>{item.text}</p>
            </Link>
          ))}
        </div>
      </section>
      <footer className={styles.footer}>
        <strong>PEXServer</strong>
        <span>コミュニティと、その日常のために。</span>
        <Link to="/settings">
          管理コンソール <span aria-hidden="true">↗</span>
        </Link>
      </footer>
    </div>
  );
};
export default HomePage;
