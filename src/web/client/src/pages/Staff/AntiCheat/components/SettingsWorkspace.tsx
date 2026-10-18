import { useEffect, useRef, useState } from "react";
import type { AntiCheatViewProps, DetectorDefinition } from "../viewTypes";
import { formatDate, formatRemaining } from "../model";
import { DetectorBody, PolicyEditor } from "./SettingsEditors";
import { SettingSwitch } from "./ContentSafetyControls";
import styles from "./SettingsWorkspace.module.css";

const sections = [
  {
    id: "general",
    title: "基本設定",
    hint: "保護の有効化と自動処理",
    icon: "shield",
  },
  {
    id: "ai",
    title: "AIフィルター",
    hint: "検査対象と投稿の扱い",
    icon: "spark",
  },
  {
    id: "spam",
    title: "スパム・メンション",
    hint: "連投や大量通知への対策",
    icon: "message",
  },
  {
    id: "media",
    title: "画像・リンク",
    hint: "画像、広告、危険なリンク",
    icon: "image",
  },
  {
    id: "words",
    title: "NGワード",
    hint: "独自のワードルール",
    icon: "filter",
  },
  {
    id: "punishments",
    title: "自動処罰",
    hint: "スコアに応じた処置",
    icon: "scale",
  },
  {
    id: "exclusions",
    title: "除外対象",
    hint: "ロール・チャンネル別の例外",
    icon: "users",
  },
  {
    id: "notifications",
    title: "ログ通知",
    hint: "記録先のチャンネル",
    icon: "bell",
  },
  {
    id: "activity",
    title: "検知・対応履歴",
    hint: "ログとタイムアウトの管理",
    icon: "activity",
  },
] as const;
type Section = (typeof sections)[number]["id"];
const detectorGroups: Partial<Record<Section, string[]>> = {
  ai: ["contentSafety"],
  spam: [
    "textSpam",
    "crossChannelSpam",
    "duplicateMessage",
    "copyPaste",
    "everyoneMention",
    "mentionSpam",
    "mentionLimit",
    "maxLines",
    "raidDetection",
  ],
  media: ["duplicateImage", "gifFlash", "inviteReferral", "redirectLink"],
  words: ["wordFilter"],
};
const paths: Record<string, string> = {
  shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6L12 3Z M8 12l3 3 5-6",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  message:
    "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z M7 9h10 M7 13h6",
  image: "M4 3h16v18H4V3Z m0 12 5-5 7 8 4-4 M15 7h1",
  filter: "M4 4h16l-6 8v7l-4 2v-9L4 4Z",
  scale: "M12 3v18 M7 21h10 M4 6h16 M6 6l-4 8h8L6 6Z m12 0-4 8h8l-4-8Z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-4",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  activity: "M3 12h4l3-8 4 16 3-8h4",
};
function Icon({ name }: { name: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.shield} />
    </svg>
  );
}

