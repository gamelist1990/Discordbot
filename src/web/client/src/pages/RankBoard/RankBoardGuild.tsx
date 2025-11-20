import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styles from './RankBoard.module.css';

interface RankPanel {
    id: string;
    channelId: string;
    messageId: string;
    preset: string;
    lastUpdate: string;
    topCount?: number;
}

interface GuildInfo {
    id: string;
    name: string;
    icon?: string | null;
}

const RankBoardGuild: React.FC = () => {
    const { guildId } = useParams<{ guildId: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [guild, setGuild] = useState<GuildInfo | null>(null);
    const [panels, setPanels] = useState<RankPanel[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (guildId) {
            fetchGuildData();
        }
    }, [guildId]);

    const fetchGuildData = async () => {
        try {
            setLoading(true);
            setError(null);

            const res = await fetch(`/api/rank/guild/${guildId}`, { credentials: 'include' });
            if (!res.ok) {
                throw new Error('サーバー情報の取得に失敗しました');
            }

            const data = await res.json();
            setGuild(data.guild);

            // パネル一覧を取得
            const panelsRes = await fetch(`/api/rank/panels/${guildId}`, { credentials: 'include' });
            if (panelsRes.ok) {
                const panelsData = await panelsRes.json();
                setPanels(panelsData.panels || []);
            }

        } catch (err) {
            console.error('Failed to fetch guild data:', err);
            setError('サーバー情報の取得に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const getGuildIconUrl = (guildId: string, icon?: string | null) => {
        if (!icon) return '';
        if (/^https?:\/\//.test(icon)) return icon;
        return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png`;
    };

    const handlePanelClick = (panelId: string) => {
        navigate(`/rank/${guildId}/${panelId}`);
    };

    const formatDate = (dateString: string | undefined) => {
        if (!dateString) return '未取得';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return '未取得';
            return date.toLocaleString('ja-JP', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return '未取得';
        }
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.loading}>
                    <div className={styles.spinner}></div>
                    <p>サーバー情報を読み込み中...</p>
                </div>
            </div>
        );
    }

    if (error || !guild) {
        return (
            <div className={styles.container}>
                <div className={styles.error}>
                    <span className="material-icons">error</span>
                    <h2>エラー</h2>
                    <p>{error || 'サーバー情報が見つかりません'}</p>
                    <button
                        className={styles.backBtn}
                        onClick={() => navigate('/rank')}
                    >
                        戻る
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.hero}>
                <div className={styles.heroContent}>
                    {guild.icon && (
                        <img
                            src={getGuildIconUrl(guild.id, guild.icon)}
                            alt={guild.name}
                            className={styles.guildIcon}
                            style={{ width: 80, height: 80, margin: '0 auto 16px', display: 'block' }}
                        />
                    )}
                    <h1 className={styles.heroTitle}>{guild.name}</h1>
                    <p className={styles.heroSubtitle}>ランキングパネル一覧</p>
                    <div style={{ marginTop: '20px' }}>
                        <button
                            className={styles.backBtn}
                            onClick={() => navigate('/rank')}
                        >
                            <span className="material-icons">arrow_back</span>
                            戻る
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.mainContent}>
                <div className={styles.panelsList}>
                    {panels.length === 0 ? (
                        <div className={styles.empty}>
                            <span className="material-icons" style={{ fontSize: '48px', marginBottom: '16px' }}>leaderboard</span>
                            <p>このサーバーにはランキングパネルがありません</p>
                        </div>
                    ) : (
                        panels.map((panel) => (
                            <div
                                key={panel.id}
                                className={styles.panelCard}
                                onClick={() => handlePanelClick(panel.id)}
                            >
                                <div className={styles.panelIcon}>
                                    <span className="material-icons">leaderboard</span>
                                </div>
                                <div className={styles.panelDetails}>
                                    <h3 className={styles.panelName}>{panel.preset} ランキング</h3>
                                    <p className={styles.panelInfo}>
                                        トップ {panel.topCount || 10} •
                                        最終更新: {formatDate(panel.lastUpdate)}
                                    </p>
                                </div>
                                <div className={styles.guildAction}> {/* Reusing guildAction for chevron */}
                                    <span className="material-icons">arrow_forward</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default RankBoardGuild;