import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { validateToken, fetchStaffCommands, type StaffCommandData } from '../../services/api';
import AppHeader from '../../components/Common/AppHeader';
import styles from './StaffHelpPage.module.css';

interface UserSession {
    userId: string;
    username: string;
    avatar?: string | null;
}

type TabType = 'help' | 'services';

const StaffHelpPage: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    
    const [user, setUser] = useState<UserSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>('help');
    const [commandData, setCommandData] = useState<StaffCommandData | null>(null);

    // トークン検証とデータ読み込み
    useEffect(() => {
        if (!token) {
            setError('トークンが指定されていません');
            setLoading(false);
            return;
        }

        const loadData = async () => {
            try {
                // トークン検証
                await validateToken(token);

                // スタッフコマンドデータ取得
                const data = await fetchStaffCommands(token);
                setCommandData(data);
                setLoading(false);
            } catch (err) {
                console.error('データ読み込みエラー:', err);
                setError(err instanceof Error ? err.message : '不明なエラー');
                setLoading(false);
            }
        };

        loadData();
    }, [token]);

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
                <AppHeader user={user} />
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
                <AppHeader user={user} />
                <div className={styles.error}>
                    <h2>エラー</h2>
                    <p>{error || 'データの取得に失敗しました'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <AppHeader user={user} />
            
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
                                        <div className={styles.serviceIcon}>🔧</div>
                                        <h3 className={styles.serviceTitle}>プライベートチャット</h3>
                                        <p className={styles.serviceDescription}>
                                            ユーザーとのプライベートチャンネルを管理
                                        </p>
                                        <button
                                            className={styles.serviceButton}
                                            onClick={() => navigate(`/staff/privatechat/${token}`)}
                                        >
                                            開く
                                        </button>
                                    </div>

                                    <div className={styles.serviceCard}>
                                        <div className={styles.servicePlaceholder}>
                                            <div className={styles.placeholderIcon}>➕</div>
                                            <p className={styles.placeholderText}>
                                                今後のサービスがここに表示されます
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </main>
                </div>
            </div>
        </div>
    );
};

export default StaffHelpPage;
