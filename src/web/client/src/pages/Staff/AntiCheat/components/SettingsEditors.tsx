import { ExclusionEditor } from "./ExclusionEditor";
import { useEffect, useState } from "react";
import type { AntiCheatViewProps, DetectorDefinition } from "../viewTypes";
import { ContentSafetyControls, SettingSwitch } from "./ContentSafetyControls";
import { parseListText, readNumber, toTextList } from "../model";
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
> & { styles: Styles; area?: "exclusions" | "punishments" };

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
                aria-label="一致方法"
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

export function DetectorBody({
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
      {definition.key === "contentSafety" && (
        <div className={s.wide}>
          <ContentSafetyControls
            guildId={props.guildId}
            action={detector.config?.action === "delete" ? "delete" : "spoiler"}
            disabled={!detector.enabled}
            onChange={(action) =>
              props.updateDetectorConfig(definition.key, "action", action)
            }
          />
        </div>
      )}
      {definition.key !== "contentSafety" && (
        <>
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
        </>
      )}
      {definition.key === "wordFilter" ? (
        <WordRules detector={detector} props={props} />
      ) : definition.key === "contentSafety" ? (
        <div className={s.wide}>
          {[
            {
              title: "検査する投稿",
              keys: ["scanImages", "scanText", "scanUrls"],
            },
            {
              title: "検知する内容",
              keys: [
                "suggestive",
                "explicit",
                "harassment",
                "hate",
                "threat",
                "violence",
              ],
            },
            {
              title: "スコアと独自ルール",
              keys: [
                "awardScore",
                "maxAiScore",
                "customRulesChannelId",
                "customRulesMessageId",
              ],
            },
          ].map((group) => (
            <section className={s.fieldSection} key={group.title}>
              <h4>{group.title}</h4>
              <div className={s.formGrid}>
                {definition.fields
                  ?.filter((field) => group.keys.includes(field.key))
                  .map((field) => (
                    <ConfigField
                      key={field.key}
                      field={field}
                      definition={definition}
                      props={props}
                    />
                  ))}
              </div>
            </section>
          ))}
          <details className={s.advanced}>
            <summary>詳細設定：判定の厳しさ・キャッシュ・取得上限</summary>
            <p>
              通常は現在の値のまま利用できます。しきい値を下げると、より多くの投稿を検知します。
            </p>
            <div className={s.formGrid}>
              {definition.fields
                ?.filter(
                  (field) =>
                    ![
                      "scanImages",
                      "scanText",
                      "scanUrls",
                      "suggestive",
                      "explicit",
                      "harassment",
                      "hate",
                      "threat",
                      "violence",
                      "awardScore",
                      "maxAiScore",
                      "customRulesChannelId",
                      "customRulesMessageId",
                    ].includes(field.key),
                )
                .map((field) => (
                  <ConfigField
                    key={field.key}
                    field={field}
                    definition={definition}
                    props={props}
                  />
                ))}
            </div>
          </details>
        </div>
      ) : (
        definition.fields?.map((field) => (
          <ConfigField
            key={field.key}
            field={field}
            definition={definition}
            props={props}
          />
        ))
      )}
    </div>
  );
}

function ConfigField({
  field,
  definition,
  props,
}: {
  field: NonNullable<DetectorDefinition["fields"]>[number];
  definition: DetectorDefinition;
  props: Props;
}) {
  const detector = props.draft.detectors[definition.key];
  if (field.kind === "toggle")
    return (
      <SettingSwitch
        label={field.label}
        checked={(detector.config?.[field.key] ?? field.defaultValue) === 1}
        disabled={!detector.enabled}
        onChange={(checked) =>
          props.updateDetectorConfig(definition.key, field.key, checked ? 1 : 0)
        }
      />
    );
  if (field.kind === "list")
    return (
      <label className={props.styles.wide}>
        {field.label}
        <ListInput
          label={field.label}
          value={toTextList(detector.config?.[field.key])}
          placeholder={field.placeholder}
          disabled={!detector.enabled}
          onChange={(value) =>
            props.updateListDetectorConfig(definition.key, field.key, value)
          }
        />
      </label>
    );
  return (
    <label className={field.wide ? props.styles.wide : undefined}>
      {field.label}
      <input
        type={field.kind === "text" ? "text" : "number"}
        value={
          field.kind === "text"
            ? String(detector.config?.[field.key] ?? "")
            : readNumber(detector.config?.[field.key], field.defaultValue ?? 0)
        }
        min={field.min}
        max={field.max}
        step={field.step}
        placeholder={field.placeholder}
        disabled={!detector.enabled}
        onChange={(e) =>
          props.updateDetectorConfig(
            definition.key,
            field.key,
            field.kind === "text" ? e.target.value : Number(e.target.value),
          )
        }
      />
    </label>
  );
}

function ListInput({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  // Preserve trailing newlines while typing, but restore server/draft resets.
  useEffect(() => {
    setText((current) =>
      toTextList(parseListText(current)) === value ? current : value,
    );
  }, [value]);
  return (
    <textarea
      aria-label={label}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value);
      }}
    />
  );
}

export function PolicyEditor(props: Props) {
  const s = props.styles;
  return (
    <div className={s.editorGrid}>
      {props.area !== "punishments" && (
        <article className={s.card}>
          <h3>除外対象</h3>
          <ExclusionEditor
            key={props.guildId}
            guildId={props.guildId}
            rolesText={props.excludedRolesText}
            channelsText={props.excludedChannelsText}
            onRoles={props.setExcludedRolesText}
            onChannels={props.setExcludedChannelsText}
            policies={props.draft.channelDetectorExclusions || {}}
            detectors={props.detectors}
            onPolicies={(channelDetectorExclusions) =>
              props.updateDraft((current) => ({
                ...current,
                channelDetectorExclusions,
              }))
            }
          />
        </article>
      )}
      {props.area !== "exclusions" && (
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
          {props.draft.punishments.length === 0 && (
            <div className={s.empty}>
              <strong>自動処罰ルールはありません</strong>
              <p>
                「しきい値追加」から、スコアに応じたタイムアウト・キック・BANを設定できます。
              </p>
            </div>
          )}
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
                <div className={`${s.formGrid} ${s.actionCard}`} key={ai}>
                  <label>
                    処置
                    <select
                      aria-label="処置"
                      value={action.type}
                      onChange={(e) =>
                        props.updateAction(ti, ai, {
                          type: e.target.value as PunishmentAction["type"],
                        })
                      }
                    >
                      <option value="timeout">タイムアウト</option>
                      <option value="kick">キック</option>
                      <option value="ban">BAN</option>
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
              <button
                type="button"
                className={s.secondary}
                onClick={() => props.addAction(ti)}
              >
                処置追加
              </button>
            </div>
          ))}
        </article>
      )}
    </div>
  );
}
