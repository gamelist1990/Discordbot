import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchStaffCommands, type StaffCommandData } from '../../services/api';
import styles from './StaffHelpPage.module.css';

type TabType = 'help' | 'services';

const services = [
  {
    title: 'AntiCheat',
    description: '不正検知ルールと自動処罰の設定面へ移動します。',
    path: '/staff/anticheat',
    icon: 'shield',
  },
  {
    title: 'プライベートチャット',
    description: 'ユーザーとの個別対応を安全に管理します。',
    path: '/staff/privatechat',
    icon: 'forum',
  },
  {
    title: 'ロール管理',
    description: 'ロールプリセットと変更ログを整理します。',
    path: '/staff/rolemanager',
    icon: 'style',
  },
  {
    title: 'ランキング管理',
    description: 'XP とパネル運用の設定に進みます。',
    path: '/staff/rankmanager',
    icon: 'leaderboard',
  },
];

const StaffHelpPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('help');
  const [commandData, setCommandData] = useState<StaffCommandData | null>(null);
  const [expandedCommand, setExpandedCommand] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchStaffCommands();
        setCommandData(data);
      } catch (loadError) {
        console.error('Failed to load staff commands:', loadError);
        setError(loadError instanceof Error ? loadError.message : '読み込みに失敗しました');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const filteredCommands = useMemo(() => {
    if (!commandData) {
      return [];
    }

    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) {
      return commandData.subcommands;
    }

    return commandData.subcommands.filter((command) => {
      const searchable = [
        command.name,
        command.description,
        ...command.options.map((option) => `${option.name} ${option.description} ${option.type}`),
      ]
        .join(' ')
        .toLowerCase();

      return searchable.includes(keyword);
    });
  }, [commandData, searchQuery]);

  const getOptionIcon = (type: string) => {
    const icons: Record<string, string> = {
      STRING: 'title',
      INTEGER: 'pin',
      BOOLEAN: 'toggle_on',
      USER: 'person',
      CHANNEL: 'tag',
      ROLE: 'shield',
      MENTIONABLE: 'alternate_email',
      NUMBER: 'calculate',
    };

    return icons[type] || 'extension';
  };

  const renderBody = () => {
    if (loading) {
      return <div className={styles.statePanel}>スタッフ機能を読み込んでいます...</div>;
    }

    if (error || !commandData) {
      return <div className={styles.statePanel}>{error || 'データの取得に失敗しました'}</div>;
    }

    if (activeTab === 'services') {
      return (
        <div className={styles.servicesGrid}>
          {services.map((service) => (
            <button
              key={service.path}
              className={styles.serviceCard}
              onClick={() => navigate(service.path)}
              type="button"
            >
              <span className={styles.serviceIcon}>
                <span className="material-icons">{service.icon}</span>
              </span>
              <div>
                <h3>{service.title}</h3>
                <p>{service.description}</p>
              </div>
              <span className="material-icons">arrow_forward</span>
            </button>
          ))}
        </div>
      );
    }

    return (
      <>
        <div className={styles.searchBox}>
          <span className="material-icons">search</span>
          <input
            className={styles.searchInput}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="コマンド名・説明・オプションを検索"
          />
        </div>

        <div className={styles.commandList}>
          {filteredCommands.length === 0 ? (
            <div className={styles.statePanel}>該当するコマンドがありません。</div>
          ) : (
            filteredCommands.map((command) => {
              const isOpen = expandedCommand === command.name;
              return (
                <article key={command.name} className={styles.commandCard}>
                  <button
                    className={styles.commandHeader}
                    onClick={() => setExpandedCommand(isOpen ? null : command.name)}
                    type="button"
                    aria-expanded={isOpen}
                  >
                    <div>
                      <span className={styles.commandName}>/staff {command.name}</span>
                      <p>{command.description}</p>
                    </div>
                    <span className="material-icons">{isOpen ? 'remove' : 'add'}</span>
                  </button>

                  {isOpen ? (
                    <div className={styles.commandBody}>
                      {command.options.length > 0 ? (
                        <div className={styles.optionList}>
                          {command.options.map((option) => (
                            <div key={option.name} className={styles.optionCard}>
                              <div className={styles.optionHeader}>
                                <span className={styles.optionIcon}>
                                  <span className="material-icons">{getOptionIcon(option.type)}</span>
                                </span>
                                <div>
                                  <strong>{option.name}</strong>
                                  <span className={styles.optionType}>{option.type}</span>
                                </div>
                                {option.required ? (
                                  <span className={styles.requiredBadge}>必須</span>
                                ) : null}
                              </div>
                              <p>{option.description}</p>
                              {option.choices.length > 0 ? (
                                <div className={styles.choiceList}>
                                  {option.choices.map((choice) => (
                                    <span key={String(choice.value)} className={styles.choiceBadge}>
                                      {choice.name}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.commandNote}>追加オプションはありません。</p>
                      )}

                      <div className={styles.usageBox}>
                        <span className={styles.usageLabel}>Usage</span>
                        <code>
                          /staff {command.name}
                          {command.options
                            .filter((option) => option.required)
                            .map((option) => ` ${option.name}:<値>`)
                            .join('')}
                        </code>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </>
    );
  };

  return (
    <div className={styles.page}>
      <section className={styles.pageHeader}>
        <div className={styles.pageHeaderCopy}>
          <span className={styles.pageEyebrow}>Staff Surface</span>
          <h1>スタッフ運用</h1>
          <p>スタッフ向けコマンドの参照と、運用サービスへの導線をひとつの画面にまとめています。</p>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Commands</span>
            <strong>{commandData?.subcommands.length || 0}</strong>
            <p>利用できるスタッフ向けサブコマンド数です。</p>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Services</span>
            <strong>{services.length}</strong>
            <p>整理済みの主要スタッフサービスに直接移動できます。</p>
          </div>
        </div>
      </section>

      <div>
        <div className={styles.tabBar}>
          <button
            className={`${styles.tabButton} ${activeTab === 'help' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('help')}
            type="button"
          >
            <span className="material-icons">menu_book</span>
            コマンド
          </button>
          <button
            className={`${styles.tabButton} ${activeTab === 'services' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('services')}
            type="button"
          >
            <span className="material-icons">apps</span>
            サービス
          </button>
        </div>

        {renderBody()}
      </div>
    </div>
  );
};

export default StaffHelpPage;
