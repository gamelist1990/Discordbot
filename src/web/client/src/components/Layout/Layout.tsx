import React, { ReactNode } from 'react';
import Header from '../Common/AppHeader';
import Sidebar from './Sidebar';
// removed unused GuildInfo import
import styles from './Layout.module.css';

interface LayoutProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ activeTab, onTabChange, children }) => {
  return (
    <div className={styles.layout}>
  <Header />
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
