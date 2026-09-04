import { ExclusionEditor } from './ExclusionEditor';
import type { AntiCheatViewProps, DetectorDefinition } from "../viewTypes";
import { ContentSafetyControls, SettingSwitch } from './ContentSafetyControls';
import { formatDate, readNumber, toTextList } from "../model";
import type {
  DetectorConfig,
  PunishmentAction,
  WordFilterRule,
} from "../types";

type Styles = Record<string, string>;
type Props = Pick<
  AntiCheatViewProps,
  | "draft"
  | "guildId"
  | "detectors"
  | "wordFilterRules"
  | "excludedRolesText"
  | "excludedChannelsText"
  | "setExcludedRolesText"
  | "setExcludedChannelsText"
  | "updateDraft"
  | "updateDetector"
  | "updateDetectorConfig"
  | "updateListDetectorConfig"
  | "addWordRule"
  | "updateWordRule"
  | "removeWordRule"
  | "addPunishment"
  | "updatePunishment"
  | "removePunishment"
  | "addAction"
  | "updateAction"
  | "removeAction"
> & { styles: Styles; accordion?: boolean };

const modeLabel = (mode: WordFilterRule["mode"]) =>
  ({ contains: "含む", exact: "完全一致", regex: "正規表現" })[mode];

function WordRules({
  detector,
  props,
}: {
  detector: DetectorConfig;
  props: Props;
}) {
  const s = props.styles;
  return (
    <div className={s.wide}>
      <div className={s.row}>
        <strong>フィルタールール</strong>
        <button
          type="button"
          className={s.secondary}
          onClick={props.addWordRule}
          disabled={!detector.enabled}
        >
          ルール追加
        </button>
      </div>
      {props.wordFilterRules.length === 0 ? (
        <p className={s.empty}>ルールはありません。</p>
      ) : (
        props.wordFilterRules.map((rule) => (
          <div className={s.subCard} key={rule.id}>
            <label>
              ラベル
              <input
                value={rule.label}
                onChange={(e) =>
                  props.updateWordRule(rule.id, { label: e.target.value })
                }
                disabled={!detector.enabled}
              />
            </label>
            <label>
              一致方法
              <select
                value={rule.mode}
                onChange={(e) =>
                  props.updateWordRule(rule.id, {
                    mode: e.target.value as WordFilterRule["mode"],
                  })
                }
                disabled={!detector.enabled}
              >
                <option value="contains">{modeLabel("contains")}</option>
                <option value="exact">{modeLabel("exact")}</option>
                <option value="regex">{modeLabel("regex")}</option>
              </select>
            </label>
            <label className={s.wide}>
              パターン
              <input
                value={rule.pattern}
                onChange={(e) =>
                  props.updateWordRule(rule.id, { pattern: e.target.value })
                }
                disabled={!detector.enabled}
              />
            </label>
            <label>
              加算スコア
              <input
                type="number"
                min={0}
                value={rule.score}
                onChange={(e) =>
                  props.updateWordRule(rule.id, {
                    score: Number(e.target.value),
                  })
                }
                disabled={!detector.enabled}
              />
            </label>
            <label className={s.check}>
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) =>
                  props.updateWordRule(rule.id, { enabled: e.target.checked })
                }
                disabled={!detector.enabled}
              />
              有効
            </label>
            <label className={s.check}>
              <input
                type="checkbox"
                checked={Boolean(rule.deleteMessage)}
                onChange={(e) =>
                  props.updateWordRule(rule.id, {
                    deleteMessage: e.target.checked,
                  })
                }
                disabled={!detector.enabled || !props.draft.autoDelete.enabled}
              />
              メッセージ削除
            </label>
            <button
              type="button"
              className={s.danger}
              onClick={() => props.removeWordRule(rule.id)}
              disabled={!detector.enabled}
            >
              削除
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function DetectorBody({
  definition,
  props,
}: {
  definition: DetectorDefinition;
  props: Props;
}) {
  const s = props.styles;
  const detector = props.draft.detectors[definition.key];
  if (!detector) return null;
  return (
    <div className={s.formGrid}>
      {definition.key === 'contentSafety' && <div className={s.wide}>
        <ContentSafetyControls guildId={props.guildId} action={detector.config?.action === 'delete' ? 'delete' : 'spoiler'} disabled={!detector.enabled}
          onChange={(action) => props.updateDetectorConfig(definition.key, 'action', action)} />
      </div>}
      {definition.key !== 'contentSafety' && <>
      <label>
        加算スコア
        <input
          type="number"
          min={0}
          value={detector.score}
          onChange={(e) =>
            props.updateDetector(definition.key, {
              score: Number(e.target.value),
            })
          }
          disabled={!detector.enabled}
        />
      </label>
      <label className={s.check}>
        <input
          type="checkbox"
          checked={Boolean(detector.deleteMessage)}
          onChange={(e) =>
            props.updateDetector(definition.key, {
              deleteMessage: e.target.checked,
            })
          }
          disabled={!detector.enabled || !props.draft.autoDelete.enabled}
        />
        メッセージ削除
      </label>
      <label className={s.check}>
        <input
          type="checkbox"
          checked={Boolean(detector.notifyChannel)}
          onChange={(e) =>
            props.updateDetector(definition.key, {
              notifyChannel: e.target.checked,
            })
          }
          disabled={!detector.enabled}
        />
        公開通知
      </label>
      </>}
      {definition.key === "wordFilter" ? (
        <WordRules detector={detector} props={props} />
      ) : (
        definition.fields?.map((field) => field.kind === 'toggle' ? (
          <SettingSwitch key={field.key} label={field.label} checked={(detector.config?.[field.key] ?? field.defaultValue) === 1}
            onChange={(checked) => props.updateDetectorConfig(definition.key, field.key, checked ? 1 : 0)} disabled={!detector.enabled} />
        ) : (
          <label key={field.key} className={field.wide ? s.wide : undefined}>
            {field.label}
            {field.kind === "list" ? (
              <textarea
                value={toTextList(detector.config?.[field.key])}
                onChange={(e) =>
                  props.updateListDetectorConfig(
                    definition.key,
                    field.key,
                    e.target.value,
                  )
                }
                placeholder={field.placeholder}
                disabled={!detector.enabled}
              />
            ) : (
              <input
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                value={readNumber(
                  detector.config?.[field.key],
                  field.defaultValue || 0,
                )}
                onChange={(e) =>
                  props.updateDetectorConfig(
                    definition.key,
                    field.key,
                    Number(e.target.value),
                  )
                }
                disabled={!detector.enabled}
              />
            )}
          </label>
        ))
      )}
    </div>
  );
}

export function GeneralEditor(props: Props) {
  const s = props.styles;
  const d = props.draft;
  return (
    <div className={s.editorGrid}>
      <article className={s.card}>
        <div className={s.row}>
          <div>
            <h3>保護スイッチ</h3>
            <p>サーバー全体の検知を制御します。</p>
          </div>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={d.enabled}
              onChange={(e) =>
                props.updateDraft((c) => ({ ...c, enabled: e.target.checked }))
              }
            />
            {d.enabled ? "有効" : "停止"}
          </label>
        </div>
        <div className={s.formGrid}>
          <label>
            検知ログチャンネル ID
            <input
              value={d.logChannelId || ""}
              onChange={(e) =>
                props.updateDraft((c) => ({
                  ...c,
                  logChannelId: e.target.value || null,
                }))
              }
            />
          </label>
          <label>
            アバターログチャンネル ID
            <input
              value={d.avatarLogChannelId || ""}
              onChange={(e) =>
                props.updateDraft((c) => ({
                  ...c,
                  avatarLogChannelId: e.target.value || null,
                }))
              }
            />
          </label>
          <label>
            Chatlogチャンネル ID
            <input
              value={d.chatLogChannelId || ""}
              onChange={(e) =>
                props.updateDraft((c) => ({
                  ...c,
                  chatLogChannelId: e.target.value || null,
                }))
              }
            />
          </label>
        </div>
      </article>
      <article className={s.card}>
        <h3>自動処理</h3>
        <div className={s.formGrid}>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={d.autoDelete.enabled}
              onChange={(e) =>
                props.updateDraft((c) => ({
                  ...c,
                  autoDelete: { ...c.autoDelete, enabled: e.target.checked },
                }))
              }
            />
            自動削除
          </label>
          <label>
            削除対象秒数
            <input
              type="number"
              min={1}
              value={d.autoDelete.windowSeconds}
              onChange={(e) =>
                props.updateDraft((c) => ({
                  ...c,
                  autoDelete: {
                    ...c.autoDelete,
                    windowSeconds: Number(e.target.value),
                  },
                }))
              }
              disabled={!d.autoDelete.enabled}
            />
          </label>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={d.autoTimeout.enabled}
              onChange={(e) =>
                props.updateDraft((c) => ({
                  ...c,
                  autoTimeout: { ...c.autoTimeout, enabled: e.target.checked },
                }))
              }
            />
            自動タイムアウト
          </label>
          <label>
            タイムアウト秒数
            <input
              type="number"
              min={1}
              value={d.autoTimeout.durationSeconds}
              onChange={(e) =>
                props.updateDraft((c) => ({
                  ...c,
                  autoTimeout: {
                    ...c.autoTimeout,
                    durationSeconds: Number(e.target.value),
                  },
                }))
              }
              disabled={!d.autoTimeout.enabled}
            />
          </label>
        </div>
        <p>
          Raid: {d.raidMode.active ? "発動中" : "待機中"} / 最新発動{" "}
          {formatDate(d.raidMode.activatedAt)}
        </p>
      </article>
    </div>
  );
}

export function DetectorEditor(props: Props) {
  const s = props.styles;
  return (
    <div className={s.stack}>
      {props.detectors.map((def) => {
        const detector = props.draft.detectors[def.key];
        if (!detector) return null;
        return props.accordion ? (
          <details className={s.card} key={def.key}>
            <summary aria-expanded={undefined}>
              <span>
                <strong>{def.title}</strong>
                <small>{def.description}</small>
              </span>
              <label className={s.check} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={detector.enabled}
                  onChange={(e) =>
                    props.updateDetector(def.key, { enabled: e.target.checked })
                  }
                />
                有効
              </label>
            </summary>
            <DetectorBody definition={def} props={props} />
          </details>
        ) : (
          <article className={s.card} key={def.key}>
            <div className={s.row}>
              <div>
                <h3>{def.title}</h3>
                <p>{def.description}</p>
              </div>
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={detector.enabled}
                  onChange={(e) =>
                    props.updateDetector(def.key, { enabled: e.target.checked })
                  }
                />
                {detector.enabled ? "有効" : "無効"}
              </label>
            </div>
            <DetectorBody definition={def} props={props} />
          </article>
        );
      })}
    </div>
  );
}

export function PolicyEditor(props: Props) {
  const s = props.styles;
  return (
    <div className={s.editorGrid}>
      <article className={s.card}>
        <h3>除外対象</h3>
        <ExclusionEditor key={props.guildId} guildId={props.guildId}
          rolesText={props.excludedRolesText} channelsText={props.excludedChannelsText}
          onRoles={props.setExcludedRolesText} onChannels={props.setExcludedChannelsText}
          policies={props.draft.channelDetectorExclusions || {}} detectors={props.detectors}
          onPolicies={channelDetectorExclusions => props.updateDraft(current => ({ ...current, channelDetectorExclusions }))} />
      </article>
      <article className={s.card}>
        <div className={s.row}>
          <div>
            <h3>処罰しきい値</h3>
            <p>スコア到達時の処置を設定します。</p>
          </div>
          <button
            type="button"
            className={s.secondary}
            onClick={props.addPunishment}
          >
            しきい値追加
          </button>
        </div>
        {props.draft.punishments.map((punishment, ti) => (
          <div className={s.subCard} key={ti}>
            <div className={s.row}>
              <label>
                しきい値
                <input
                  type="number"
                  min={0}
                  value={punishment.threshold}
                  onChange={(e) =>
                    props.updatePunishment(ti, {
                      threshold: Number(e.target.value),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className={s.danger}
                onClick={() => props.removePunishment(ti)}
              >
                削除
              </button>
            </div>
            {punishment.actions.map((action, ai) => (
              <div className={s.formGrid} key={ai}>
                <label>
                  処置
                  <select
                    value={action.type}
                    onChange={(e) =>
                      props.updateAction(ti, ai, {
                        type: e.target.value as PunishmentAction["type"],
                      })
                    }
                  >
                    <option value="timeout">timeout</option>
                    <option value="kick">kick</option>
                    <option value="ban">ban</option>
                  </select>
                </label>
                <label>
                  秒数
                  <input
                    type="number"
                    min={1}
                    value={action.durationSeconds || 600}
                    onChange={(e) =>
                      props.updateAction(ti, ai, {
                        durationSeconds: Number(e.target.value),
                      })
                    }
                    disabled={action.type !== "timeout"}
                  />
                </label>
                <label className={s.wide}>
                  理由
                  <input
                    value={action.reasonTemplate || ""}
                    onChange={(e) =>
                      props.updateAction(ti, ai, {
                        reasonTemplate: e.target.value,
                      })
                    }
                  />
                </label>
                <label className={s.check}>
                  <input
                    type="checkbox"
                    checked={Boolean(action.notify)}
                    onChange={(e) =>
                      props.updateAction(ti, ai, { notify: e.target.checked })
                    }
                  />
                  通知
                </label>
                <button
                  type="button"
                  className={s.secondary}
                  onClick={() => props.addAction(ti)}
                >
                  処置追加
                </button>
                {punishment.actions.length > 1 && (
                  <button
                    type="button"
                    className={s.danger}
                    onClick={() => props.removeAction(ti, ai)}
                  >
                    処置削除
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </article>
    </div>
  );
}
