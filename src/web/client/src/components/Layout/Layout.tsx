import React, { ReactNode } from 'react';
import Sidebar from './Sidebar';
import type { GuildInfo } from '../../types';
import styles from './Layout.module.css';

interface LayoutProps {
  guildInfo?: GuildInfo;
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ guildInfo, activeTab, onTabChange, children }) => {
  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <Sidebar guildInfo={guildInfo} activeTab={activeTab} onTabChange={onTabChange} />
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default Layout;
