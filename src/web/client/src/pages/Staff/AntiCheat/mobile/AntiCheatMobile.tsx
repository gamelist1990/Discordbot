import { useState } from "react";
import {
  DetectorEditor,
  GeneralEditor,
  PolicyEditor,
} from "../components/SettingsEditors";
import { formatDate, formatRemaining } from "../model";
import type { AntiCheatViewProps } from "../viewTypes";
import styles from "./AntiCheatMobile.module.css";

type Tab = "urgent" | "alerts" | "activity" | "settings";
type Setting = "general" | "detectors" | "policies";
export default function AntiCheatMobile(p: AntiCheatViewProps) {
  const [tab, setTab] = useState<Tab>("urgent");
  const [setting, setSetting] = useState<Setting>("general");
  const ep = { ...p, styles, accordion: true };
  return (
    <div className={styles.shell}>
      <header className={styles.hero}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={p.onBack}
          aria-label="サーバー管理へ戻る"
        >
          ←
        </button>
        <div>
          <span>AntiCheat</span>
          <h1>{p.guildName}</h1>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => {
            p.onRefreshTimeouts();
            p.onRefreshLogs();
            p.onRefreshTrust();
          }}
          aria-label="全再取得"
        >
          ↻
        </button>
      </header>
      <div className={styles.status}>
        <strong>{p.draft.enabled ? "保護稼働中" : "保護停止中"}</strong>
        <span>
          Raid {p.draft.raidMode.active ? "発動中" : "待機"} · Timeout{" "}
          {p.activeTimeouts.length}
        </span>
      </div>
      <nav className={styles.tabs} aria-label="AntiCheatメニュー">
        {(
          [
            ["urgent", "緊急"],
            ["alerts", "異常"],
            ["activity", "ログ"],
            ["settings", "設定"],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? styles.active : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className={styles.notices}>
        {p.saveNotice && <div className={styles.success}>{p.saveNotice}</div>}
        {[p.actionError].filter(Boolean).map((e, i) => (
          <div className={styles.error} key={i}>
            {e}
          </div>
        ))}
      </div>
      {tab === "urgent" && (
        <main className={styles.stack}>
          <div className={styles.heading}>
            <span>Emergency</span>
            <h2>緊急対応</h2>
            <p>現在のタイムアウトを優先して処理します。</p>
          </div>
          {p.activeTimeouts.length === 0 ? (
            <div className={styles.empty}>
              緊急対応が必要なユーザーはいません。
            </div>
          ) : (
            p.activeTimeouts.map((x) => (
              <article className={styles.card} key={x.userId}>
                <div className={styles.row}>
                  <div>
                    <strong>{x.displayName || x.username}</strong>
                    <small>{x.userId}</small>
                  </div>
                  <b>{formatRemaining(x.remainingMs)}</b>
                </div>
                <p>
                  {x.sourceDetector || "不明"} ·{" "}
                  {x.sourceReason || `スコア ${x.trustScore}`}
                </p>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.danger}
                    onClick={() => p.onRevokeActiveTimeout(x)}
                  >
                    タイムアウト解除
                  </button>
                </div>
              </article>
            ))
          )}
        </main>
      )}
      {tab === "alerts" && (
        <main className={styles.stack}>
          <div className={styles.heading}>
            <span>Alerts</span>
            <h2>検知された異常</h2>
          </div>
          {p.logs.map((x) => (
            <article
              className={styles.card}
              key={`${x.messageId}-${x.timestamp}`}
            >
              <div className={styles.row}>
                <strong>{x.detector}</strong>
                <b>+{x.scoreDelta}</b>
              </div>
              <p>{x.reason}</p>
              <small>{formatDate(x.timestamp)}</small>
              {x.metadata?.isTimedOut && (
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => p.onRevokeLogTimeout(x)}
                >
                  タイムアウト解除
                </button>
              )}
            </article>
          ))}
        </main>
      )}
      {tab === "activity" && (
        <main className={styles.stack}>
          <div className={styles.heading}>
            <span>Trust</span>
            <h2>ログ / 信頼スコア</h2>
          </div>
          {p.trustEntries.map((x) => (
            <article className={styles.card} key={x.userId}>
              <div className={styles.row}>
                <div>
                  <strong>{x.displayName || x.username}</strong>
                  <small>{x.userId}</small>
                </div>
                <b>スコア {x.score}</b>
              </div>
              <small>更新 {formatDate(x.lastUpdated)}</small>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => p.onResetTrust(x.userId)}
                >
                  スコアリセット
                </button>
              </div>
            </article>
          ))}
        </main>
      )}
      {tab === "settings" && (
        <main className={styles.stack}>
          <div className={styles.heading}>
            <span>Configuration</span>
            <h2>設定</h2>
          </div>
          <nav className={styles.settingTabs}>
            {(
              [
                ["general", "全体"],
                ["detectors", "Detector"],
                ["policies", "除外・処罰"],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-current={setting === id ? "page" : undefined}
                className={setting === id ? styles.active : ""}
                onClick={() => setSetting(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {setting === "general" && <GeneralEditor {...ep} />}{" "}
          {setting === "detectors" && <DetectorEditor {...ep} />}{" "}
          {setting === "policies" && <PolicyEditor {...ep} />}
        </main>
      )}
      <div className={styles.saveBar}>
        <span className={p.dirty ? styles.unsaved : styles.saved}>
          {p.dirty ? "未保存" : "保存済み"}
        </span>
        <button
          type="button"
          className={styles.primary}
          disabled={p.saving || !p.dirty}
          onClick={p.onSave}
        >
          {p.saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}
