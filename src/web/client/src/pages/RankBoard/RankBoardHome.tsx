import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './RankBoard.module.css';

interface GuildInfo {
    id: string;
    name: string;
    icon?: string | null;
    hasRanking?: boolean;
}

const RankBoardHome: React.FC = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [guilds, setGuilds] = useState<GuildInfo[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchGuilds();
    }, []);

    const fetchGuilds = async () => {
        try {
            setLoading(true);
            setError(null);

            const res = await fetch('/api/rank/guilds', { credentials: 'include' });
            if (!res.ok) {
                throw new Error('サーバー情報の取得に失敗しました');
            }

            const data = await res.json();
            setGuilds(data.guilds || []);
        } catch (err) {
            console.error('Failed to fetch guilds:', err);
            setError('サーバー情報の取得に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleGuildClick = (guildId: string) => {
        navigate(`/rank/${guildId}`);
    };

    const getGuildIconUrl = (guildId: string, icon?: string | null) => {
        if (!icon) return '';
        if (/^https?:\/\//.test(icon)) return icon;
        return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png`;
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

    if (error) {
        return (
            <div className={styles.container}>
                <div className={styles.error}>
                    <span className="material-icons">error</span>
                    <h2>エラー</h2>
                    <p>{error}</p>
                    <button
                        className={styles.backBtn}
                        onClick={() => window.location.reload()}
                    >
                        再試行
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.guildInfo}>
                    <div>
                        <h1>🏆 ランキングボード</h1>
                        <p>参加しているサーバーのランキングを表示</p>
                    </div>
                </div>
            </div>

            <div className={styles.guilds}>
                <div className={styles.guildsHeader}>
                    <h2>サーバー一覧</h2>
                    <p>ランキングを表示したいサーバーを選択してください</p>
                </div>

                <div className={styles.guildsGrid}>
                    {guilds.length === 0 ? (
                        <div className={styles.empty}>
                            <span className="material-icons">group</span>
                            <p>参加しているサーバーが見つかりません</p>
                        </div>
                    ) : (
                        guilds.map((guild) => (
                            <div
                                key={guild.id}
                                className={styles.guildCard}
                                onClick={() => handleGuildClick(guild.id)}
                            >
                                {guild.icon ? (
                                    <img
                                        src={getGuildIconUrl(guild.id, guild.icon)}
                                        alt={guild.name}
                                        className={styles.guildIcon}
                                        onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                        }}
                                    />
                                ) : (
                                    <div className={styles.guildIconPlaceholder}>
                                        <span className="material-icons">group</span>
                                    </div>
                                )}
                                <div className={styles.guildDetails}>
                                    <h3 className={styles.guildName}>{guild.name}</h3>
                                    <p className={styles.guildId}>ID: {guild.id}</p>
                                </div>
                                <div className={styles.guildAction}>
                                    <span className="material-icons">chevron_right</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default RankBoardHome;