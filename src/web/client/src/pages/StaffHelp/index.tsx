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

const StaffHelpPage: React.FC = () => {
    // no token-based access any more; use session-based APIs
    const navigate = useNavigate();

    const [, setUser] = useState<UserSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>('help');
    const [commandData, setCommandData] = useState<StaffCommandData | null>(null);
    const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

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
        if (activeTab === 'help' && pendingAnchor) {
            // allow DOM to update
            requestAnimationFrame(() => {
                const el = document.getElementById(pendingAnchor!);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    // update the hash so copying the URL preserves location
                    try {
                        history.replaceState(undefined, '', `#${pendingAnchor}`);
                    } catch (e) {
                        // ignore
                    }
                }
                setPendingAnchor(null);
            });
        }
    }, [activeTab, pendingAnchor]);

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
                    <h1 className={styles.title}>
                        <span className={styles.titleIcon}>🛠️</span>
                        スタッフ管理ページ
                    </h1>
                    <p className={styles.subtitle}>
                        サーバー管理者向けのコマンドとサービス
                    </p>
                </header>

                {/* タブナビゲーション */}
                <div className={styles.tabContainer}>
                    <div className={styles.tabs}>
                        <button
                            className={`${styles.tab} ${activeTab === 'help' ? styles.tabActive : ''}`}
                            onClick={() => setActiveTab('help')}
                        >
                            <span className={styles.tabIcon}>📚</span>
                            コマンドヘルプ
                        </button>
                        <button
                            className={`${styles.tab} ${activeTab === 'services' ? styles.tabActive : ''}`}
                            onClick={() => setActiveTab('services')}
                        >
                            <span className={styles.tabIcon}>⚙️</span>
                            サービス
                        </button>
                    </div>
                    <div className={styles.tabIndicator} style={{
                        transform: `translateX(${activeTab === 'help' ? '0' : '100'}%)`
                    }} />
                </div>

                {/* コンテンツエリア */}
                <div className={styles.content}>
                    {/* サイドバー */}
                    <aside className={styles.sidebar}>
                        <div className={styles.sidebarSection}>
                            <h3 className={styles.sidebarTitle}>クイックリンク</h3>
                            <nav className={styles.sidebarNav}>
                                    {commandData.subcommands.map((cmd) => (
                                        <a
                                            key={cmd.name}
                                            href={`#cmd-${cmd.name}`}
                                            className={styles.sidebarLink}
                                            onClick={(e) => {
                                                // when clicked, ensure we switch to help tab and scroll to command
                                                e.preventDefault();
                                                // set pending anchor, switch to help
                                                setPendingAnchor(`cmd-${cmd.name}`);
                                                setActiveTab('help');
                                            }}
                                        >
                                            {cmd.name}
                                        </a>
                                    ))}
                                </nav>
                        </div>
                    </aside>

                    {/* メインコンテンツ */}
                    <main className={styles.main}>
                        {activeTab === 'help' && (
                            <div className={styles.helpContent}>
                                <div className={styles.infoCard}>
                                    <p className={styles.infoText}>
                                        💡 これらのコマンドは「サーバー管理」権限を持つユーザーのみ使用できます
                                    </p>
                                </div>

                                {/* コマンドカード */}
                                <div className={styles.commandGrid}>
                                    {commandData.subcommands.map((cmd) => (
                                        <div
                                            key={cmd.name}
                                            id={`cmd-${cmd.name}`}
                                            className={styles.commandCard}
                                        >
                                            <div className={styles.cardHeader}>
                                                <h2 className={styles.commandName}>
                                                    <span className={styles.commandSlash}>/staff</span>
                                                    {' '}
                                                    <span className={styles.commandSubname}>{cmd.name}</span>
                                                </h2>
                                            </div>
                                            
                                            <div className={styles.cardBody}>
                                                <p className={styles.commandDescription}>
                                                    {cmd.description}
                                                </p>

                                                {cmd.options.length > 0 && (
                                                    <div className={styles.optionsSection}>
                                                        <h3 className={styles.optionsTitle}>オプション</h3>
                                                        <div className={styles.optionsList}>
                                                            {cmd.options.map((opt) => (
                                                                <div key={opt.name} className={styles.option}>
                                                                    <div className={styles.optionHeader}>
                                                                        <span className={styles.optionIcon}>
                                                                            {getOptionTypeIcon(opt.type)}
                                                                        </span>
                                                                        <code className={styles.optionName}>
                                                                            {opt.name}
                                                                        </code>
                                                                        {opt.required && (
                                                                            <span className={styles.requiredBadge}>
                                                                                必須
                                                                            </span>
                                                                        )}
                                                                        <span className={styles.optionType}>
                                                                            {opt.type}
                                                                        </span>
                                                                    </div>
                                                                    <p className={styles.optionDescription}>
                                                                        {opt.description}
                                                                    </p>
                                                                    {opt.choices.length > 0 && (
                                                                        <div className={styles.choices}>
                                                                            <span className={styles.choicesLabel}>選択肢:</span>
                                                                            {opt.choices.map((choice) => (
                                                                                <code key={choice.value} className={styles.choice}>
                                                                                    {choice.name}
                                                                                </code>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                <div className={styles.usage}>
                                                    <span className={styles.usageLabel}>使用例:</span>
                                                    <code className={styles.usageCode}>
                                                        /staff {cmd.name}
                                                        {cmd.options.filter(o => o.required).map(o => ` ${o.name}:<値>`).join('')}
                                                    </code>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'services' && (
                            <div className={styles.servicesContent}>
                                <div className={styles.infoCard}>
                                    <p className={styles.infoText}>
                                        🚀 スタッフ専用サービスはここに追加されます
                                    </p>
                                </div>

                                <div className={styles.servicesGrid}>
                                    <div className={styles.serviceCard}>
                                        <div className={styles.serviceIcon}>🛡️</div>
                                        <h3 className={styles.serviceTitle}>AntiCheat 管理</h3>
                                        <p className={styles.serviceDescription}>
                                            サーバーの不正検知と自動処罰を管理します（信頼スコアベース）
                                        </p>
                                        <button
                                            className={styles.serviceButton}
                                            onClick={() => navigate('/staff/anticheat')}
                                        >
                                            開く
                                        </button>
                                    </div>
                                    <div className={styles.serviceCard}>
                                        <div className={styles.serviceIcon}>🔧</div>
                                        <h3 className={styles.serviceTitle}>プライベートチャット</h3>
                                        <p className={styles.serviceDescription}>
                                            ユーザーとのプライベートチャンネルを管理
                                        </p>
                                        <button
                                            className={styles.serviceButton}
                                            onClick={() => navigate('/staff/privatechat')}
                                        >
                                            開く
                                        </button>
                                    </div>

                                    <div className={styles.serviceCard}>
                                        <div className={styles.serviceIcon}>🎭</div>
                                        <h3 className={styles.serviceTitle}>ロール管理</h3>
                                        <p className={styles.serviceDescription}>
                                            サーバーのロールプリセットを管理
                                        </p>
                                        <button
                                            className={styles.serviceButton}
                                            onClick={() => navigate('/staff/rolemanager')}
                                        >
                                            開く
                                        </button>
                                    </div>
                                    
                                    <div className={styles.serviceCard}>
                                        <div className={styles.serviceIcon}>🏆</div>
                                        <h3 className={styles.serviceTitle}>ランキング管理</h3>
                                        <p className={styles.serviceDescription}>
                                            サーバーのランク／XP設定、リーダーボード、パネル管理を行います
                                        </p>
                                        <button
                                            className={styles.serviceButton}
                                            onClick={() => navigate('/staff/rankmanager')}
                                        >
                                            開く
                                        </button>
                                    </div>

                                    <div className={styles.serviceCard}>
                                        <div className={styles.serviceIcon}>⚡</div>
                                        <h3 className={styles.serviceTitle}>トリガー管理</h3>
                                        <p className={styles.serviceDescription}>
                                            自動応答トリガー、リアクション、DM送信などの自動化設定を管理
                                        </p>
                                        <button
                                            className={styles.serviceButton}
                                            onClick={() => navigate('/staff/triggermanager')}
                                        >
                                            開く
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </main>
                </div>
            </div>
            {/* Mobile bottom navigation and FAB (displayed via global CSS layout.css) */}
            <nav className="bottomNav" role="navigation" aria-label="モバイルナビ">
                <button className="bottomNavBtn" onClick={() => setActiveTab('help')} aria-label="コマンドヘルプ">
                    <span>📚</span>
                    <span>ヘルプ</span>
                </button>
                <button className="bottomNavBtn" onClick={() => setActiveTab('services')} aria-label="サービス">
                    <span>⚙️</span>
                    <span>サービス</span>
                </button>
                <button className="bottomNavBtn" onClick={() => navigate('/staff/privatechat')} aria-label="プライベートチャット">
                    <span>💬</span>
                    <span>チャット</span>
                </button>
                <button className="bottomNavBtn" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="トップへ">
                    <span>⬆️</span>
                    <span>トップ</span>
                </button>
            </nav>

            <button className="fab" aria-label="新規チャット作成" onClick={() => navigate('/staff/privatechat')}>＋</button>
        </div>
    );
};

export default StaffHelpPage;
