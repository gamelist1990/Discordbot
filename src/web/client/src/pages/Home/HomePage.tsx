import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell';
import { fetchBotStatus } from '../../services/api';
import type { BotStatusResponse } from '../../types';
import styles from './HomePage.module.css';

interface UserSession {
  userId: string;
  username: string;
  avatar?: string | null;
}

const capabilityCards = [
  {
    title: 'サーバー設定',
    description: '権限、ロール、各種運用設定をサーバー単位で落ち着いて調整できます。',
    icon: 'tune',
  },
  {
    title: 'スタッフ運用',
    description: 'AntiCheat、プライベートチャット、ロール管理を一枚の導線に集約します。',
    icon: 'shield',
  },
  {
    title: 'プロフィール',
    description: '個人ページと表示設定を整えて、メンバーの見え方も統一できます。',
    icon: 'person',
  },
  {
    title: 'ランキング',
    description: '活動量と進行状況を見える化して、コミュニティの熱量を追跡できます。',
    icon: 'leaderboard',
  },
];

const workflowSteps = [
  {
    title: 'サーバーを選ぶ',
    description: '管理権限のあるサーバーを一覧から選択し、必要な運用面へすぐ入れます。',
  },
  {
    title: '役割ごとに整える',
    description: '一般設定、権限、スタッフ向け機能を役割に応じた粒度で整理します。',
  },
  {
    title: '状態を追い続ける',
    description: 'ステータス、フィードバック、ランキングを見ながら運用改善を回します。',
  },
];

const quickLinks = [
  { title: 'サーバー管理', description: '管理対象サーバーへ進む', path: '/settings', icon: 'tune' },
  { title: 'フィードバック', description: '要望と改善状況を確認する', path: '/feedback', icon: 'forum' },
  { title: 'ランキング', description: '活動データと公開パネルを確認する', path: '/rank', icon: 'leaderboard' },
  { title: 'Tools', description: '補助ツールを開く', path: '/tools', icon: 'construction' },
];

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserSession | null>(null);
  const [status, setStatus] = useState<BotStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [sessionResponse, botStatus] = await Promise.all([
          fetch('/api/auth/session', { credentials: 'include' }),
          fetchBotStatus().catch(() => null),
        ]);

        if (!mounted) {
          return;
        }

        if (sessionResponse.ok) {
          const data = await sessionResponse.json();
          setUser(data.user ?? null);
        } else {
          setUser(null);
        }

        setStatus(botStatus);
      } catch (error) {
        console.error('Failed to load home page:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.spinner} />
        <p>ホームを準備しています...</p>
      </div>
    );
  }

  const statusCards = [
    {
      label: 'Status',
      value: status?.ready ? 'Online' : 'Standby',
      tone: status?.ready ? styles.ok : styles.warn,
      caption: status?.ready ? 'Bot とダッシュボードが稼働中です' : '起動状態を確認しています',
      icon: 'power_settings_new',
    },
    {
      label: 'Guilds',
      value: status ? `${status.guildCount} / ${status.maxGuilds}` : '-',
      tone: styles.neutral,
      caption: '接続サーバー数',
      icon: 'hub',
    },
    {
      label: 'Uptime',
      value: status?.uptimeFormatted || '-',
      tone: styles.neutral,
      caption: '連続稼働時間',
      icon: 'schedule',
    },
  ];

  return (
    <div className={styles.page}>
      <PageShell
        eyebrow="Control Surface"
        title="PEXServer"
        description="Discord サーバー運用を、散らかった設定画面ではなく落ち着いた一枚のワークスペースとして扱うためのホームです。"
        actions={
          <>
            {user ? (
              <button className={styles.primaryAction} onClick={() => navigate('/profile')} type="button">
                <span className="material-icons">dashboard</span>
                ワークスペースへ
              </button>
            ) : (
              <button
                className={styles.primaryAction}
                onClick={() => {
                  window.location.href = '/api/auth/discord';
                }}
                type="button"
              >
                <span className="material-icons">login</span>
                Discordでログイン
              </button>
            )}
            <button className={styles.secondaryAction} onClick={() => navigate('/settings')} type="button">
              <span className="material-icons">tune</span>
              サーバー管理
            </button>
          </>
        }
        meta={
          <>
            <span className={styles.metaChip}>権限と運用を一元管理</span>
            <span className={styles.metaChip}>Todo / Trigger は整理済み</span>
            <span className={styles.metaChip}>フォルダ構造ベースの永続化へ移行</span>
          </>
        }
        aside={
          <div className={styles.statusBoard}>
            <div className={styles.statusLead}>
              <span className={styles.statusLabel}>Current state</span>
              <strong>{user ? `${user.username} のワークスペース` : '公開ホーム'}</strong>
              <p>{user ? 'プロフィールや各管理画面へすぐに移動できます。' : 'ログインすると個人ページと管理機能が解放されます。'}</p>
            </div>

            <div className={styles.statusGrid}>
              {statusCards.map((card) => (
                <div key={card.label} className={`${styles.statusCard} ${card.tone}`}>
                  <span className={styles.statusIcon}>
                    <span className="material-icons">{card.icon}</span>
                  </span>
                  <div>
                    <span className={styles.cardLabel}>{card.label}</span>
                    <strong className={styles.cardValue}>{card.value}</strong>
                    <p className={styles.cardCaption}>{card.caption}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        }
      >
        <section className={styles.section}>
          <div className={styles.sectionIntro}>
            <span className={styles.sectionEyebrow}>Capabilities</span>
            <h2>今必要な管理機能だけを、迷わず辿れる構成に。</h2>
            <p>
              ホームでやるべきことを明確にし、設定・スタッフ運用・可視化の導線を短く保っています。
            </p>
          </div>

          <div className={styles.capabilityGrid}>
            {capabilityCards.map((card, index) => (
              <article
                key={card.title}
                className={styles.capabilityCard}
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <span className={styles.capabilityIcon}>
                  <span className="material-icons">{card.icon}</span>
                </span>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.splitSection}>
            <div className={styles.sectionIntro}>
              <span className={styles.sectionEyebrow}>Flow</span>
              <h2>設定の順序まで含めて、ホームから誘導します。</h2>
              <p>
                何から触るべきか分かるように、初期導線を 3 つのステップに圧縮しています。
              </p>
            </div>

            <div className={styles.workflow}>
              {workflowSteps.map((step, index) => (
                <article key={step.title} className={styles.workflowStep}>
                  <span className={styles.stepNumber}>0{index + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionIntro}>
            <span className={styles.sectionEyebrow}>Quick Access</span>
            <h2>主要な面へ、そのまま移動。</h2>
          </div>

          <div className={styles.linkGrid}>
            {quickLinks.map((link) => (
              <button
                key={link.path}
                className={styles.linkCard}
                onClick={() => navigate(link.path)}
                type="button"
              >
                <span className={styles.linkIcon}>
                  <span className="material-icons">{link.icon}</span>
                </span>
                <div className={styles.linkBody}>
                  <strong>{link.title}</strong>
                  <p>{link.description}</p>
                </div>
                <span className="material-icons">arrow_forward</span>
              </button>
            ))}
          </div>
        </section>
      </PageShell>
    </div>
  );
};

export default HomePage;
