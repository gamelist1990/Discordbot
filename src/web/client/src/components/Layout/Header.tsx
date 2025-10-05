import React from 'react';
import type { GuildInfo } from '../../types';
import styles from './Header.module.css';

interface HeaderProps {
  guildInfo: GuildInfo;
}

const Header: React.FC<HeaderProps> = ({ guildInfo }) => {
  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <div className={styles.guildInfo}>
          {guildInfo.iconURL && (
            <img
              src={guildInfo.iconURL}
              alt={guildInfo.name}
              className={styles.icon}
            />
          )}
          <div className={styles.textInfo}>
            <h1 className={styles.title}>{guildInfo.name}</h1>
            <p className={styles.subtitle}>サーバー設定</p>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
