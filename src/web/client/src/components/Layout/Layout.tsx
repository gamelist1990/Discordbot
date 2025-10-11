import React, { ReactNode } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import type { GuildInfo } from '../../types';
import styles from './Layout.module.css';

interface LayoutProps {
  guildInfo: GuildInfo;
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ guildInfo, activeTab, onTabChange, children }) => {
  return (
    <div className={styles.layout}>
      <Header guildInfo={guildInfo} />
      <div className={styles.main}>
        <Sidebar activeTab={activeTab} onTabChange={onTabChange} />
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default Layout;
