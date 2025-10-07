import React from 'react';
import styles from './NotFoundPage.module.css';

const NotFoundPage: React.FC = () => {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>404</h1>
        <p className={styles.message}>ページが見つかりません</p>
        <p className={styles.description}>
          このページは存在しないか、アクセス権限がありません。
        </p>
      </div>
    </div>
  );
};

export default NotFoundPage;
