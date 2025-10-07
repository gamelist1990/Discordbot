import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../../components/Common/AppHeader';
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
                <p>読み込み中...</p>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <AppHeader user={user} />
            
            <main className={styles.main}>
                {/* Hero Section */}
                <section className={styles.hero}>
                    <div className={styles.heroContent}>
                        <h1 className={styles.heroTitle}>Discord Bot 管理システム</h1>
                        <p className={styles.heroDescription}>
                            強力な管理機能を備えたDiscord Botで、サーバーの運営をより効率的に
                        </p>
                        <div className={styles.heroActions}>
                            {user ? (
                                <button className={styles.primaryBtn} onClick={() => navigate('/profile')}>
                                    <span className="material-icons">person</span>
                                    プロフィールを見る
                                </button>
                            ) : (
                                <button 
                                    className={styles.primaryBtn} 
                                    onClick={() => window.location.href = '/api/auth/discord'}
                                >
                                    <span className="material-icons">login</span>
                                    Discord でログイン
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
                        <h2 className={styles.sectionTitle}>Bot ステータス</h2>
                        <div className={styles.cardsGrid}>
                            <div className={styles.card}>
                                <div className={styles.cardIcon} style={{ background: '#E8F0FE' }}>
                                    <span className="material-icons" style={{ color: '#4285F4' }}>power_settings_new</span>
                                </div>
                                <div className={styles.cardContent}>
                                    <h3 className={styles.cardTitle}>ステータス</h3>
                                    <p className={styles.cardValue}>
                                        <span className={`${styles.statusDot} ${status.ready ? styles.online : styles.offline}`}></span>
                                        {status.ready ? 'オンライン' : 'オフライン'}
                                    </p>
                                </div>
                            </div>

                            <div className={styles.card}>
                                <div className={styles.cardIcon} style={{ background: '#E6F4EA' }}>
                                    <span className="material-icons" style={{ color: '#34A853' }}>schedule</span>
                                </div>
                                <div className={styles.cardContent}>
                                    <h3 className={styles.cardTitle}>稼働時間</h3>
                                    <p className={styles.cardValue}>{status.uptimeFormatted}</p>
                                </div>
                            </div>

                            <div className={styles.card}>
                                <div className={styles.cardIcon} style={{ background: '#FEF7E0' }}>
                                    <span className="material-icons" style={{ color: '#F9AB00' }}>groups</span>
                                </div>
                                <div className={styles.cardContent}>
                                    <h3 className={styles.cardTitle}>サーバー数</h3>
                                    <p className={styles.cardValue}>{status.guildCount} / {status.maxGuilds}</p>
                                </div>
                            </div>

                            <div className={styles.card}>
                                <div className={styles.cardIcon} style={{ background: '#FCE8E6' }}>
                                    <span className="material-icons" style={{ color: '#EA4335' }}>code</span>
                                </div>
                                <div className={styles.cardContent}>
                                    <h3 className={styles.cardTitle}>バージョン</h3>
                                    <p className={styles.cardValue}>{status.version}</p>
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                {/* Features Section */}
                <section className={styles.featuresSection}>
                    <h2 className={styles.sectionTitle}>主な機能</h2>
                    <div className={styles.featuresGrid}>
                        <div className={styles.featureCard}>
                            <div className={styles.featureIcon}>
                                <span className="material-icons">security</span>
                            </div>
                            <h3>権限管理</h3>
                            <p>きめ細かな権限設定で、サーバーの安全性を確保</p>
                        </div>

                        <div className={styles.featureCard}>
                            <div className={styles.featureIcon}>
                                <span className="material-icons">analytics</span>
                            </div>
                            <h3>統計情報</h3>
                            <p>サーバーの活動状況をリアルタイムで把握</p>
                        </div>

                        <div className={styles.featureCard}>
                            <div className={styles.featureIcon}>
                                <span className="material-icons">support_agent</span>
                            </div>
                            <h3>モデレーション</h3>
                            <p>効率的なモデレーション機能でサーバーを健全に保つ</p>
                        </div>

                        <div className={styles.featureCard}>
                            <div className={styles.featureIcon}>
                                <span className="material-icons">task_alt</span>
                            </div>
                            <h3>Todo管理</h3>
                            <p>プロジェクト管理とタスク共有を簡単に</p>
                        </div>

                        <div className={styles.featureCard}>
                            <div className={styles.featureIcon}>
                                <span className="material-icons">games</span>
                            </div>
                            <h3>ゲーム機能</h3>
                            <p>おみくじ、オセロ、○×ゲームなど楽しい機能</p>
                        </div>

                        <div className={styles.featureCard}>
                            <div className={styles.featureIcon}>
                                <span className="material-icons">extension</span>
                            </div>
                            <h3>拡張性</h3>
                            <p>プラグインシステムで機能を簡単に追加</p>
                        </div>
                    </div>
                </section>

                {/* Getting Started Section */}
                <section className={styles.gettingStarted}>
                    <h2 className={styles.sectionTitle}>使い方</h2>
                    <div className={styles.steps}>
                        <div className={styles.step}>
                            <div className={styles.stepNumber}>1</div>
                            <div className={styles.stepContent}>
                                <h3>Botを招待</h3>
                                <p>管理者権限でBotをDiscordサーバーに追加</p>
                            </div>
                        </div>

                        <div className={styles.stepArrow}>
                            <span className="material-icons">arrow_forward</span>
                        </div>

                        <div className={styles.step}>
                            <div className={styles.stepNumber}>2</div>
                            <div className={styles.stepContent}>
                                <h3>設定コマンド</h3>
                                <p>/settings コマンドで設定画面にアクセス</p>
                            </div>
                        </div>

                        <div className={styles.stepArrow}>
                            <span className="material-icons">arrow_forward</span>
                        </div>

                        <div className={styles.step}>
                            <div className={styles.stepNumber}>3</div>
                            <div className={styles.stepContent}>
                                <h3>カスタマイズ</h3>
                                <p>権限やロールを設定して運用開始</p>
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            <footer className={styles.footer}>
                <p>&copy; 2024 Discord Bot. All rights reserved.</p>
            </footer>
        </div>
    );
};

export default HomePage;
