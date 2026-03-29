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

    return (
        <div className={styles.root}>
            <section className={styles.pageHeader}>
                <div className={styles.pageHeaderCopy}>
                    <span className={styles.pageEyebrow}>AntiCheat</span>
                    <h1>保護対象サーバーを選択</h1>
                    <p>検知ルール、スコア、処罰、ログをサーバー単位で管理します。</p>
                </div>

                <div className={styles.summary}>
                    <div className={styles.summaryCard}>
                        <span className={styles.summaryLabel}>Available</span>
                        <strong>{guilds.length}</strong>
                        <p>現在このアカウントで開けるサーバー数です。</p>
                    </div>
                </div>
            </section>

            <div>
                {loading ? (
                    <div className={styles.loading} aria-busy="true" aria-live="polite">
                        <div className={styles.spinner} aria-hidden="true"></div>
                        <div>AntiCheat 設定面を準備しています...</div>
                    </div>
                ) : guilds.length === 0 ? (
                    <div className={styles.empty}>
                        <h2>アクセス可能なサーバーがありません</h2>
                        <p>このアカウントに対して管理権限が付与されたサーバーがまだ見つかっていません。</p>
                    </div>
                ) : (
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
                                        <div className={styles.fallbackIcon}>
                                            <span className="material-icons">shield</span>
                                        </div>
                                    )}
                                    <div className={styles.cardBody}>
                                        <div className={styles.guildName}>{g.name}</div>
                                        <div className={styles.guildId}>{g.id}</div>
                                    </div>
                                    <span className={`material-icons ${styles.chevron}`}>arrow_forward</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AntiCheatSelector;
