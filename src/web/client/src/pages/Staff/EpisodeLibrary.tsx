import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ui from '../ManagementDashboard.module.css';
import styles from './EpisodeLibrary.module.css';
import { CollapsibleSection } from './StaffAI';

/**
 * 出来事ライブラリ: dot常駐とバックフィルが記録したサーバーの出来事を、
 * 年月 → 週（月曜始まり）→ 出来事 の階層で辞書のように引ける読み物ページ。
 * 階層の組み立てはサーバー側（EpisodeLibrary.ts）が行い、ここは表示に徹する。
 * 閲覧専用で、削除・編集はしない。
 */

type Guild = { id: string; name: string };
type EpisodeItem = {
  id: string; at: number; date: string; dateLabel: string; timeLabel: string;
  actor: string; summary: string; channelName: string; jumpUrl?: string;
};
type EpisodeWeek = {
  key: string; label: string; startDate: string; endDate: string;
  count: number; episodes: EpisodeItem[];
};
type EpisodeMonth = { key: string; label: string; count: number; weeks: EpisodeWeek[] };
type LibraryData = { total: number; matched: number; query: string; months: EpisodeMonth[] };

const icon = (value: string, className = '') =>
  <span className={`material-icons ${className || ui.icon}`} aria-hidden="true">{value}</span>;

