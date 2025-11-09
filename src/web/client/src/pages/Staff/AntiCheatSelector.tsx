import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './AntiCheatSelector.module.css';

interface GuildEntry {
    id: string;
    name: string;
    icon?: string | null;
}

const AntiCheatSelector: React.FC = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [guilds, setGuilds] = useState<GuildEntry[]>([]);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch('/api/staff/guilds', { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json();
                    setGuilds(data.guilds || []);
                }
            } catch (e) {
                console.error('Failed to load guilds for AntiCheat selector', e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    if (loading) return (
        <div className={styles.loading} aria-busy="true" aria-live="polite">
            <div className={styles.spinner} aria-hidden="true"></div>
            <div>読み込み中...</div>
        </div>
    );

    if (guilds.length === 0) return (
        <div className={styles.empty}>
            <h2>アクセス可能なサーバーがありません</h2>
            <p>このアカウントはまだ管理権限のあるサーバーに接続されていない可能性があります。</p>
        </div>
    );

    return (
        <div className={styles.root}>
            <h2 className={styles.title}>AntiCheat を管理するサーバーを選択</h2>
            <div className={styles.grid}>
                {guilds.map(g => (
                    <div
                        key={g.id}
                        className={styles.card}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/staff/anticheat/${g.id}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/staff/anticheat/${g.id}`); }}
                        aria-label={`Open AntiCheat for ${g.name}`}
                    >
                        <div className={styles.cardInner}>
                            {g.icon ? (
                                <img src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`} alt={g.name} className={styles.icon} />
                            ) : (
                                <div className={styles.fallbackIcon}>🏷️</div>
                            )}
                            <div>
                                <div className={styles.guildName}>{g.name}</div>
                                <div className={styles.guildId}>{g.id}</div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AntiCheatSelector;
