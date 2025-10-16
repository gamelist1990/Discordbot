import React from 'react';
import type { GuildInfo } from '../../types';
import styles from './Sidebar.module.css';

interface SidebarProps {
  guildInfo?: GuildInfo;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: 'permissions', label: '権限設定', icon: '🔐' },
  { id: 'general', label: '一般設定', icon: '⚙️' },
  { id: 'moderation', label: 'モデレーション', icon: '🛡️' },
];

const Sidebar: React.FC<SidebarProps> = ({ guildInfo, activeTab, onTabChange }) => {
  return (
    <aside className={styles.sidebar}>
      {guildInfo && (
        <div className={styles.guildHeader}>
          <h3>{guildInfo.name}</h3>
        </div>
      )}
      <nav className={styles.nav}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            <span className={styles.icon}>{tab.icon}</span>
            <span className={styles.label}>{tab.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;
