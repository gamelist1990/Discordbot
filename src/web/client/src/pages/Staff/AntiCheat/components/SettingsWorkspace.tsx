import { useEffect, useRef, useState } from "react";
import type { AntiCheatViewProps, DetectorDefinition } from "../viewTypes";
import { formatDate, formatRemaining, parseListText } from "../model";
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
    id: "snapshots",
    title: "スナップショット・復元",
    hint: "サーバー構造の保存と復旧",
    icon: "archive",
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
  archive: "M3 4h18v5H3V4Z m2 5v11h14V9 M9 13h6",
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
            section !== "activity" &&
            section !== "snapshots" && (
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
          {section === "snapshots" && <SnapshotSettings {...p} />}
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

function IdListEditor({
  label,
  description,
  value,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  value: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [text, setText] = useState(value.join("\n"));
  useEffect(() => {
    setText((current) =>
      parseListText(current).join("\n") === value.join("\n")
        ? current
        : value.join("\n"),
    );
  }, [value]);
  return (
    <label className={styles.wide}>
      {label}
      <textarea
        rows={3}
        value={text}
        disabled={disabled}
        placeholder="1行に1つ、またはカンマ区切りでIDを入力"
        onChange={(event) => setText(event.target.value)}
        onBlur={() => onChange(parseListText(text))}
      />
      <small>{description}</small>
    </label>
  );
}

function AntiNukeCard(p: AntiCheatViewProps) {
  const d = p.draft;
  const a = d.antiNuke;
  const patch = (updates: Partial<typeof a>) =>
    p.updateDraft((current) => ({
      ...current,
      antiNuke: { ...current.antiNuke, ...updates },
    }));
  const thresholds = Object.entries(a.rules || {})
    .map(([key, rule]) => `${key} ${rule.threshold}/${rule.windowSeconds}s`)
    .join(" / ");
  return (
    <article className={styles.card}>
      <div className={styles.cardHeading}>
        <h3>AntiNuke（破壊行為対策）</h3>
        <p>
          チャンネル・ロール・メンバーなどの破壊的行為を実行者ごとに監視し、
          しきい値を超えた瞬間、または管理者権限の付与を検知した瞬間に
          実行者をBANします。BANできない場合はロールを剥奪し、それも失敗した
          場合はその旨をログとオーナーDMに記録します（成功として扱いません）。
          スナップショットとインシデントはBot側のDBに保存され、Botが
          キックされても残ります。
        </p>
      </div>
      <div className={styles.automaticRow}>
        <div>
          <h4>AntiNukeを有効にする</h4>
          <p>
            既定で有効です。しきい値・即時ルール・自己防衛の詳細は
            設定JSON（antiNuke）で調整でき、現在値は下に表示しています。
          </p>
        </div>
        <SettingSwitch
          label="AntiNuke"
          checked={a.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
      </div>
      <div className={styles.automaticRow}>
        <div>
          <h4>ホワイトリスト</h4>
          <p>
            サーバー所有者とこのBotは常に対象外です。ここに追加した
            ユーザー・ロール・BOTは検知対象から除外されます。
          </p>
        </div>
      </div>
      <IdListEditor
        label="除外ユーザーID"
        description="BAN対象にしないユーザーのID"
        value={a.whitelistUsers}
        disabled={!a.enabled}
        onChange={(whitelistUsers) => patch({ whitelistUsers })}
      />
      <IdListEditor
        label="除外ロールID"
        description="このロールを持つメンバーは対象外"
        value={a.whitelistRoles}
        disabled={!a.enabled}
        onChange={(whitelistRoles) => patch({ whitelistRoles })}
      />
      <IdListEditor
        label="除外BOT ID"
        description="BAN対象にしないBOTアカウントのID"
        value={a.whitelistBots}
        disabled={!a.enabled}
        onChange={(whitelistBots) => patch({ whitelistBots })}
      />
      <p className={styles.hint}>
        <strong>現在のしきい値（回数/秒）</strong>
        <br />
        {thresholds || "既定値"}
      </p>
      <div className={styles.automaticRow}>
        <div>
          <h4>自動復旧（AN3）</h4>
          <p>
            AntiNukeの発動後、即時対応（BAN／ロール剥奪・ログ・オーナーDM）が
            終わった直後に自動で復旧を開始します。待機時間はありません。
            実行中の自動復旧は「スナップショット・復元」画面の停止ボタンで
            途中停止できます（次の区切りで反映）。
          </p>
        </div>
        <label className={styles.duration}>
          復旧範囲
          <select
            aria-label="自動復旧の範囲"
            value={a.autoRestore}
            disabled={!a.enabled}
            onChange={(event) =>
              patch({
                autoRestore: event.target.value as typeof a.autoRestore,
              })
            }
          >
            <option value="off">オフ（手動復元のみ）</option>
            <option value="cleanup">クリーンアップのみ（作成物削除・BAN解除）</option>
            <option value="full">
              完全復旧（クリーンアップ＋スナップショット復元）
            </option>
          </select>
          <small>既定: 完全復旧</small>
        </label>
      </div>
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
      <article className={styles.card}>
        <div className={styles.cardHeading}>
          <h3>警戒ユーザー（監視）</h3>
          <p>
            捨てアカウント・一斉作成アカウントの特徴に一致したメンバーを「警戒」として分類し、通常より厳しく監視します。現在 {p.watchUsers.length} 人を警戒中です。
          </p>
        </div>
        <div className={styles.automaticRow}>
          <div>
            <h4>警戒ユーザーの自動分類</h4>
            <p>
              表示名がユーザー名と同一、数字だけの表示名、新規アカウント、同一バッチ作成、共通アバター、類似名から判定します。
            </p>
          </div>
          <SettingSwitch
            label="警戒ユーザーの自動分類"
            checked={d.watch.enabled}
            onChange={(enabled) =>
              p.updateDraft((c) => ({
                ...c,
                watch: { ...c.watch, enabled },
              }))
            }
          />
          <label className={styles.duration}>
            新規アカウントの日数
            <input
              type="number"
              min={1}
              max={90}
              required
              value={d.watch.newAccountDays}
              disabled={!d.watch.enabled}
              onChange={(event) =>
                p.updateDraft((c) => ({
                  ...c,
                  watch: {
                    ...c.watch,
                    newAccountDays: Number(event.target.value),
                  },
                }))
              }
            />
          </label>
        </div>
        <div className={styles.automaticRow}>
          <div>
            <h4>検出時にログへ通知</h4>
            <p>新たに警戒ユーザーとして分類したとき、ログチャンネルへ1件通知します（本人へのDMは送りません）。</p>
          </div>
          <SettingSwitch
            label="警戒ユーザー検出の通知"
            checked={d.watch.notifyOnFlag}
            onChange={(enabled) =>
              p.updateDraft((c) => ({
                ...c,
                watch: { ...c.watch, notifyOnFlag: enabled },
              }))
            }
          />
        </div>
        <div className={styles.automaticRow}>
          <div>
            <h4>危険判定による自動キック</h4>
            <p>
              警戒ユーザーが24時間以内に加算した検知ポイントがしきい値に達すると、投稿を削除してキックします。キックできない場合は通常の自動タイムアウトに切り替えます。
            </p>
          </div>
          <SettingSwitch
            label="警戒ユーザーの危険判定でキック"
            checked={d.watch.autoKickOnDanger}
            onChange={(enabled) =>
              p.updateDraft((c) => ({
                ...c,
                watch: { ...c.watch, autoKickOnDanger: enabled },
              }))
            }
          />
          <label className={styles.duration}>
            キックのしきい値（点）
            <input
              type="number"
              min={1}
              max={100}
              required
              value={d.watch.kickThresholdPoints}
              onChange={(event) =>
                p.updateDraft((c) => ({
                  ...c,
                  watch: {
                    ...c.watch,
                    kickThresholdPoints: Number(event.target.value),
                  },
                }))
              }
            />
          </label>
          <label className={styles.duration}>
            キック時の削除（時間）
            <input
              type="number"
              min={1}
              max={336}
              required
              value={d.watch.purgeWindowHours}
              onChange={(event) =>
                p.updateDraft((c) => ({
                  ...c,
                  watch: {
                    ...c.watch,
                    purgeWindowHours: Number(event.target.value),
                  },
                }))
              }
            />
          </label>
        </div>
      </article>
      <AntiNukeCard {...p} />
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
  const [tab, setTab] = useState<
    "timeouts" | "logs" | "trust" | "watch" | "webAuth"
  >("timeouts");
  const [webAuthUserId, setWebAuthUserId] = useState("");
  const [webAuthNote, setWebAuthNote] = useState("");
  const loading =
    tab === "timeouts"
      ? p.timeoutsLoading
      : tab === "logs"
        ? p.logsLoading
        : tab === "trust"
          ? p.trustLoading
          : tab === "watch"
            ? p.watchLoading
            : p.webAuthLoading;
  const error =
    tab === "timeouts"
      ? p.timeoutsError
      : tab === "logs"
        ? p.logsError
        : tab === "trust"
          ? p.trustError
          : tab === "watch"
            ? p.watchError
            : p.webAuthError;
  const refresh =
    tab === "timeouts"
      ? p.onRefreshTimeouts
      : tab === "logs"
        ? p.onRefreshLogs
        : tab === "trust"
          ? p.onRefreshTrust
          : tab === "watch"
            ? p.onRefreshWatch
            : p.onRefreshWebAuth;
  const detectorName = (key: string) =>
    p.detectors.find((def) => def.key === key)?.title || key;
  const watchReasonLabel = (reason: string) =>
    reason === "webauth-match"
      ? "Web認証で同一IP/端末を検出"
      : reason === "graph"
        ? "相関グラフで危険アカウントと連結"
        : reason;
  const browserLabel = (record: (typeof p.webAuthRecords)[number]) =>
    record.source === "staff"
      ? "スタッフ認証"
      : record.browser.name === "chrome"
        ? "Chrome"
        : record.browser.name === "edge"
          ? "Edge"
          : record.browser.name === "safari"
            ? "Safari"
            : "不明";
  const geoLabel = (record: (typeof p.webAuthRecords)[number]) =>
    record.geoMismatch === "tz"
      ? "タイムゾーン"
      : record.geoMismatch === "lang"
        ? "言語"
        : record.geoMismatch === "both"
          ? "タイムゾーン・言語"
          : "なし";
  /** Brief-9 signal summary; block rules are separate from these signals. */
  const signalSummary = (record: (typeof p.webAuthRecords)[number]) => {
    const notes: string[] = [];
    if (record.automation?.webdriver) {
      notes.push("自動化ブラウザ（webdriver=true）");
    } else if (record.automation) {
      const traits: string[] = [];
      if (record.automation.pluginCount === 0) traits.push("プラグイン0");
      if (record.automation.outerWidth === 0 || record.automation.outerHeight === 0) {
        traits.push("ウィンドウ外寸0");
      }
      if (record.automation.notificationMismatch) traits.push("通知権限の不整合");
      if (traits.length) notes.push(`自動化の兆候: ${traits.join("・")}`);
    }
    if (record.softwareRenderer) notes.push("ソフトウェア描画（仮想GPU）");
    if (record.geoMismatch !== "none") {
      notes.push(
        `地理不整合: ${geoLabel(record)}${record.countryCode ? `（IP国 ${record.countryCode}）` : ""}`,
      );
    }
    return notes.join(" · ");
  };
  const intelLabel = (record: (typeof p.webAuthRecords)[number]) => {
    if (record.source === "staff" || record.intel.verdict === "staff") {
      return "スタッフ上書き";
    }
    if (record.intel.verdict === "blocked") {
      return `VPN・プロキシ検出${record.intel.flags.length ? `（${record.intel.flags.join(", ")}）` : ""}`;
    }
    if (record.intel.verdict === "unavailable") {
      return "未検証（IP評価を取得できず）";
    }
    return "正常";
  };
  return (
    <div className={styles.stack}>
      <div className={styles.activityToolbar}>
        <nav aria-label="履歴の種類" className={styles.activityTabs}>
          {(
            [
              ["timeouts", "タイムアウト"],
              ["logs", "検知ログ"],
              ["trust", "信頼スコア"],
              ["watch", `警戒ユーザー${p.watchUsers.length ? ` (${p.watchUsers.length})` : ""}`],
              ["webAuth", `Web認証${p.webAuthRecords.length ? ` (${p.webAuthRecords.length})` : ""}`],
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
          {tab === "watch" &&
            (p.watchUsers.length ? (
              p.watchUsers.map((entry) => (
                <div className={styles.activityEntry} key={entry.userId}>
                  <div>
                    <strong>{entry.displayName || entry.username}</strong>
                    <small>{entry.userId}</small>
                    <p>{watchReasonLabel(entry.reason)}</p>
                    <small>
                      登録 {formatDate(entry.since)} · アカウント作成{" "}
                      {formatDate(entry.accountCreatedAt)} · 24時間の加点{" "}
                      {entry.dangerPoints24h}
                    </small>
                  </div>
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={p.executing}
                    onClick={() => p.onDismissWatch(entry)}
                  >
                    解除
                  </button>
                </div>
              ))
            ) : (
              <div className={styles.empty}>
                警戒ユーザーとして分類されたメンバーはいません。
              </div>
            ))}
          {tab === "webAuth" && (
            <>
              <div className={styles.cardHeading}>
                <h3>Web認証の記録</h3>
                <p>
                  Web認証ページで取得したIP・端末指紋の記録です。値はハッシュと暗号化でのみ保存され、この画面には表示されません。
                  VPNの誤検知やChrome/Edge/Safariを使えないメンバーは、ユーザーIDを指定してスタッフ認証を記録できます。
                </p>
              </div>
              <form
                className={styles.formGrid}
                onSubmit={(event) => {
                  event.preventDefault();
                  const userId = webAuthUserId.trim();
                  if (!/^[1-9]\d{0,19}$/.test(userId)) {
                    window.alert("数値のDiscordユーザーIDを入力してください。");
                    return;
                  }
                  p.onForceVerifyWebAuth(userId, webAuthNote.trim());
                  setWebAuthUserId("");
                  setWebAuthNote("");
                }}
              >
                <label>
                  ユーザーID
                  <input
                    value={webAuthUserId}
                    onChange={(event) => setWebAuthUserId(event.target.value)}
                    placeholder="123456789012345678"
                    inputMode="numeric"
                  />
                </label>
                <label>
                  メモ（任意）
                  <input
                    value={webAuthNote}
                    onChange={(event) => setWebAuthNote(event.target.value)}
                    maxLength={500}
                    placeholder="VPN誤検知のためスタッフ確認済み"
                  />
                </label>
                <div className={styles.wide}>
                  <button type="submit" className={styles.secondary}>
                    スタッフ認証を記録
                  </button>
                </div>
              </form>
              {p.webAuthRecords.length ? (
                p.webAuthRecords.map((record) => (
                  <div className={styles.activityEntry} key={record.id}>
                    <div>
                      <strong>{record.displayName || record.username}</strong>
                      <small>
                        {record.userId} · {formatDate(record.createdAt)} ·{" "}
                        {browserLabel(record)}
                      </small>
                      <p>
                        IP判定: {intelLabel(record)} · 同一IP/端末アカウント数:{" "}
                        {record.matchCount} 件
                        {record.roleGranted ? "" : " · ロール付与失敗"}
                      </p>
                      {signalSummary(record) && (
                        <p>端末シグナル: {signalSummary(record)}</p>
                      )}
                      {record.note && <small>メモ: {record.note}</small>}
                    </div>
                    <span
                      className={
                        record.verified ? styles.statusOn : styles.statusOff
                      }
                    >
                      <i />
                      {record.verified ? "認証済み" : "未認証"}
                    </span>
                  </div>
                ))
              ) : (
                <div className={styles.empty}>
                  まだWeb認証の記録はありません。
                </div>
              )}
            </>
          )}
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

const SNAPSHOT_TRIGGER_LABELS: Record<string, string> = {
  scheduled: "定期",
  manual: "手動",
  prerestore: "復元前の安全保存",
};

const RESTORE_KIND_LABELS: Record<string, string> = {
  role: "ロール",
  category: "カテゴリ",
  channel: "チャンネル",
  overwrite: "権限上書き",
  guildSettings: "サーバー設定",
  emoji: "絵文字",
  memberRoles: "メンバーのロール",
  ban: "BAN解除",
};

const AUTO_RESTORE_STATUS_LABELS: Record<string, string> = {
  running: "実行中",
  done: "完了",
  stopped: "停止",
  failed: "失敗",
  skipped: "実行済み",
};

const AUTO_RESTORE_MODE_LABELS: Record<string, string> = {
  cleanup: "クリーンアップのみ",
  full: "完全復旧",
};

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function SnapshotSettings(p: AntiCheatViewProps) {
  const snapshots = p.draft.antiNuke.snapshots;
  const patch = (updates: Partial<typeof snapshots>) =>
    p.updateDraft((current) => ({
      ...current,
      antiNuke: {
        ...current.antiNuke,
        snapshots: { ...current.antiNuke.snapshots, ...updates },
      },
    }));
  const [unbanAdded, setUnbanAdded] = useState(true);
  const [rebanSnapshotBans, setRebanSnapshotBans] = useState(false);
  const job = p.activeRestoreJob;
  const jobRunning = job?.status === "running";
  const preview = p.restorePreview;

  return (
    <div className={styles.stack}>
      <article className={styles.card}>
        <div className={styles.cardHeading}>
          <h3>スナップショット</h3>
          <p>
            サーバーのロール・カテゴリ・チャンネル・権限上書き・絵文字・BAN一覧・メンバーのロールを
            Bot側のデータベースへ保存します。Botがキックされても残り、破壊行為のあとで復元できます。
            メッセージ履歴は保存も復元もできません。
          </p>
        </div>
        <div className={styles.automaticRow}>
          <div>
            <h4>定期取得</h4>
            <p>
              有効にすると、各サーバーで一定間隔ごとに自動取得します。手動取得と復元前の安全保存は
              この設定に関係なく動作します。
            </p>
          </div>
          <SettingSwitch
            label="定期スナップショット"
            checked={snapshots.enabled}
            onChange={(enabled) => patch({ enabled })}
          />
          <label className={styles.duration}>
            間隔（時間）
            <input
              type="number"
              min={1}
              max={168}
              required
              value={snapshots.intervalHours}
              disabled={!snapshots.enabled}
              onChange={(event) =>
                patch({ intervalHours: Number(event.target.value) })
              }
            />
            <small>既定 6 時間</small>
          </label>
          <label className={styles.duration}>
            保持する世代
            <input
              type="number"
              min={1}
              max={50}
              required
              value={snapshots.keep}
              onChange={(event) => patch({ keep: Number(event.target.value) })}
            />
            <small>古い世代は自動削除</small>
          </label>
        </div>
        <div className={styles.automaticRow}>
          <div>
            <h4>BAN一覧・絵文字・メンバーのロール</h4>
            <p>
              BAN一覧は復元時の「攻撃で追加されたBANの解除」判定に使います。メンバーのロールは
              @everyone 以外のロールを持つメンバーだけを上限
              {snapshots.memberRoleCap}人まで記録します。
            </p>
          </div>
          <SettingSwitch
            label="BAN一覧を含める"
            checked={snapshots.includeBans}
            onChange={(includeBans) => patch({ includeBans })}
          />
          <SettingSwitch
            label="絵文字を含める"
            checked={snapshots.includeEmojis}
            onChange={(includeEmojis) => patch({ includeEmojis })}
          />
          <SettingSwitch
            label="メンバーのロールを含める"
            checked={snapshots.includeMemberRoles}
            onChange={(includeMemberRoles) => patch({ includeMemberRoles })}
          />
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.activityToolbar}>
          <div>
            <h3>取得済みスナップショット</h3>
            <p>
              {p.snapshotsLoading
                ? "読み込み中…"
                : `${p.snapshots.length}件を保持しています（新しい世代から表示）。`}
            </p>
          </div>
          <div className={styles.saveActions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={p.snapshotsLoading}
              onClick={p.onRefreshSnapshots}
            >
              再取得
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={p.capturingSnapshot || jobRunning}
              onClick={p.onCaptureSnapshot}
            >
              {p.capturingSnapshot ? "取得中…" : "今すぐ取得"}
            </button>
          </div>
        </div>
        {p.snapshotsError && (
          <div role="alert" className={styles.error}>
            {p.snapshotsError}
          </div>
        )}
        {p.snapshots.length === 0 && !p.snapshotsLoading ? (
          <div className={styles.empty}>
            まだスナップショットがありません。「今すぐ取得」で作成できます。
          </div>
        ) : (
          p.snapshots.map((snapshot) => {
            const counts = snapshot.counts;
            return (
              <div className={styles.activityEntry} key={snapshot.id}>
                <div>
                  <strong>
                    {formatDate(snapshot.createdAt)} ·{" "}
                    {SNAPSHOT_TRIGGER_LABELS[snapshot.trigger] || snapshot.trigger}
                  </strong>
                  <small>
                    {snapshot.id} · {formatBytes(snapshot.bytes)}
                  </small>
                  <p>
                    ロール {counts.roles} / カテゴリ {counts.categories} /
                    チャンネル {counts.channels} / 絵文字 {counts.emojis} /
                    BAN {counts.bans} / ロール保持メンバー{" "}
                    {counts.membersWithRoles}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={p.restorePreviewLoading || jobRunning}
                  onClick={() => p.onPreviewRestore(snapshot.id)}
                >
                  復元プレビュー
                </button>
              </div>
            );
          })
        )}
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeading}>
          <h3>自動復旧（インシデント）</h3>
          <p>
            AntiNuke発動後に自動で開始された復旧の状態です。実行中のものは
            「停止」で次の区切りから中断できます（それまでの削除・BAN解除は
            取り消されません）。
          </p>
        </div>
        {p.antiNukeIncidents.length === 0 ? (
          <div className={styles.empty}>インシデントの記録はありません。</div>
        ) : (
          p.antiNukeIncidents.slice(0, 10).map((incident) => {
            const auto = incident.autoRestore;
            const running = auto?.status === "running";
            return (
              <div className={styles.activityEntry} key={incident.id}>
                <div>
                  <strong>
                    {formatDate(incident.detectedAt)} · {incident.ruleLabel}
                  </strong>
                  <small>
                    {incident.id} · 実行者 {incident.actorTag || incident.actorId || "不明"}
                  </small>
                  <p>
                    {auto
                      ? `自動復旧: ${
                          AUTO_RESTORE_STATUS_LABELS[auto.status] || auto.status
                        }（${
                          AUTO_RESTORE_MODE_LABELS[auto.mode] || auto.mode
                        }）${
                          auto.snapshotId ? ` / 復元元 ${auto.snapshotId}` : ""
                        }${auto.jobId ? ` / ジョブ ${auto.jobId}` : ""}${
                          auto.reportId ? ` / レポート ${auto.reportId}` : ""
                        }${auto.error ? ` / ${auto.error}` : ""}`
                      : "自動復旧: 未実行（設定オフまたは停止済み）"}
                    {incident.autoRestoreStopRequested && running
                      ? " / 停止要求済み（次の区切りで停止）"
                      : ""}
                  </p>
                </div>
                {running && !incident.autoRestoreStopRequested && (
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={p.stoppingRestore === incident.id}
                    onClick={() => p.onStopAutoRestore(incident.id)}
                  >
                    {p.stoppingRestore === incident.id ? "停止中…" : "停止"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </article>

      {preview && (
        <article className={styles.card}>
          <div className={styles.cardHeading}>
            <h3>復元プレビュー</h3>
            <p>
              {formatDate(preview.createdAt)} のスナップショット（
              {formatAge(preview.ageSeconds)}）から復元します。
            </p>
          </div>
          <div className={styles.hint}>
            <strong>再作成されるもの</strong>
            <br />
            ロール {preview.recreate.roles} / カテゴリ{" "}
            {preview.recreate.categories} / チャンネル{" "}
            {preview.recreate.channels} / 絵文字 {preview.recreate.emojis} /
            メンバーのロール {preview.recreate.memberRoleHolders}人分 / BAN一覧{" "}
            {preview.recreate.bansInSnapshot}件（再適用は既定で行いません）
          </div>
          <div className={styles.hint}>
            <strong>復元できないもの</strong>
            <br />
            {preview.limitations.map((line) => `・${line}`).join("\n")}
          </div>
          {preview.notes.length > 0 && (
            <div className={styles.hint}>
              <strong>注意</strong>
              <br />
              {preview.notes.map((line) => `・${line}`).join("\n")}
            </div>
          )}
          <div className={styles.hint}>
            <strong>BANの扱い（攻撃期間: {formatDate(preview.incidentWindowStart)} 以降）</strong>
            <br />
            解除対象: {preview.unban.unban.length}件 / 既に解除済み:{" "}
            {preview.unban.alreadyLifted.length}件 / スナップショット時点からBAN中で維持:{" "}
            {preview.unban.keptFromSnapshot.length}件 / AntiNukeがBANした実行者として保護:{" "}
            {preview.unban.protectedUsers.length}件
          </div>
          <div className={styles.automaticRow}>
            <div>
              <h4>実行オプション</h4>
              <p>
                復元の前に、現在の状態を安全スナップショットとして自動保存します。
              </p>
            </div>
            <SettingSwitch
              label="攻撃で追加されたBANを解除する"
              checked={unbanAdded}
              onChange={setUnbanAdded}
            />
            <SettingSwitch
              label="スナップショットのBANを再適用する（既定OFF）"
              checked={rebanSnapshotBans}
              onChange={setRebanSnapshotBans}
            />
          </div>
          <div className={styles.saveActions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={p.restoringSnapshot || jobRunning}
              onClick={p.onCancelRestore}
            >
              キャンセル
            </button>
            <button
              type="button"
              className={styles.danger}
              disabled={p.restoringSnapshot || jobRunning}
              onClick={() =>
                p.onStartRestore(preview.snapshotId, {
                  unbanAdded,
                  rebanSnapshotBans,
                })
              }
            >
              {p.restoringSnapshot ? "実行中…" : "このスナップショットから復元する"}
            </button>
          </div>
        </article>
      )}

      {job && (
        <article className={styles.card}>
          <div className={styles.cardHeading}>
            <h3>復元ジョブ</h3>
            <p>
              {job.status === "running"
                ? `実行中: ${job.phase}（${job.progress.done}/${job.progress.total}）`
                : job.status === "done"
                  ? `完了 ${formatDate(job.finishedAt)}`
                  : `失敗 ${job.error || "理由不明"}`}
            </p>
          </div>
          {job.report && (
            <div className={styles.hint}>
              {Object.entries(job.report.totals).map(([kind, totals]) => (
                <div key={kind}>
                  {RESTORE_KIND_LABELS[kind] || kind}: 復元 {totals.restored} /
                  スキップ {totals.skipped} / 失敗 {totals.failed}
                </div>
              ))}
              <div>
                安全スナップショット: {job.report.safetySnapshotId || "取得できませんでした"}
              </div>
              <div>BAN解除: {job.report.unbanned.length}件</div>
            </div>
          )}
        </article>
      )}

      {p.restoreJobs.length > 0 && (
        <article className={styles.card}>
          <div className={styles.cardHeading}>
            <h3>復元履歴</h3>
            <p>直近{p.restoreJobs.length}件の復元ジョブです。</p>
          </div>
          {p.restoreJobs.map((entry) => (
            <div className={styles.activityEntry} key={entry.id}>
              <div>
                <strong>
                  {formatDate(entry.startedAt)} ·{" "}
                  {entry.status === "done"
                    ? "完了"
                    : entry.status === "stopped"
                      ? "停止"
                      : entry.status === "failed"
                        ? "失敗"
                        : "実行中"}
                </strong>
                <small>
                  {entry.id} · 復元元 {entry.snapshotId} · 実行者{" "}
                  {entry.requestedBy || "不明"}
                </small>
                <p>
                  {entry.status === "running"
                    ? `${entry.phase}（${entry.progress.done}/${entry.progress.total}）`
                    : entry.error || "レポートを保存しました"}
                </p>
              </div>
            </div>
          ))}
        </article>
      )}
    </div>
  );
}
