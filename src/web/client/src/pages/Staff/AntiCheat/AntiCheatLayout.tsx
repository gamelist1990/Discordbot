import React, { ReactNode } from 'react';
import styles from './AntiCheatLayout.module.css';

interface Props {
  guildInfo?: any;
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: ReactNode;
}

const AntiCheatLayout: React.FC<Props> = ({ children }) => {
  return (
    <div className={styles.layout}>
      <div className={styles.content}>{children}</div>
    </div>
  );
};

export default AntiCheatLayout;