async function readJson(url: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  if (options?.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const r = await fetch(url, { credentials: 'include', cache: 'no-store', ...options, headers });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

const EpisodeLibraryPage: React.FC = () => {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildId, setGuildId] = useState('');
  const selectedGuildRef = useRef(guildId);
  selectedGuildRef.current = guildId;
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [search, setSearch] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [loadingGuilds, setLoadingGuilds] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void readJson('/api/staff/guilds')
      .then(data => {
        if (!active) return;
        const list = (data.guilds || []) as Guild[];
        setGuilds(list);
        setGuildId(list[0]?.id ?? '');
      })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'サーバー一覧の取得に失敗しました'); })
      .finally(() => { if (active) setLoadingGuilds(false); });
    return () => { active = false; };
  }, []);

  // 入力が止まって少し待ってから検索する（打つたびに全件照合しない）。
  useEffect(() => {
    const timer = setTimeout(() => setAppliedQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const refresh = useCallback(async (selectedGuild: string, query: string, showLoading = false) => {
    if (!selectedGuild) return;
    if (showLoading) setLoading(true);
    try {
      const params = query ? `?q=${encodeURIComponent(query)}` : '';
      const data = await readJson(`/api/staff/ai/${selectedGuild}/episodes${params}`) as LibraryData;
      if (selectedGuild !== selectedGuildRef.current) return;
      setLibrary(data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '出来事の取得に失敗しました');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (guildId) void refresh(guildId, appliedQuery);
  }, [guildId, appliedQuery, refresh]);

  const searching = appliedQuery !== '';
  const selected = guilds.find(g => g.id === guildId);

  return <div className={`${ui.page} ${styles.pageRoot}`}>
    <header className={ui.hero}>
      <div>
        <Link to="/staff/ai" className={ui.muted}>{icon('arrow_back')} Staff AIに戻る</Link>
        <div style={{ marginTop: 14 }}><span className={ui.eyebrow}>{icon('menu_book')} Episode Library</span></div>
        <h1>出来事ライブラリ</h1>
        <p>AIが記録したサーバーの出来事を、月ごと・週ごとに辞書のように引けます。週は月曜始まりで、月をまたぐ週は月曜の属する月にまとめてあります。</p>
      </div>
      <div className={ui.heroActions}>
        <label className={ui.label}>対象サーバー
          <select className={ui.select} aria-label="管理対象サーバー" value={guildId}
            onChange={e => setGuildId(e.target.value)} disabled={loadingGuilds}>
            {!guildId && <option value="">サーバーを選択</option>}
            {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <button type="button" className={`${ui.button} ${ui.serverRefreshButton}`} onClick={() => void refresh(guildId, appliedQuery, true)} disabled={loading || !guildId}>
          {icon('refresh')} {loading ? '更新中…' : '更新'}
        </button>
      </div>
    </header>

    {error && <div className={ui.error} role="alert">{icon('error_outline')} <span>{error}</span></div>}
    {loadingGuilds ? <div className={ui.state} role="status">{icon('hourglass_top')}<p>サーバー情報を読み込んでいます…</p></div>
      : !guildId ? <div className={ui.state}>{icon('dns')}<h3>管理できるサーバーがありません</h3><p>Staff権限のあるサーバーでログインしてください。</p></div>
        : <>
          <div className={ui.toolbar}>
            <label className={ui.searchWrap}>{icon('search')}<input aria-label="出来事を検索" placeholder="キーワードで検索（要約・話者・チャンネル）" value={search} onChange={e => setSearch(e.target.value)} /></label>
            {library ? <span className={ui.muted} role="status">
              {searching
                ? `「${appliedQuery}」に一致する出来事 ${library.matched} 件（全 ${library.total} 件）`
                : `${selected?.name ?? ''} の出来事 全 ${library.total} 件`}
            </span> : null}
          </div>

          {!library ? <div className={ui.state} role="status">{icon('hourglass_top')}<p>出来事を読み込んでいます…</p></div>
            : library.total === 0 ? <div className={ui.panel}><div className={ui.emptyInner}>
              <div className={ui.emptyIcon}>{icon('menu_book')}</div>
              <h3>まだ出来事が記録されていません</h3>
              <p>dot常駐の観測や過去履歴の取り込みで出来事が記録されると、ここに月ごと・週ごとに並びます。</p>
            </div></div>
              : searching && library.matched === 0 ? <div className={ui.panel}><div className={ui.emptyInner}>
                <div className={ui.emptyIcon}>{icon('search_off')}</div>
                <h3>一致する出来事はありません</h3>
                <p>「{appliedQuery}」を含む出来事は見つかりませんでした。検索条件を変えてみてください。</p>
              </div></div>
                : library.months.map((month, index) => (
                  <CollapsibleSection
                    // 検索中は一致した月をすべて開く（条件が変わるたびに開き直す）。
                    key={searching ? `${month.key}:${appliedQuery}` : month.key}
                    eyebrow={<span className={ui.eyebrow}>{icon('calendar_month')} {month.key}</span>}
                    title={month.label}
                    badge={<span className={ui.badge}>{icon('event_note')} {month.count} 件</span>}
                    defaultOpen={searching || index === 0}
                  >
                    <div className={styles.monthBody}>
                      {month.weeks.map(week => <div className={styles.week} key={week.key}>
                        <div className={styles.weekHeader}>
                          <h3 className={styles.weekTitle}>{week.label}</h3>
                          <span className={ui.badge}>{week.count} 件</span>
                        </div>
                        <div className={styles.episodeList}>
                          {week.episodes.map(item => <article className={styles.episodeItem} key={item.id}>
                            <div className={styles.episodeMeta}>
                              <span className={styles.episodeDate}>{item.dateLabel} {item.timeLabel}</span>
                              <span className={styles.episodeActor}>{item.actor}</span>
                              {item.channelName ? <span className={styles.episodeChannel}>#{item.channelName}</span> : null}
                              {item.jumpUrl ? <a className={styles.jumpLink} href={item.jumpUrl} target="_blank" rel="noreferrer" aria-label={`${item.actor} の元の発言をDiscordで開く`}>
                                {icon('open_in_new', styles.jumpIcon)} 元の発言
                              </a> : null}
                            </div>
                            <p className={styles.episodeSummary}>{item.summary}</p>
                          </article>)}
                        </div>
                      </div>)}
                    </div>
                  </CollapsibleSection>
                ))}
        </>}
  </div>;
};

export default EpisodeLibraryPage;
