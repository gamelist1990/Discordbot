import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import styles from './AuthResultPage.module.css';

type Status = 'canceled' | 'expired' | 'invalid' | 'discord_error' | 'configuration' | 'failed';
type Tone = 'neutral' | 'warning' | 'danger';

type AuthResult = {
  tone: Tone;
  icon: string;
  eyebrow: string;
  title: string;
  description: string;
  nextTitle: string;
  nextDescription: string;
  retryLabel: string;
};

const explanations: Record<Status, AuthResult> = {
  canceled: {
    tone: 'neutral',
    icon: 'logout',
    eyebrow: 'DISCORD LOGIN · CANCELED',
    title: '認証をキャンセルしました',
    description: 'Discordでの認証がキャンセルされたため、ログインは完了していません。',
    nextTitle: '必要なときに再開できます',
    nextDescription: 'このまま公開ページを利用できます。ログインが必要な機能を使うときは、もう一度認証してください。',
    retryLabel: 'Discord認証を再開する',
  },
  expired: {
    tone: 'warning',
    icon: 'schedule',
    eyebrow: 'DISCORD LOGIN · EXPIRED',
    title: '認証の有効期限が切れました',
    description: '認証を開始してから時間が経過したため、このリンクは使えなくなりました。',
    nextTitle: '新しい認証を開始してください',
    nextDescription: '認証リンクは安全のため15分で期限切れになります。下のボタンからやり直せます。',
    retryLabel: '認証をやり直す',
  },
  invalid: {
    tone: 'warning',
    icon: 'link_off',
    eyebrow: 'DISCORD LOGIN · LINK INVALID',
    title: 'この認証リンクは利用できません',
    description: 'リンクが無効か、すでに使用されています。認証を完了できませんでした。',
    nextTitle: '最初に開いたブラウザで再試行',
    nextDescription: '認証を始めたブラウザと異なる環境でリンクを開くと、確認できないことがあります。',
    retryLabel: '新しいリンクを発行する',
  },
  discord_error: {
    tone: 'danger',
    icon: 'cloud_off',
    eyebrow: 'DISCORD LOGIN · SERVICE ERROR',
    title: 'Discordとの認証に失敗しました',
    description: 'Discordからエラーが返されたため、ログインは完了していません。',
    nextTitle: '少し時間を置いて再試行',
    nextDescription: 'Discord側で一時的な問題が起きている可能性があります。時間を置いてから認証をやり直してください。',
    retryLabel: 'もう一度認証する',
  },
  configuration: {
    tone: 'danger',
    icon: 'settings_alert',
    eyebrow: 'DISCORD LOGIN · SETUP ERROR',
    title: '現在、認証を開始できません',
    description: '認証に必要なサーバー設定に問題があり、ログインを完了できませんでした。',
    nextTitle: 'Bot管理者へお問い合わせください',
    nextDescription: '時間を置いても変わらない場合は、管理者による設定の確認が必要です。',
    retryLabel: '認証を再試行する',
  },
  failed: {
    tone: 'danger',
    icon: 'error_outline',
    eyebrow: 'DISCORD LOGIN · NOT COMPLETED',
    title: 'ログインを完了できませんでした',
    description: '認証の処理中に問題が発生しました。ログイン状態は変更されていません。',
    nextTitle: '時間を置いてもう一度お試しください',
    nextDescription: '同じ問題が続く場合は、Bot管理者へお問い合わせください。',
    retryLabel: '認証をやり直す',
  },
};

function safeLocalPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') ||
      /[\\\r\n]/.test(value) || value.length > 512) return '/';
  try { if (decodeURIComponent(value).startsWith('//')) return '/'; } catch { return '/'; }
  return value;
}

const AuthResultPage: React.FC = () => {
  const [params] = useSearchParams();
  const statusValue = params.get('status') || 'failed';
  const status: Status = Object.prototype.hasOwnProperty.call(explanations, statusValue)
    ? statusValue as Status
    : 'failed';
  const detail = explanations[status];
  const redirect = safeLocalPath(params.get('redirect'));
  const retry = `/api/auth/discord?redirect=${encodeURIComponent(redirect)}`;

  return (
    <section className={styles.page} data-tone={detail.tone} aria-labelledby="auth-result-title">
      <nav className={styles.breadcrumb} aria-label="現在の位置">
        <Link to="/">PEXServer</Link>
        <span className="material-icons" aria-hidden="true">chevron_right</span>
        <span>Discord認証</span>
      </nav>

      <div className={styles.layout}>
        <section className={styles.resultCard}>
          <div className={styles.statusLine}>
            <span className={styles.statusIcon} aria-hidden="true">
              <span className="material-icons">{detail.icon}</span>
            </span>
            <span className={styles.eyebrow}>{detail.eyebrow}</span>
          </div>

          <h1 id="auth-result-title">{detail.title}</h1>
          <p className={styles.description}>{detail.description}</p>

          <div className={styles.actions}>
            <a className={styles.primaryAction} href={retry}>
              <span className="material-icons" aria-hidden="true">login</span>
              {detail.retryLabel}
              <span className={`material-icons ${styles.actionEnd}`} aria-hidden="true">arrow_forward</span>
            </a>
            <Link className={styles.secondaryAction} to={redirect}>
              <span className="material-icons" aria-hidden="true">{redirect === '/' ? 'home' : 'arrow_back'}</span>
              {redirect === '/' ? 'ホームへ戻る' : '元のページへ戻る'}
            </Link>
          </div>

          <div className={styles.sessionNote}>
            <span className="material-icons" aria-hidden="true">lock_outline</span>
            <p>今回の認証は完了していません。ログイン状態は変更されていないため、必要に応じて再試行できます。</p>
          </div>
        </section>

        <aside className={styles.nextCard} aria-labelledby="auth-next-title">
          <span className={styles.nextLabel}>NEXT STEP</span>
          <div className={styles.nextIcon} aria-hidden="true">
            <span className="material-icons">east</span>
          </div>
          <h2 id="auth-next-title">{detail.nextTitle}</h2>
          <p>{detail.nextDescription}</p>
          <div className={styles.connection}>
            <span className={styles.connectionDot} aria-hidden="true" />
            <span>今回の認証</span>
            <span className={styles.connectionState}>未完了</span>
          </div>
        </aside>
      </div>
    </section>
  );
};

export default AuthResultPage;