export default function SettingsWorkspace(p: AntiCheatViewProps) {
  const [section, setSection] = useState<Section>("general");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("textSpam");
  const heading = useRef<HTMLHeadingElement>(null);
  const current = sections.find((item) => item.id === section)!;
  const available = (detectorGroups[section] || []).flatMap((key) =>
    p.detectors.filter((def) => def.key === key && p.draft.detectors[key]),
  );
  const matches = available.filter((def) =>
    `${def.title} ${def.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const definition = matches.find((def) => def.key === selected) || matches[0];
  const enabledCount = p.detectors.filter(
    (def) => p.draft.detectors[def.key]?.enabled,
  ).length;
  const changeSection = (next: Section) => {
    setSection(next);
    setQuery("");
    requestAnimationFrame(() =>
      heading.current?.focus({ preventScroll: true }),
    );
  };
  const ep = { ...p, styles };
  return (
    <div className={styles.shell}>
      <div className={styles.breadcrumb}>
        <button type="button" onClick={p.onBack} disabled={p.saving}>
          サーバー管理
        </button>
        <span aria-hidden="true">/</span>
        <span>AntiCheat</span>
      </div>
      <header className={styles.hero}>
        <div className={styles.heroTitle}>
          <span className={styles.heroIcon}>
            <Icon name="shield" />
          </span>
          <div>
            <div className={styles.eyebrow}>SERVER PROTECTION</div>
            <h1>AntiCheat 設定</h1>
            <p>{p.guildName}</p>
          </div>
        </div>
        <div className={styles.overview}>
          <span
            className={p.draft.enabled ? styles.statusOn : styles.statusOff}
          >
            <i />
            {p.draft.enabled ? "保護を有効に設定" : "保護を停止に設定"}
          </span>
          <span>
            {enabledCount} / {p.detectors.length} の検知が有効
          </span>
        </div>
      </header>
      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.navCaption}>設定メニュー</div>
          <label className={styles.mobileMenu}>
            設定メニュー
            <select
              aria-label="設定カテゴリを選択"
              value={section}
              onChange={(event) => changeSection(event.target.value as Section)}
            >
              {sections.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <nav className={styles.navigation} aria-label="AntiCheat設定カテゴリ">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={section === item.id ? "page" : undefined}
                className={section === item.id ? styles.navActive : undefined}
                onClick={() => changeSection(item.id)}
              >
                <Icon name={item.icon} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.hint}</small>
                </span>
                <span className={styles.chevron} aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
          </nav>
          <div className={styles.sidebarHelp}>
            <Icon name="shield" />
            <p>
              変更は「変更を保存」で
              <br />
              サーバーに反映されます。
            </p>
          </div>
        </aside>
        <div className={styles.content}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>
                ANTICHEAT /{" "}
                {String(sections.indexOf(current) + 1).padStart(2, "0")}
              </span>
              <h2 ref={heading} tabIndex={-1}>
                {current.title}
              </h2>
              <p>{current.hint}を設定・確認できます。</p>
            </div>
          </div>
          <div aria-live="polite" role="status">
            {p.saveNotice && (
              <div className={styles.success}>{p.saveNotice}</div>
            )}
          </div>
          {p.actionError && (
            <div className={styles.error} role="alert">
              {p.actionError}
            </div>
          )}
          {!p.draft.enabled &&
            section !== "general" &&
            section !== "activity" && (
              <div className={styles.hint}>
                保護全体が停止に設定されています。検知を動作させるには、基本設定で保護を有効にして保存してください。
              </div>
            )}
          <form
            id="anticheat-settings"
            onSubmit={(event) => {
              event.preventDefault();
              p.onSave();
            }}
          >
            <fieldset className={styles.editorFieldset} disabled={p.saving}>
              {section === "general" && <BasicSettings {...p} />}
              {section === "notifications" && <NotificationSettings {...p} />}
              {(section === "exclusions" || section === "punishments") && (
                <PolicyEditor {...ep} area={section} />
              )}
              {detectorGroups[section] && (
                <>
                  {available.length > 1 && (
                    <div className={styles.detectorToolbar}>
                      <label className={styles.search}>
                        <Icon name="filter" />
                        <input
                          type="search"
                          aria-label="検知機能を検索"
                          placeholder="検知機能を検索…"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </label>
                      <span>{matches.length} 件の機能</span>
                    </div>
                  )}
                  <div
                    className={
                      available.length > 1 ? styles.detectorLayout : undefined
                    }
                  >
                    {available.length > 1 && (
                      <nav
                        className={styles.detectorList}
                        aria-label="検知機能"
                      >
                        {matches.map((def) => (
                          <button
                            type="button"
                            key={def.key}
                            aria-current={
                              definition?.key === def.key ? "true" : undefined
                            }
                            onClick={() => setSelected(def.key)}
                          >
                            <span>{def.title}</span>
                            <small
                              className={
                                p.draft.detectors[def.key].enabled
                                  ? styles.enabledTag
                                  : styles.disabledTag
                              }
                            >
                              {p.draft.detectors[def.key].enabled
                                ? "ON"
                                : "OFF"}
                            </small>
                          </button>
                        ))}
                      </nav>
                    )}
                    {definition ? (
                      <DetectorSettings
                        key={definition.key}
                        definition={definition}
                        p={p}
                      />
                    ) : (
                      <div className={styles.empty}>
                        一致する検知機能がありません。別のキーワードで検索してください。
                      </div>
                    )}
                  </div>
                </>
              )}
            </fieldset>
          </form>
          {section === "activity" && <Activity {...p} />}
        </div>
      </div>
      <footer className={styles.saveBar}>
        <div className={styles.saveState}>
          <span className={p.dirty ? styles.dirtyDot : styles.cleanDot} />
          <div>
            <strong>
              {p.saving
                ? "設定を保存しています…"
                : p.dirty
                  ? "未保存の変更があります"
                  : "変更はすべて保存済みです"}
            </strong>
            <small>
              {p.dirty
                ? "すべてのカテゴリの変更をまとめて保存します。"
                : "設定を変更すると、ここから保存できます。"}
            </small>
          </div>
        </div>
        <div className={styles.saveActions}>
          <button
            className={styles.secondary}
            type="button"
            disabled={!p.dirty || p.saving}
            onClick={p.onDiscard}
          >
            変更を取り消す
          </button>
          <button
            type="submit"
            form="anticheat-settings"
            className={styles.primary}
            disabled={!p.dirty || p.saving}
          >
            {p.saving ? "保存中…" : "変更を保存"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function DetectorSettings({
  definition,
  p,
}: {
  definition: DetectorDefinition;
  p: AntiCheatViewProps;
}) {
  const detector = p.draft.detectors[definition.key];
  return (
    <article className={styles.card}>
      <div className={styles.detectorHeader}>
        <div>
          <h3>{definition.title}</h3>
          <span
            className={
              detector.enabled ? styles.enabledTag : styles.disabledTag
            }
          >
            {detector.enabled ? "有効" : "無効"}
          </span>
        </div>
        <SettingSwitch
          label={`${definition.title}を有効にする`}
          checked={detector.enabled}
          onChange={(enabled) => p.updateDetector(definition.key, { enabled })}
        />
      </div>
      <p className={styles.detectorDescription}>{definition.description}</p>
      {!detector.enabled && (
        <p className={styles.hint}>
          この機能は停止中です。上のスイッチを有効にすると、設定を編集できます。
        </p>
      )}
      {definition.key !== "contentSafety" && !p.draft.autoDelete.enabled && (
        <p className={styles.hint}>
          基本設定の「自動削除」が無効のため、この機能でのメッセージ削除も停止しています。
        </p>
      )}
      <DetectorBody definition={definition} props={{ ...p, styles }} />
    </article>
  );
}

function BasicSettings(p: AntiCheatViewProps) {
  const d = p.draft;
  return (
    <div className={styles.stack}>
      <article className={styles.protectionCard}>
        <div className={styles.row}>
          <div>
            <span className={styles.eyebrow}>MASTER SWITCH</span>
            <h3>サーバー全体の保護</h3>
          </div>
          <span className={styles.largeIcon}>
            <Icon name="shield" />
          </span>
        </div>
        <p>
          すべての検知機能の動作をまとめて切り替えます。個別の設定は、メニューから調整できます。
        </p>
        <SettingSwitch
          label="AntiCheatの保護を有効にする"
          checked={d.enabled}
          onChange={(enabled) => p.updateDraft((c) => ({ ...c, enabled }))}
        />
      </article>
      <article className={styles.card}>
        <div className={styles.cardHeading}>
          <h3>検知後の自動処理</h3>
          <p>各検知機能の設定と組み合わせて動作します。</p>
        </div>
        <div className={styles.automaticRow}>
          <div>
            <h4>メッセージの自動削除</h4>
            <p>
              削除が有効な検知機能で、対象の投稿を削除します。AIフィルターの投稿処理は個別に設定します。
            </p>
          </div>
          <SettingSwitch
            label="自動削除"
            checked={d.autoDelete.enabled}
            onChange={(enabled) =>
              p.updateDraft((c) => ({
                ...c,
                autoDelete: { ...c.autoDelete, enabled },
              }))
            }
          />
          <label className={styles.duration}>
            削除対象の期間（秒）
            <input
              type="number"
              min={1}
              required
              value={d.autoDelete.windowSeconds}
              disabled={!d.autoDelete.enabled}
              onChange={(event) =>
                p.updateDraft((c) => ({
                  ...c,
                  autoDelete: {
                    ...c.autoDelete,
                    windowSeconds: Number(event.target.value),
                  },
                }))
              }
            />
            <small>600秒 = 10分</small>
          </label>
        </div>
        <div className={styles.automaticRow}>
          <div>
            <h4>検知時の自動タイムアウト</h4>
            <p>
              検知したユーザーを一時的に発言できなくします。スコアごとの処置は「自動処罰」で設定できます。
            </p>
          </div>
          <SettingSwitch
            label="自動タイムアウト"
            checked={d.autoTimeout.enabled}
            onChange={(enabled) =>
              p.updateDraft((c) => ({
                ...c,
                autoTimeout: { ...c.autoTimeout, enabled },
              }))
            }
          />
          <label className={styles.duration}>
            タイムアウト時間（秒）
            <input
              type="number"
              min={1}
              max={2419200}
              required
              value={d.autoTimeout.durationSeconds}
              disabled={!d.autoTimeout.enabled}
              onChange={(event) =>
                p.updateDraft((c) => ({
                  ...c,
                  autoTimeout: {
                    ...c.autoTimeout,
                    durationSeconds: Number(event.target.value),
                  },
                }))
              }
            />
            <small>3600秒 = 1時間</small>
          </label>
        </div>
      </article>
      <div className={styles.hint}>
        <strong>アンチレイド：{d.raidMode.active ? "発動中" : "待機中"}</strong>
        <p>
          参加人数の急増を監視します。条件は「スパム・メンション」内の「自動アンチレイド」から設定できます。最終発動：
          {formatDate(d.raidMode.activatedAt)}
        </p>
      </div>
    </div>
  );
}

const channelFields = [
  {
    key: "logChannelId",
    title: "検知ログ",
    description: "検知した内容と処置をスタッフに通知します。",
  },
  {
    key: "aiLogChannelId",
    title: "AI判定ログ",
    description:
      "検知なしも含めた判定理由・スコア・処理状況を記録します。スタッフ専用チャンネルを選んでください。",
  },
  {
    key: "avatarLogChannelId",
    title: "アバターログ",
    description: "アバターの変更・検査に関するログの送信先です。",
  },
  {
    key: "chatLogChannelId",
    title: "チャットログ",
    description: "チャットログの送信先です。",
  },
] as const;
type Channel = { id: string; name: string; type: string };
function NotificationSettings(p: AntiCheatViewProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(
      `/api/staff/anticheat/${encodeURIComponent(p.guildId)}/exclusion-targets`,
      { credentials: "include", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "チャンネル一覧を取得できませんでした。IDの直接入力も利用できます。",
          );
        return response.json();
      })
      .then((data) =>
        setChannels(
          (data.channels || []).filter((channel: Channel) =>
            ["テキスト", "アナウンス", "スレッド", "非公開スレッド"].includes(
              channel.type,
            ),
          ),
        ),
      )
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [p.guildId, attempt]);
  return (
    <div className={styles.stack}>
      <div className={styles.hint}>
        通知先を選ぶか、チャンネルIDを直接入力してください。空欄の項目は通知しません。Botが閲覧・送信できるチャンネルを指定してください。
      </div>
      {loading && <p role="status">チャンネルを読み込んでいます…</p>}
      {error && (
        <div className={styles.error} role="alert">
          {error}{" "}
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setAttempt((value) => value + 1)}
          >
            再取得
          </button>
        </div>
      )}
      {channelFields.map((field) => (
        <article className={styles.card} key={field.key}>
          <div className={styles.cardHeading}>
            <h3>{field.title}</h3>
            <p>{field.description}</p>
          </div>
          <div className={styles.formGrid}>
            <label>
              {field.title}の通知先
              <select
                aria-label={`${field.title}の通知先`}
                value={
                  channels.some((channel) => channel.id === p.draft[field.key])
                    ? p.draft[field.key]!
                    : p.draft[field.key]
                      ? "__custom"
                      : ""
                }
                onChange={(event) => {
                  if (event.target.value !== "__custom")
                    p.updateDraft((c) => ({
                      ...c,
                      [field.key]: event.target.value || null,
                    }));
                }}
              >
                <option value="">通知しない</option>
                {p.draft[field.key] &&
                  !channels.some(
                    (channel) => channel.id === p.draft[field.key],
                  ) && (
                    <option value="__custom">
                      指定したID：{p.draft[field.key]}
                    </option>
                  )}
                {channels.map((channel) => (
                  <option value={channel.id} key={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {field.title}のチャンネルID
              <input
                type="text"
                inputMode="numeric"
                pattern="[1-9][0-9]{0,19}"
                title="数字のチャンネルIDを入力してください"
                placeholder="未設定"
                value={p.draft[field.key] || ""}
                onChange={(event) =>
                  p.updateDraft((c) => ({
                    ...c,
                    [field.key]: event.target.value.trim() || null,
                  }))
                }
              />
            </label>
          </div>
        </article>
      ))}
    </div>
  );
}

function Activity(p: AntiCheatViewProps) {
  const [tab, setTab] = useState<"timeouts" | "logs" | "trust">("timeouts");
  const loading =
    tab === "timeouts"
      ? p.timeoutsLoading
      : tab === "logs"
        ? p.logsLoading
        : p.trustLoading;
  const error =
    tab === "timeouts"
      ? p.timeoutsError
      : tab === "logs"
        ? p.logsError
        : p.trustError;
  const refresh =
    tab === "timeouts"
      ? p.onRefreshTimeouts
      : tab === "logs"
        ? p.onRefreshLogs
        : p.onRefreshTrust;
  const detectorName = (key: string) =>
    p.detectors.find((def) => def.key === key)?.title || key;
  return (
    <div className={styles.stack}>
      <div className={styles.activityToolbar}>
        <nav aria-label="履歴の種類" className={styles.activityTabs}>
          {(
            [
              ["timeouts", "タイムアウト"],
              ["logs", "検知ログ"],
              ["trust", "信頼スコア"],
            ] as const
          ).map(([id, title]) => (
            <button
              type="button"
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {title}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className={styles.secondary}
          disabled={loading}
          onClick={refresh}
        >
          {loading ? "更新中…" : "再取得"}
        </button>
      </div>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      {loading ? (
        <p role="status" className={styles.empty}>
          履歴を読み込んでいます…
        </p>
      ) : (
        <div className={styles.card}>
          {tab === "timeouts" &&
            (p.activeTimeouts.length ? (
              p.activeTimeouts.map((entry) => (
                <div className={styles.activityEntry} key={entry.userId}>
                  <div>
                    <strong>{entry.displayName || entry.username}</strong>
                    <small>{entry.userId}</small>
                    <p>{entry.sourceReason || "検知理由の記録なし"}</p>
                    <small>
                      {entry.sourceDetector
                        ? detectorName(entry.sourceDetector)
                        : "不明"}{" "}
                      · 残り {formatRemaining(entry.remainingMs)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={p.executing}
                    onClick={() => p.onRevokeActiveTimeout(entry)}
                  >
                    解除
                  </button>
                </div>
              ))
            ) : (
              <div className={styles.empty}>
                現在タイムアウト中のユーザーはいません。
              </div>
            ))}
          {tab === "logs" &&
            (p.logs.length ? (
              p.logs.map((log, index) => (
                <div
                  className={styles.activityEntry}
                  key={`${log.messageId}-${log.timestamp}-${index}`}
                >
                  <div>
                    <strong>{detectorName(log.detector)}</strong>
                    <small>
                      {formatDate(log.timestamp)} · ユーザー {log.userId} ·
                      スコア {log.scoreDelta > 0 ? "+" : ""}
                      {log.scoreDelta}
                    </small>
                    <p>{log.reason}</p>
                  </div>
                  {log.metadata?.isTimedOut && log.status !== "revoked" && (
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={p.executing}
                      onClick={() => p.onRevokeLogTimeout(log)}
                    >
                      解除
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className={styles.empty}>検知ログはありません。</div>
            ))}
          {tab === "trust" &&
            (p.trustEntries.length ? (
              p.trustEntries.map((entry) => (
                <div className={styles.activityEntry} key={entry.userId}>
                  <div>
                    <strong>{entry.displayName || entry.username}</strong>
                    <small>{entry.userId}</small>
                    <p>スコア {entry.score}</p>
                    <small>更新 {formatDate(entry.lastUpdated)}</small>
                  </div>
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={p.executing}
                    onClick={() => p.onResetTrust(entry.userId)}
                  >
                    リセット
                  </button>
                </div>
              ))
            ) : (
              <div className={styles.empty}>信頼スコアの記録はありません。</div>
            ))}
        </div>
      )}
    </div>
  );
}
