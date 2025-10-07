import React, { useEffect, useState } from 'react';
import { fetchBotStatus } from '../../services/api';
import type { BotStatusResponse } from '../../types';
import styles from './DashboardPage.module.css';

const DashboardPage: React.FC = () => {
  const [status, setStatus] = useState<BotStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const data = await fetchBotStatus();
        setStatus(data);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ステータスの取得に失敗しました');
        setLoading(false);
      }
    };

    loadStatus();

    // 10秒ごとに更新
    const interval = setInterval(loadStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>読み込み中...</p>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className={styles.error}>
        <h2>エラー</h2>
        <p>{error || 'ステータスの取得に失敗しました'}</p>
      </div>
    );
  }

  const startDate = new Date(status.startTime);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>🤖 Discord Bot ダッシュボード</h1>
        <div className={styles.statusBadge}>
          <span className={`${styles.indicator} ${status.ready ? styles.online : styles.offline}`} />
          {status.ready ? 'オンライン' : 'オフライン'}
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardIcon}>⏱️</div>
          <div className={styles.cardContent}>
            <h3 className={styles.cardTitle}>稼働時間</h3>
            <p className={styles.cardValue}>{status.uptimeFormatted}</p>
            <p className={styles.cardSubtext}>
              起動日時: {startDate.toLocaleString('ja-JP')}
            </p>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardIcon}>🏢</div>
          <div className={styles.cardContent}>
            <h3 className={styles.cardTitle}>サーバー数</h3>
            <p className={styles.cardValue}>
              {status.guildCount} / {status.maxGuilds}
            </p>
            <p className={styles.cardSubtext}>
              残り: {status.maxGuilds - status.guildCount} サーバー
            </p>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardIcon}>📦</div>
          <div className={styles.cardContent}>
            <h3 className={styles.cardTitle}>バージョン</h3>
            <p className={styles.cardValue}>{status.version}</p>
            <p className={styles.cardSubtext}>
              最終更新: {new Date(status.lastUpdate).toLocaleTimeString('ja-JP')}
            </p>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardIcon}>🔧</div>
          <div className={styles.cardContent}>
            <h3 className={styles.cardTitle}>設定</h3>
            <p className={styles.cardDescription}>
              Discord サーバーで <code>/settings</code> コマンドを実行して設定画面にアクセスできます。
            </p>
          </div>
        </div>
      </div>

      <div className={styles.infoSection}>
        <h2 className={styles.sectionTitle}>使い方</h2>
        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={styles.stepNumber}>1</div>
            <div className={styles.stepContent}>
              <h3>Bot を Discord サーバーに招待</h3>
              <p>管理者権限で Bot をサーバーに追加してください。</p>
            </div>
          </div>

          <div className={styles.step}>
            <div className={styles.stepNumber}>2</div>
            <div className={styles.stepContent}>
              <h3>/settings コマンドを実行</h3>
              <p>管理者権限を持つユーザーがコマンドを実行すると、設定用の一時 URL が生成されます。</p>
            </div>
          </div>

          <div className={styles.step}>
            <div className={styles.stepNumber}>3</div>
            <div className={styles.stepContent}>
              <h3>設定画面で権限を設定</h3>
              <p>生成された URL から、スタッフロールや管理者ロールを設定できます。</p>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <button
          onClick={() => {
            try {
              if (window.web && typeof window.web.notify === 'function') {
                window.web.notify('これはテスト通知です。右上からスライドして表示されます。', 'success', 'テスト通知');
              } else {
                // eslint-disable-next-line no-console
                console.warn('window.web.notify is not available');
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('notify failed', e);
            }
          }}
        >
          通知をテスト
        </button>
      </div>
    </div>
  );
};

export default DashboardPage;
