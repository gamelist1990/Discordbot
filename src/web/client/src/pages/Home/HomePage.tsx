import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBotStatus } from '../../services/api';
import type { BotStatusResponse } from '../../types';
import styles from './HomePage.module.css';

interface UserSession {
    userId: string;
    username: string;
    avatar?: string | null;
}

const HomePage: React.FC = () => {
    const navigate = useNavigate();
    const [user, setUser] = useState<UserSession | null>(null);
    const [status, setStatus] = useState<BotStatusResponse | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        checkAuth();
        loadStatus();
    }, []);

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
            console.error('Auth check failed:', err);
        }
    };

    const loadStatus = async () => {
        try {
            const data = await fetchBotStatus();
            setStatus(data);
        } catch (err) {
            console.error('Failed to load status:', err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <div className={styles.backgroundBlob}></div>
            <div className={styles.backgroundBlob2}></div>
            
            <main className={styles.main}>
                {/* Hero Section */}
                <section className={styles.hero}>
                    <div className={styles.heroContent}>
                        <div className={styles.heroBadge}>Premium Edition</div>
                        <h1 className={styles.heroTitle}>
                            PEX<span className={styles.heroTitleGradient}>Server</span>
                        </h1>
                        <p className={styles.heroDescription}>
                            次世代のDiscordサーバー管理ツール。<br />
                            直感的な操作と強力な機能で、あなたのコミュニティをサポートします。
                        </p>
                        <div className={styles.heroActions}>
                            {user ? (
                                <button className={styles.primaryBtn} onClick={() => navigate('/profile')}>
                                    <span className="material-icons">person</span>
                                    マイページへ
                                </button>
                            ) : (
                                <button 
                                    className={styles.primaryBtn} 
                                    onClick={() => window.location.href = '/api/auth/discord'}
                                >
                                    <span className="material-icons">login</span>
                                    Discordでログイン
                                </button>
                            )}
                            <button className={styles.secondaryBtn} onClick={() => navigate('/settings')}>
                                <span className="material-icons">settings</span>
                                設定
                            </button>
                        </div>
                    </div>
                </section>

                {/* Status Cards */}
                {status && (
                    <section className={styles.statusSection}>
                        <div className={styles.glassCard}>
                            <div className={styles.statusGrid}>
                                <div className={styles.statusItem}>
                                    <div className={`${styles.statusIcon} ${styles.iconBlue}`}>
                                        <span className="material-icons">power_settings_new</span>
                                    </div>
                                    <div className={styles.statusInfo}>
                                        <span className={styles.statusLabel}>System Status</span>
                                        <span className={styles.statusValue}>
                                            <span className={`${styles.statusDot} ${status.ready ? styles.online : styles.offline}`}></span>
                                            {status.ready ? 'Online' : 'Offline'}
                                        </span>
                                    </div>
                                </div>

                                <div className={styles.divider}></div>

                                <div className={styles.statusItem}>
                                    <div className={`${styles.statusIcon} ${styles.iconGreen}`}>
                                        <span className="material-icons">schedule</span>
                                    </div>
                                    <div className={styles.statusInfo}>
                                        <span className={styles.statusLabel}>Uptime</span>
                                        <span className={styles.statusValue}>{status.uptimeFormatted}</span>
                                    </div>
                                </div>

                                <div className={styles.divider}></div>

                                <div className={styles.statusItem}>
                                    <div className={`${styles.statusIcon} ${styles.iconOrange}`}>
                                        <span className="material-icons">dns</span>
                                    </div>
                                    <div className={styles.statusInfo}>
                                        <span className={styles.statusLabel}>Servers</span>
                                        <span className={styles.statusValue}>{status.guildCount} / {status.maxGuilds}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                {/* Features Grid */}
                <section className={styles.featuresSection}>
                    <h2 className={styles.sectionTitle}>Features</h2>
                    <div className={styles.featuresGrid}>
                        <div className={styles.featureCard}>
                            <div className={`${styles.featureIcon} ${styles.iconPurple}`}>
                                <span className="material-icons">security</span>
                            </div>
                            <h3>権限管理</h3>
                            <p>詳細な権限設定でサーバーを安全に保ちます。</p>
                        </div>

                        <div className={styles.featureCard}>
                            <div className={`${styles.featureIcon} ${styles.iconPink}`}>
                                <span className="material-icons">analytics</span>
                            </div>
                            <h3>統計分析</h3>
                            <p>サーバーの活動状況を可視化します。</p>
                        </div>

                        <div className={styles.featureCard}>
                            <div className={`${styles.featureIcon} ${styles.iconCyan}`}>
                                <span className="material-icons">support_agent</span>
                            </div>
                            <h3>サポート</h3>
                            <p>迅速なモデレーション機能を提供します。</p>
                        </div>

                        <div className={styles.featureCard}>
                            <div className={`${styles.featureIcon} ${styles.iconYellow}`}>
                                <span className="material-icons">task_alt</span>
                            </div>
                            <h3>タスク管理</h3>
                            <p>プロジェクトの進捗を管理・共有できます。</p>
                        </div>
                    </div>
                </section>

                {/* Getting Started */}
                <section className={styles.gettingStarted}>
                    <div className={styles.glassCardLarge}>
                        <h2 className={styles.sectionTitle}>How to Start</h2>
                        <div className={styles.stepsContainer}>
                            <div className={styles.stepItem}>
                                <div className={styles.stepNumber}>1</div>
                                <div className={styles.stepContent}>
                                    <h3>Invite Bot</h3>
                                    <p>Botをサーバーに招待</p>
                                </div>
                            </div>
                            <div className={styles.stepLine}></div>
                            <div className={styles.stepItem}>
                                <div className={styles.stepNumber}>2</div>
                                <div className={styles.stepContent}>
                                    <h3>Setup</h3>
                                    <p>コマンドで初期設定</p>
                                </div>
                            </div>
                            <div className={styles.stepLine}></div>
                            <div className={styles.stepItem}>
                                <div className={styles.stepNumber}>3</div>
                                <div className={styles.stepContent}>
                                    <h3>Enjoy</h3>
                                    <p>運用スタート！</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            <footer className={styles.footer}>
                <p>&copy; 2024 Discord Bot System. All rights reserved.</p>
            </footer>
        </div>
    );
};

export default HomePage;
