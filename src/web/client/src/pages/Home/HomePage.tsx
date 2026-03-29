import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBotStatus } from '../../services/api';
import type { BotStatusResponse } from '../../types';
import styles from './HomePage.module.css';

interface UserSession {
  userId: string;
  username: string;
  avatar?: string | null;
}

const capabilities = [
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
    number: '01',
    title: 'サーバーを選ぶ',
    description: '管理権限のあるサーバーを一覧から選択し、必要な運用面へすぐ入れます。',
  },
  {
    number: '02',
    title: '役割ごとに整える',
    description: '一般設定、権限、スタッフ向け機能を役割に応じた粒度で整理します。',
  },
  {
    number: '03',
    title: '状態を追い続ける',
    description: 'ステータス、ログ、ランキングを見ながら運用改善を回します。',
  },
];

const quickActions = [
  { title: 'サーバー管理', description: '管理対象サーバーへ進む', path: '/settings', icon: 'tune' },
  { title: 'スタッフ運用', description: 'AntiCheat と運用サービスへ進む', path: '/staff', icon: 'shield' },
  { title: 'ランキング', description: '活動データと公開パネルを確認する', path: '/rank', icon: 'leaderboard' },
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

  const statusMetrics = [
    {
      label: 'Status',
      value: status?.ready ? 'Online' : 'Standby',
      tone: status?.ready ? 'ok' : 'warn',
      caption: status?.ready ? 'Bot とダッシュボードが稼働中です' : '起動状態を確認しています',
      icon: 'power_settings_new',
    },
    {
      label: 'Guilds',
      value: status ? `${status.guildCount} / ${status.maxGuilds}` : '-',
      tone: 'neutral',
      caption: '接続サーバー数',
      icon: 'hub',
    },
    {
      label: 'Uptime',
      value: status?.uptimeFormatted || '-',
      tone: 'neutral',
      caption: '連続稼働時間',
      icon: 'schedule',
    },
  ];

  const handleLoginClick = () => {
    window.location.href = '/api/auth/discord';
  };

  return (
    <div className={styles.page}>
      {/* Hero Section */}
      <section className={styles.heroSection}>
        <div className={styles.heroContainer}>
          <div className={styles.heroContent}>
            <span className={styles.eyebrow}>Discord Server Management</span>
            <h1 className={styles.heroTitle}>
              サーバー運用を、<br />ひとつのワークスペースで。
            </h1>
            <p className={styles.heroDescription}>
              散らかった設定画面ではなく、落ち着いた一枚のダッシュボードから権限・ロール・運用設定を統一的に扱います。
            </p>
            <div className={styles.heroCTA}>
              {user ? (
                <button className={styles.ctaPrimary} onClick={() => navigate('/profile')} type="button">
                  <span className="material-icons">dashboard</span>
                  ワークスペースへ進む
                </button>
              ) : (
                <button className={styles.ctaPrimary} onClick={handleLoginClick} type="button">
                  <span className="material-icons">login</span>
                  Discordでログイン
                </button>
              )}
            </div>
          </div>

          <div className={styles.heroVisual} />
        </div>
      </section>

      {/* Status Metrics */}
      <section className={styles.metricsSection}>
        <div className={styles.metricsLabel}>System Status</div>
        <div className={styles.metricsGrid}>
          {statusMetrics.map((metric) => (
            <div key={metric.label} className={`${styles.metricCard} ${styles[`metric${metric.tone}`]}`}>
              <span className={styles.metricIcon}>
                <span className="material-icons">{metric.icon}</span>
              </span>
              <div>
                <span className={styles.metricLabel}>{metric.label}</span>
                <strong className={styles.metricValue}>{metric.value}</strong>
                <p className={styles.metricCaption}>{metric.caption}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Main Content Wrapper */}
      <div className={styles.mainContent}>
        {/* Capabilities Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Capabilities</span>
              <h2 className={styles.sectionTitle}>主要機能を把握する</h2>
              <p className={styles.sectionDescription}>
                サーバー運用のための主要な4つの機能です。どれからはじめても大丈夫です。
              </p>
            </div>
          </div>
          <div className={styles.capabilityGrid}>
            {capabilities.map((cap) => (
              <article key={cap.title} className={styles.capabilityCard}>
                <div className={styles.capabilityIcon}>
                  <span className="material-icons">{cap.icon}</span>
                </div>
                <div className={styles.capabilityBody}>
                  <h3>{cap.title}</h3>
                  <p>{cap.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Workflow Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Getting Started</span>
              <h2 className={styles.sectionTitle}>最初のステップ</h2>
              <p className={styles.sectionDescription}>
                初回セットアップから日々の運用まで、3つのステップで進めます。
              </p>
            </div>
          </div>
          <div className={styles.workflowGrid}>
            {workflowSteps.map((step) => (
              <article key={step.number} className={styles.workflowCard}>
                <div className={styles.stepNumber}>{step.number}</div>
                <div className={styles.stepContent}>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Quick Actions Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Quick Access</span>
              <h2 className={styles.sectionTitle}>よく使う機能へ</h2>
              <p className={styles.sectionDescription}>
                日常的に利用する3つの主要機能へ、ワンクリックで移動できます。
              </p>
            </div>
          </div>
          <div className={styles.actionGrid}>
            {quickActions.map((action) => (
              <button
                key={action.path}
                className={styles.actionCard}
                onClick={() => navigate(action.path)}
                type="button"
              >
                <div className={styles.actionIcon}>
                  <span className="material-icons">{action.icon}</span>
                </div>
                <div className={styles.actionBody}>
                  <strong className={styles.actionTitle}>{action.title}</strong>
                  <p className={styles.actionDescription}>{action.description}</p>
                </div>
                <span className={`material-icons ${styles.actionArrow}`}>arrow_forward</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default HomePage;
