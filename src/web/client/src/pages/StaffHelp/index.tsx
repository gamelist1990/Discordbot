import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchStaffCommands, type StaffCommandData } from '../../services/api';
import styles from './StaffHelpPage.module.css';

interface UserSession {
    userId: string;
    username: string;
    avatar?: string | null;
}

type TabType = 'help' | 'services';

interface ExpandedCommands {
    [key: string]: boolean;
}

const StaffHelpPage: React.FC = () => {
    // no token-based access any more; use session-based APIs
    const navigate = useNavigate();

    const [, setUser] = useState<UserSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>('help');
    const [commandData, setCommandData] = useState<StaffCommandData | null>(null);
    const [expandedCommands, setExpandedCommands] = useState<ExpandedCommands>({});
    const [searchQuery, setSearchQuery] = useState('');

    // トークン検証とデータ読み込み
    useEffect(() => {
        const loadData = async () => {
            try {
                // セッションベース: /api/staff/commands を使用
                const data = await fetchStaffCommands();
                setCommandData(data);
                setLoading(false);
            } catch (err) {
                console.error('データ読み込みエラー:', err);
                setError(err instanceof Error ? err.message : '不明なエラー');
                setLoading(false);
            }
        };

        loadData();
    }, []);

    // ユーザーセッション確認
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const response = await fetch('/api/auth/session', {
                    credentials: 'include'
                });

                if (response.ok) {
                    const data = await response.json();
                    setUser(data.user);
                }
            } catch (err) {
                console.error('認証チェック失敗:', err);
            }
        };

        checkAuth();
    }, []);

    // When activeTab becomes 'help' and there's a pending anchor, scroll to it
    useEffect(() => {
        if (activeTab === 'help') {
            // allow DOM to update
            requestAnimationFrame(() => {
                // Scroll to first expanded command or top of content
                const firstExpanded = Object.entries(expandedCommands).find(([, v]) => v);
                if (firstExpanded) {
                    const el = document.getElementById(`cmd-${firstExpanded[0]}`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
            });
        }
    }, [activeTab, expandedCommands]);

    const toggleCommandExpand = (cmdName: string) => {
        setExpandedCommands(prev => ({
            ...prev,
            [cmdName]: !prev[cmdName]
        }));
    };

    const filteredCommands = commandData?.subcommands.filter(cmd =>
        cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cmd.description.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

    const getOptionTypeIcon = (type: string): string => {
        const iconMap: Record<string, string> = {
            'STRING': '📝',
            'INTEGER': '🔢',
            'BOOLEAN': '✅',
            'USER': '👤',
            'CHANNEL': '#️⃣',
            'ROLE': '🎭',
            'MENTIONABLE': '@',
            'NUMBER': '🔢'
        };
        return iconMap[type] || '❓';
    };

    if (loading) {
        return (
            <div className={styles.page}>
                <div className={styles.loading}>
                    <div className={styles.spinner} />
                    <p>読み込み中...</p>
                </div>
            </div>
        );
    }

    if (error || !commandData) {
        return (
            <div className={styles.page}>
                <div className={styles.error}>
                    <h2>エラー</h2>
                    <p>{error || 'データの取得に失敗しました'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <div className={styles.container}>
                {/* ヘッダー */}
                <header className={styles.header}>
                    <div className={styles.headerTop}>
                        <h1 className={styles.title}>
                            <span className={styles.titleIcon}>🛠️</span>
                            <span>スタッフコマンド</span>
                        </h1>
                    </div>
                    <p className={styles.subtitle}>
                        サーバー管理者向けコマンド・サービスを一元管理
                    </p>
                </header>

                {/* タブナビゲーション（iOS スタイル） */}
                <div className={styles.tabContainer}>
                    <div className={styles.tabBar}>
                        <button
                            className={`${styles.tabBtn} ${activeTab === 'help' ? styles.tabActive : ''}`}
                            onClick={() => setActiveTab('help')}
                            aria-selected={activeTab === 'help'}
                            role="tab"
                        >
                            <span className={styles.tabIcon}>📚</span>
                            <span className={styles.tabLabel}>コマンド</span>
                        </button>
                        <button
                            className={`${styles.tabBtn} ${activeTab === 'services' ? styles.tabActive : ''}`}
                            onClick={() => setActiveTab('services')}
                            aria-selected={activeTab === 'services'}
                            role="tab"
                        >
                            <span className={styles.tabIcon}>⚙️</span>
                            <span className={styles.tabLabel}>サービス</span>
                        </button>
                    </div>
                    <div className={styles.tabUnderline} style={{
                        transform: `translateX(${activeTab === 'help' ? '0' : '100'}%)`
                    }} />
                </div>

                {/* コンテンツ */}
                <div className={styles.contentWrapper}>
                    {activeTab === 'help' && (
                        <div className={styles.helpSection}>
                            {/* 検索バー */}
                            <div className={styles.searchBox}>
                                <span className={styles.searchIcon}>🔍</span>
                                <input
                                    type="text"
                                    className={styles.searchInput}
                                    placeholder="コマンド名を検索..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    aria-label="コマンド検索"
                                />
                                {searchQuery && (
                                    <button
                                        className={styles.clearBtn}
                                        onClick={() => setSearchQuery('')}
                                        aria-label="検索をクリア"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            {/* 情報カード */}
                            <div className={styles.infoCard}>
                                <span className={styles.infoBadge}>💡</span>
                                <span className={styles.infoText}>
                                    これらのコマンドは「サーバー管理」権限を持つユーザーのみ利用できます
                                </span>
                            </div>

                            {/* コマンドリスト */}
                            <div className={styles.commandsList}>
                                {filteredCommands.length === 0 ? (
                                    <div className={styles.emptyState}>
                                        <div className={styles.emptyIcon}>🚀</div>
                                        <div className={styles.emptyText}>
                                            コマンドが見つかりません
                                        </div>
                                    </div>
                                ) : (
                                    filteredCommands.map((cmd) => (
                                        <div
                                            key={cmd.name}
                                            id={`cmd-${cmd.name}`}
                                            className={styles.accordionItem}
                                        >
                                            <button
                                                className={`${styles.accordionHeader} ${expandedCommands[cmd.name] ? styles.expanded : ''}`}
                                                onClick={() => toggleCommandExpand(cmd.name)}
                                                aria-expanded={expandedCommands[cmd.name]}
                                                aria-controls={`cmd-content-${cmd.name}`}
                                            >
                                                <span className={styles.accordionTitle}>
                                                    <span className={styles.commandPrefix}>/staff</span>
                                                    <span className={styles.commandName}>{cmd.name}</span>
                                                </span>
                                                <span className={styles.accordionIcon}>
                                                    {expandedCommands[cmd.name] ? '▼' : '▶'}
                                                </span>
                                            </button>

                                            {expandedCommands[cmd.name] && (
                                                <div
                                                    id={`cmd-content-${cmd.name}`}
                                                    className={styles.accordionContent}
                                                >
                                                    <div className={styles.accordionBody}>
                                                        <p className={styles.cmdDescription}>
                                                            {cmd.description}
                                                        </p>

                                                        {cmd.options.length > 0 && (
                                                            <div className={styles.optionsContainer}>
                                                                <div className={styles.optionsTitle}>
                                                                    📋 パラメータ
                                                                </div>
                                                                <div className={styles.optionsList}>
                                                                    {cmd.options.map((opt) => (
                                                                        <div key={opt.name} className={styles.optionItem}>
                                                                            <div className={styles.optionName}>
                                                                                <span className={styles.optionIcon}>
                                                                                    {getOptionTypeIcon(opt.type)}
                                                                                </span>
                                                                                <code className={styles.optionCode}>
                                                                                    {opt.name}
                                                                                </code>
                                                                                {opt.required && (
                                                                                    <span className={styles.requiredTag}>必須</span>
                                                                                )}
                                                                                <span className={styles.optionTypeTag}>
                                                                                    {opt.type}
                                                                                </span>
                                                                            </div>
                                                                            <p className={styles.optionDesc}>
                                                                                {opt.description}
                                                                            </p>
                                                                            {opt.choices.length > 0 && (
                                                                                <div className={styles.choicesList}>
                                                                                    <span className={styles.choicesLabel}>選択肢:</span>
                                                                                    {opt.choices.map((choice) => (
                                                                                        <span key={choice.value} className={styles.choiceBadge}>
                                                                                            {choice.name}
                                                                                        </span>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        <div className={styles.usageBox}>
                                                            <div className={styles.usageLabel}>💻 使用例</div>
                                                            <code className={styles.usageCode}>
                                                                /staff {cmd.name}
                                                                {cmd.options.filter(o => o.required).map(o => ` ${o.name}:<値>`).join('')}
                                                            </code>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'services' && (
                        <div className={styles.servicesSection}>
                            <div className={styles.infoCard}>
                                <span className={styles.infoBadge}>🚀</span>
                                <span className={styles.infoText}>
                                    スタッフ専用サービスで、サーバー管理をより効率的に
                                </span>
                            </div>

                            <div className={styles.servicesGrid}>
                                <div className={styles.serviceCard}>
                                    <div className={styles.serviceIcon}>🛡️</div>
                                    <h3 className={styles.serviceTitle}>AntiCheat</h3>
                                    <p className={styles.serviceDesc}>
                                        不正検知と自動処罰を管理
                                    </p>
                                    <button
                                        className={styles.serviceBtn}
                                        onClick={() => navigate('/staff/anticheat')}
                                    >
                                        開く
                                    </button>
                                </div>

                                <div className={styles.serviceCard}>
                                    <div className={styles.serviceIcon}>💬</div>
                                    <h3 className={styles.serviceTitle}>プライベートチャット</h3>
                                    <p className={styles.serviceDesc}>
                                        ユーザーとのプライベート会話を管理
                                    </p>
                                    <button
                                        className={styles.serviceBtn}
                                        onClick={() => navigate('/staff/privatechat')}
                                    >
                                        開く
                                    </button>
                                </div>

                                <div className={styles.serviceCard}>
                                    <div className={styles.serviceIcon}>🎭</div>
                                    <h3 className={styles.serviceTitle}>ロール管理</h3>
                                    <p className={styles.serviceDesc}>
                                        ロールプリセットを設定
                                    </p>
                                    <button
                                        className={styles.serviceBtn}
                                        onClick={() => navigate('/staff/rolemanager')}
                                    >
                                        開く
                                    </button>
                                </div>

                                <div className={styles.serviceCard}>
                                    <div className={styles.serviceIcon}>🏆</div>
                                    <h3 className={styles.serviceTitle}>ランキング</h3>
                                    <p className={styles.serviceDesc}>
                                        XP・ランクシステムを管理
                                    </p>
                                    <button
                                        className={styles.serviceBtn}
                                        onClick={() => navigate('/staff/rankmanager')}
                                    >
                                        開く
                                    </button>
                                </div>

                                <div className={styles.serviceCard}>
                                    <div className={styles.serviceIcon}>⚡</div>
                                    <h3 className={styles.serviceTitle}>トリガー</h3>
                                    <p className={styles.serviceDesc}>
                                        自動応答・自動化を設定
                                    </p>
                                    <button
                                        className={styles.serviceBtn}
                                        onClick={() => navigate('/staff/triggermanager')}
                                    >
                                        開く
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StaffHelpPage;
