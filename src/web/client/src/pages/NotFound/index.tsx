import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/PageShell';
import styles from './NotFoundPage.module.css';

const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <PageShell
        eyebrow="Lost Route"
        title="見つからないページです"
        description="指定されたパスは存在しないか、整理によって移動されました。ホームか主要な管理面から入り直してください。"
        aside={
          <div className={styles.codePanel}>
            <span className={styles.codeLabel}>Status</span>
            <strong>404</strong>
            <p>URL が古い可能性もあります。必要な機能はホームから再度辿れます。</p>
          </div>
        }
        actions={
          <>
            <button className={styles.primaryButton} onClick={() => navigate('/')} type="button">
              <span className="material-icons">home</span>
              ホームへ戻る
            </button>
            <button className={styles.secondaryButton} onClick={() => navigate('/settings')} type="button">
              <span className="material-icons">tune</span>
              サーバー管理へ
            </button>
          </>
        }
        compact
      >
        <div className={styles.hintPanel}>
          <h2>できること</h2>
          <p>ホームから必要な管理画面へ入り直すか、ヘッダーのメニューから目的の面へ移動してください。</p>
        </div>
      </PageShell>
    </div>
  );
};

export default NotFoundPage;
