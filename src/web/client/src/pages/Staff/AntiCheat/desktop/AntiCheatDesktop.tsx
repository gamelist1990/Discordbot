import React, { useState } from "react";
import {
  DetectorEditor,
  GeneralEditor,
  PolicyEditor,
} from "../components/SettingsEditors";
import { formatDate, formatRemaining } from "../model";
import type { AntiCheatViewProps, SettingsSection } from "../viewTypes";
import styles from "./AntiCheatDesktop.module.css";

export default function AntiCheatDesktop(p: AntiCheatViewProps) {
  const [section, setSection] = useState<SettingsSection>("general");
  const editorProps = { ...p, styles, accordion: true };
  return (
    <div className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>AntiCheat control center</span>
          <h1>{p.guildName} の保護管理</h1>
          <p>監視と設定を一画面で判断できるデスクトップ構成です。</p>
        </div>
        <button type="button" className={styles.secondary} onClick={p.onBack}>
          サーバー管理へ
        </button>
      </header>
      <div className={styles.metrics}>
        <article>
          <span>保護状態</span>
          <strong>{p.draft.enabled ? "稼働中" : "停止中"}</strong>
        </article>
        <article>
          <span>Raid</span>
          <strong>{p.draft.raidMode.active ? "発動中" : "待機"}</strong>
        </article>
        <article>
          <span>タイムアウト</span>
          <strong>{p.activeTimeouts.length}</strong>
        </article>
      </div>
      <div className={styles.noticeArea}>
        {p.saveNotice && <div className={styles.success}>{p.saveNotice}</div>}
        {[p.actionError].filter(Boolean).map((x, i) => (
          <div className={styles.error} key={i}>
            {x}
          </div>
        ))}
      </div>
      <main className={styles.dashboard}>
        <section className={styles.monitor}>
          <div className={styles.sectionTitle}>
            <div>
              <span>Monitoring</span>
              <h2>監視ダッシュボード</h2>
            </div>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                p.onRefreshTimeouts();
                p.onRefreshLogs();
                p.onRefreshTrust();
              }}
            >
              全再取得
            </button>
          </div>
          <article className={styles.card}>
            <div className={styles.row}>
              <h3>現在のタイムアウト</h3>
              <button
                type="button"
                className={styles.secondary}
                onClick={p.onRefreshTimeouts}
              >
                再取得
              </button>
            </div>
            {p.timeoutsError && (
              <p className={styles.error}>{p.timeoutsError}</p>
            )}
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>ユーザー</th>
                    <th>残り</th>
                    <th>根拠</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {p.activeTimeouts.map((x) => (
                    <tr key={x.userId}>
                      <td>
                        <strong>{x.displayName || x.username}</strong>
                        <small>{x.userId}</small>
                      </td>
                      <td>{formatRemaining(x.remainingMs)}</td>
                      <td>
                        {x.sourceDetector || "不明"}
                        <small>{x.sourceReason}</small>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.danger}
                          disabled={p.executing}
                          onClick={() => p.onRevokeActiveTimeout(x)}
                        >
                          解除
                        </button>{" "}
                      </td>
                    </tr>
                  ))}
                  {!p.activeTimeouts.length && (
                    <tr>
                      <td colSpan={4}>対象者はいません。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
          <div className={styles.twoColumns}>
            <article className={styles.card}>
              <div className={styles.row}>
                <h3>最新ログ</h3>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={p.onRefreshLogs}
                >
                  再取得
                </button>
              </div>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>検知</th>
                      <th>スコア</th>
                      <th>日時</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.logs.map((x) => (
                      <tr key={`${x.messageId}-${x.timestamp}`}>
                        <td>
                          <strong>{x.detector}</strong>
                          <small>{x.reason}</small>
                        </td>
                        <td>{x.scoreDelta}</td>
                        <td>{formatDate(x.timestamp)}</td>
                        <td>
                          {x.metadata?.isTimedOut && (
                            <button
                              type="button"
                              className={styles.danger}
                              onClick={() => p.onRevokeLogTimeout(x)}
                            >
                              解除
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            <article className={styles.card}>
              <div className={styles.row}>
                <h3>信頼スコア</h3>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={p.onRefreshTrust}
                >
                  再取得
                </button>
              </div>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>ユーザー</th>
                      <th>スコア</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.trustEntries.map((x) => (
                      <tr key={x.userId}>
                        <td>
                          <strong>{x.displayName || x.username}</strong>
                          <small>{x.userId}</small>
                        </td>
                        <td>{x.score}</td>
                        <td>
                          <button
                            type="button"
                            className={styles.danger}
                            onClick={() => p.onResetTrust(x.userId)}
                          >
                            リセット
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      </main>
      <section className={styles.settings}>
        <div className={styles.sectionTitle}>
          <div>
            <span>Configuration</span>
            <h2>設定</h2>
          </div>
        </div>
        <nav className={styles.settingsNav} aria-label="設定カテゴリ">
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
              aria-current={section === id ? "page" : undefined}
              className={section === id ? styles.activeTab : ""}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {section === "general" && <GeneralEditor {...editorProps} />}{" "}
        {section === "detectors" && <DetectorEditor {...editorProps} />}{" "}
        {section === "policies" && <PolicyEditor {...editorProps} />}
      </section>
      <div className={styles.saveBar}>
        <span className={p.dirty ? styles.unsaved : styles.saved}>
          {p.dirty ? "未保存の変更があります" : "保存済み"}
        </span>
        <button
          type="button"
          className={styles.primary}
          disabled={p.saving || !p.dirty}
          onClick={p.onSave}
        >
          {p.saving ? "保存中..." : "設定を保存"}
        </button>
      </div>
    </div>
  );
}
