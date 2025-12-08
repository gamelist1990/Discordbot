import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBotStatus } from '../../services/api';
import type { BotStatusResponse } from '../../types';
import styles from './HomePage.module.css';

interface UserSession {
    userId: string;
    username: string;
    avatar?: string | null;
}

const Hero: React.FC<{
    user: UserSession | null;
    onLogin: () => void;
    onProfile: () => void;
    onSettings: () => void;
}> = ({ user, onLogin, onProfile, onSettings }) => (
    <section className={styles.hero}>
        <div className={styles.heroContainer}>
            <div className={styles.heroMain}>
                <h1 className={styles.heroTitle}>PEXServer</h1>
                <p className={styles.heroSubtitle}>シンプルで強力なDiscordサーバー管理</p>
            </div>

            <div className={styles.heroButtons}>
                {user ? (
                    <button className={styles.btnPrimary} onClick={onProfile}>
                        <span className="material-icons">person</span>
                        ダッシュボード
                    </button>
                ) : (
                    <button className={styles.btnPrimary} onClick={onLogin}>
                        <span className="material-icons">login</span>
                        Discordでログイン
                    </button>
                )}
                <button className={styles.btnSecondary} onClick={onSettings}>
                    <span className="material-icons">settings</span>
                    設定
                </button>
            </div>
        </div>
    </section>
);

const StatusPanel: React.FC<{ status: BotStatusResponse | null }> = ({ status }) => {
    if (!status) return null;

    return (
        <section className={styles.statusSection}>
            <div className={styles.statusCards}>
                <div className={styles.statusCard}>
                    <div className={`${styles.statusIcon} ${styles.iconStatus}`}>
                        <span className="material-icons">power_settings_new</span>
                    </div>
                    <div className={styles.statusCardContent}>
                        <div className={styles.statusCardLabel}>ステータス</div>
                        <div className={styles.statusCardValue}>
                            <span className={`${styles.indicator} ${status.ready ? styles.online : styles.offline}`}></span>
                            {status.ready ? 'オンライン' : 'オフライン'}
                        </div>
                    </div>
                </div>

                <div className={styles.statusCard}>
                    <div className={`${styles.statusIcon} ${styles.iconUptime}`}>
                        <span className="material-icons">schedule</span>
                    </div>
                    <div className={styles.statusCardContent}>
                        <div className={styles.statusCardLabel}>稼働時間</div>
                        <div className={styles.statusCardValue}>{status.uptimeFormatted}</div>
                    </div>
                </div>

                <div className={styles.statusCard}>
                    <div className={`${styles.statusIcon} ${styles.iconGuilds}`}>
                        <span className="material-icons">dns</span>
                    </div>
                    <div className={styles.statusCardContent}>
                        <div className={styles.statusCardLabel}>サーバー数</div>
                        <div className={styles.statusCardValue}>
                            {status.guildCount} / {status.maxGuilds}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

const FeatureGrid: React.FC = () => {
    const features = [
        { icon: 'security', title: '権限管理', desc: '詳細な権限設定でサーバーを安全に' },
        { icon: 'analytics', title: '統計分析', desc: 'サーバーの活動を可視化' },
        { icon: 'gavel', title: 'モデレーション', desc: '強力な管理ツール' },
        { icon: 'task_alt', title: 'タスク管理', desc: 'プロジェクト進捗の共有' },
    ];

    return (
        <section className={styles.featuresSection}>
            <h2 className={styles.sectionTitle}>機能</h2>
            <div className={styles.featureGrid}>
                {features.map((feature) => (
                    <div key={feature.title} className={styles.featureItem}>
                        <div className={styles.featureIcon}>
                            <span className="material-icons">{feature.icon}</span>
                        </div>
                        <h3 className={styles.featureTitle}>{feature.title}</h3>
                        <p className={styles.featureDesc}>{feature.desc}</p>
                    </div>
                ))}
            </div>
        </section>
    );
};

const GetStarted: React.FC = () => {
    const steps = [
        { num: '1', title: 'Botを招待', desc: 'サーバーにBotを追加' },
        { num: '2', title: '初期設定', desc: 'コマンドで設定を開始' },
        { num: '3', title: '運用開始', desc: '強力な機能を活用' },
    ];

    return (
        <section className={styles.getStartedSection}>
            <h2 className={styles.sectionTitle}>始める</h2>
            <div className={styles.stepsGrid}>
                {steps.map((step, idx) => (
                    <div key={step.num} className={styles.stepCard}>
                        <div className={styles.stepNumber}>{step.num}</div>
                        <h3 className={styles.stepTitle}>{step.title}</h3>
                        <p className={styles.stepDesc}>{step.desc}</p>
                        {idx < steps.length - 1 && <div className={styles.stepArrow}>→</div>}
                    </div>
                ))}
            </div>
        </section>
    );
};

const HomePage: React.FC = () => {
    const navigate = useNavigate();
    const [user, setUser] = useState<UserSession | null>(null);
    const [status, setStatus] = useState<BotStatusResponse | null>(null);
    const [loading, setLoading] = useState(true);

    const checkAuth = useCallback(async () => {
        try {
            const response = await fetch('/api/auth/session', { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                setUser(data.user ?? null);
            }
        } catch (err) {
            console.error('Auth check failed:', err);
        }
    }, []);

    const loadStatus = useCallback(async () => {
        try {
            const data = await fetchBotStatus();
            setStatus(data);
        } catch (err) {
            console.error('Failed to load status:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        checkAuth();
        loadStatus();
    }, [checkAuth, loadStatus]);

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <main className={styles.main}>
                <Hero
                    user={user}
                    onLogin={() => (window.location.href = '/api/auth/discord')}
                    onProfile={() => navigate('/profile')}
                    onSettings={() => navigate('/settings')}
                />

                <StatusPanel status={status} />

                <FeatureGrid />

                <GetStarted />
            </main>

            <footer className={styles.footer}>
                <p>&copy; 2024 Discord Bot System. All rights reserved.</p>
            </footer>
        </div>
    );
};

export default HomePage;
