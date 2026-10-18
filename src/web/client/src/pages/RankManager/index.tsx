import { useEffect, useState } from "react";
import {
  ServerWorkspace,
  useResource,
  useAction,
  Feedback,
  ResourceState,
  ChannelSelect,
  RoleSelect,
  SaveBar,
  Tabs,
  request,
  confirmWorkspaceLeave,
  useUnsavedChanges,
  ui,
  type Channel,
  type Role,
} from "../../components/Workspace/Workspace";
type Tier = {
  name: string;
  minXp: number;
  maxXp: number;
  color?: string;
  icon?: string;
};
type Reward = {
  rankName: string;
  giveRoleId?: string;
  notify?: boolean;
  webhookUrl?: string;
  customMessage?: string;
};
type Preset = {
  name: string;
  description?: string;
  ranks: Tier[];
  rewards: Reward[];
};
type Settings = {
  notifyChannelId?: string;
  updateIntervalMs: number;
  xpRates: {
    messageXp: number;
    messageXpMin?: number;
    messageXpMax?: number;
    messageCooldownSec: number;
    vcXpPerMinute: number;
    vcXpPerMinuteMin?: number;
    vcXpPerMinuteMax?: number;
    vcIntervalSec: number;
    dailyXpCap: number;
    excludeChannels: string[];
    excludeRoles: string[];
    globalMultiplier: number;
  };
};
type Rule = {
  id: string;
  name: string;
  actionType: "message" | "reaction" | "voiceChat" | "invite" | "custom";
  description?: string;
  channels?: string[];
  roles?: string[];
  xpReward: number;
  xpRewardMin?: number;
  xpRewardMax?: number;
  cooldownSec?: number;
  maxPerDay?: number;
  isActive: boolean;
};
type Panel = {
  preset: string;
  channelId: string;
  messageId: string;
  lastUpdate: string;
  topCount?: number;
};
type Tab = "presets" | "settings" | "rules" | "panels" | "reset";
const base = "/api/staff/rankmanager";
export default function RankManagerPage() {
  return (
    <ServerWorkspace
      title="ランキング管理"
      description="ランク、XPの獲得条件、報酬とランキングパネルを順番に設定できます。"
    >
      {(guild) => <Ranking guildId={guild.id} guildName={guild.name} />}
    </ServerWorkspace>
  );
}
function Ranking({
  guildId,
  guildName,
}: {
  guildId: string;
  guildName: string;
}) {
  const [tab, setTab] = useState<Tab>("presets");
  const presets = useResource<Preset[]>(`${base}/presets?guildId=${guildId}`);
  const channels = useResource<{ channels: Channel[] }>(
    `/api/staff/guilds/${guildId}/channels`,
  );
  const roles = useResource<{ roles: Role[] }>(
    `/api/staff/guilds/${guildId}/roles`,
  );
  return (
    <>
      <Tabs
        value={tab}
        onChange={(next) => {
          if (confirmWorkspaceLeave()) setTab(next);
        }}
        options={[
          ["presets", "ランクと報酬"],
          ["settings", "XPの基本設定"],
          ["rules", "XP獲得ルール"],
          ["panels", "投稿済みパネル"],
          ["reset", "データのリセット"],
        ]}
      />
      {presets.loading ||
      presets.error ||
      channels.loading ||
      channels.error ||
      roles.loading ||
      roles.error ? (
        <ResourceState
          loading={presets.loading || channels.loading || roles.loading}
          error={presets.error || channels.error || roles.error}
          retry={() => {
            presets.reload();
            channels.reload();
            roles.reload();
          }}
        />
      ) : (
        <>
          {tab === "presets" && (
            <PresetManager
              guildId={guildId}
              presets={presets.data || []}
              reload={presets.reload}
              roles={roles.data?.roles || []}
            />
          )}
          {tab === "settings" && (
            <XpSettings
              guildId={guildId}
              channels={channels.data?.channels || []}
              roles={roles.data?.roles || []}
            />
          )}
          {tab === "rules" && (
            <Rules
              guildId={guildId}
              presets={presets.data || []}
              channels={channels.data?.channels || []}
              roles={roles.data?.roles || []}
            />
          )}
          {tab === "panels" && (
            <Panels
              guildId={guildId}
              channels={channels.data?.channels || []}
            />
          )}
          {tab === "reset" && <Reset guildId={guildId} guildName={guildName} />}
        </>
      )}
    </>
  );
}
function PresetManager({
  guildId,
  presets,
  reload,
  roles,
}: {
  guildId: string;
  presets: Preset[];
  reload: () => void;
  roles: Role[];
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Preset | null>(null);
  const [originalName, setOriginalName] = useState("");
  const [baseline, setBaseline] = useState("");
  const action = useAction();
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const edit = (value?: Preset) => {
    if (!confirmWorkspaceLeave()) return;
    const next = structuredClone(
      value || {
        name: "",
        description: "",
        ranks: [{ name: "ビギナー", minXp: 0, maxXp: 100, color: "#6b8e7e" }],
        rewards: [],
      },
    );
    setDraft(next);
    setOriginalName(value?.name || "");
    setBaseline(value ? JSON.stringify(next) : "");
  };
  const patch = (value: Partial<Preset>) =>
    setDraft((current) => (current ? { ...current, ...value } : current));
  const rank = (index: number, value: Partial<Tier>) => {
    if (draft)
      patch({
        ranks: draft.ranks.map((entry, i) =>
          i === index ? { ...entry, ...value } : entry,
        ),
      });
  };
  const reward = (index: number, value: Partial<Reward>) => {
    if (draft)
      patch({
        rewards: draft.rewards.map((entry, i) =>
          i === index ? { ...entry, ...value } : entry,
        ),
      });
  };
  return (
    <>
      <Feedback {...action} />
      <div className={ui.toolbar}>
        <input
          aria-label="ランク設定を検索"
          type="search"
          placeholder="プリセット名で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className={ui.primary} onClick={() => edit()}>
          ランク設定を作成
        </button>
      </div>
      <div className={ui.split}>
        <div className={ui.list}>
          {presets
            .filter((entry) =>
              entry.name.toLowerCase().includes(query.toLowerCase()),
            )
            .map((entry) => (
              <button
                key={entry.name}
                type="button"
                className={ui.listButton}
                onClick={() => edit(entry)}
                aria-current={originalName === entry.name ? "true" : undefined}
              >
                <span>
                  <strong>{entry.name}</strong>
                  <small>
                    {entry.ranks.length} 段階 · 報酬 {entry.rewards.length} 件
                  </small>
                </span>
              </button>
            ))}
          {!presets.length && (
            <ResourceState
              loading={false}
              empty="ランク設定を作成すると、XPと報酬を運用できます。"
            />
          )}
        </div>
        {draft ? (
          <form
            id="rank-preset"
            className={ui.card}
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                if (
                  draft.ranks.some(
                    (entry) => !entry.name.trim() || entry.minXp >= entry.maxXp,
                  )
                )
                  throw new Error(
                    "各ランクの名前とXP範囲（開始 < 終了）を確認してください。",
                  );
                const data = await request<{ preset: Preset }>(
                  `${base}/presets${originalName ? "/" + encodeURIComponent(originalName) : ""}`,
                  originalName ? "PUT" : "POST",
                  { ...draft, guildId },
                );
                setDraft(data.preset);
                setOriginalName(data.preset.name);
                setBaseline(JSON.stringify(data.preset));
                reload();
              }, "ランク設定を保存しました。");
            }}
          >
            <fieldset className={ui.stack} disabled={action.busy}>
              <h2>{originalName ? "ランク設定を編集" : "ランク設定を作成"}</h2>
              <label>
                プリセット名
                <input
                  required
                  maxLength={100}
                  disabled={!!originalName}
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <label>
                説明
                <textarea
                  maxLength={1000}
                  value={draft.description || ""}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </label>
              <h3>ランクの段階</h3>
              {draft.ranks.map((entry, index) => (
                <section className={ui.card} key={index}>
                  <div className={ui.formGrid}>
                    <label>
                      ランク名
                      <input
                        aria-label={`ランク${index + 1}の名前`}
                        required
                        value={entry.name}
                        onChange={(e) => rank(index, { name: e.target.value })}
                      />
                    </label>
                    <label>
                      色
                      <input
                        aria-label={`ランク${index + 1}の色`}
                        type="color"
                        value={
                          /^#[0-9a-f]{6}$/i.test(entry.color || "")
                            ? entry.color
                            : "#6b8e7e"
                        }
                        onChange={(e) => rank(index, { color: e.target.value })}
                      />
                    </label>
                    <label>
                      開始XP
                      <input
                        type="number"
                        min={0}
                        required
                        value={entry.minXp}
                        onChange={(e) =>
                          rank(index, { minXp: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      終了XP
                      <input
                        type="number"
                        min={entry.minXp + 1}
                        required
                        value={entry.maxXp}
                        onChange={(e) =>
                          rank(index, { maxXp: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      アイコン（絵文字）
                      <input
                        value={entry.icon || ""}
                        maxLength={100}
                        onChange={(e) => rank(index, { icon: e.target.value })}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className={ui.danger}
                    disabled={draft.ranks.length <= 1}
                    onClick={() =>
                      patch({
                        ranks: draft.ranks.filter((_, i) => i !== index),
                      })
                    }
                  >
                    この段階を削除
                  </button>
                </section>
              ))}
              <button
                type="button"
                className={ui.secondary}
                onClick={() => {
                  const min = draft.ranks[draft.ranks.length - 1]?.maxXp || 0;
                  patch({
                    ranks: [
                      ...draft.ranks,
                      {
                        name: "新しいランク",
                        minXp: min,
                        maxXp: min + 100,
                        color: "#6b8e7e",
                      },
                    ],
                  });
                }}
              >
                段階を追加
              </button>
              <h3>ランクアップ報酬</h3>
              {draft.rewards.map((entry, index) => (
                <section key={index} className={ui.card}>
                  <div className={ui.stack}>
                    <label>
                      対象ランク
                      <select
                        aria-label="報酬の対象ランク"
                        value={entry.rankName}
                        onChange={(e) =>
                          reward(index, { rankName: e.target.value })
                        }
                      >
                        {draft.ranks.map((tier) => (
                          <option key={tier.name} value={tier.name}>
                            {tier.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <RoleSelect
                      label="付与ロール"
                      value={entry.giveRoleId || ""}
                      roles={roles}
                      onChange={(giveRoleId) => reward(index, { giveRoleId })}
                    />
                    <label className={ui.check}>
                      <input
                        type="checkbox"
                        checked={!!entry.notify}
                        onChange={(e) =>
                          reward(index, { notify: e.target.checked })
                        }
                      />
                      ランクアップを通知する
                    </label>
                    <label>
                      通知メッセージ
                      <textarea
                        value={entry.customMessage || ""}
                        onChange={(e) =>
                          reward(index, { customMessage: e.target.value })
                        }
                      />
                    </label>
                    <details>
                      <summary>Webhookの設定</summary>
                      <label>
                        Webhook URL
                        <input
                          type="url"
                          value={entry.webhookUrl || ""}
                          onChange={(e) =>
                            reward(index, { webhookUrl: e.target.value })
                          }
                        />
                      </label>
                    </details>
                    <button
                      type="button"
                      className={ui.danger}
                      onClick={() =>
                        patch({
                          rewards: draft.rewards.filter((_, i) => i !== index),
                        })
                      }
                    >
                      報酬を削除
                    </button>
                  </div>
                </section>
              ))}
              <button
                type="button"
                className={ui.secondary}
                onClick={() =>
                  patch({
                    rewards: [
                      ...draft.rewards,
                      { rankName: draft.ranks[0]?.name || "", notify: true },
                    ],
                  })
                }
              >
                報酬を追加
              </button>
              {originalName && (
                <button
                  type="button"
                  className={ui.danger}
                  onClick={() => {
                    if (window.confirm(`「${originalName}」を削除しますか？`))
                      void action.run(async () => {
                        await request(
                          `${base}/presets/${encodeURIComponent(originalName)}?guildId=${guildId}`,
                          "DELETE",
                        );
                        setDraft(null);
                        reload();
                      }, "ランク設定を削除しました。");
                  }}
                >
                  このランク設定を削除
                </button>
              )}
            </fieldset>
            <SaveBar
              busy={action.busy}
              dirty={dirty}
              form="rank-preset"
              onDiscard={() => {
                if (baseline) setDraft(JSON.parse(baseline));
                else setDraft(null);
              }}
            />
          </form>
        ) : (
          <ResourceState
            loading={false}
            empty="ランク設定を選択するか、新しく作成してください。"
          />
        )}
      </div>
    </>
  );
}
function XpSettings({
  guildId,
  channels,
  roles,
}: {
  guildId: string;
  channels: Channel[];
  roles: Role[];
}) {
  const resource = useResource<Settings>(`${base}/settings?guildId=${guildId}`);
  const [draft, setDraft] = useState<Settings | null>(null);
  const action = useAction();
  useEffect(() => {
    if (resource.data) setDraft(resource.data);
  }, [resource.data]);
  if (resource.loading || resource.error || !draft)
    return <ResourceState {...resource} retry={resource.reload} />;
  const patch = (key: keyof Settings["xpRates"], value: number | string[]) =>
    setDraft({ ...draft, xpRates: { ...draft.xpRates, [key]: value } });
  return (
    <>
      <Feedback {...action} />
      <form
        id="xp-settings"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const next = await request<{ settings: Settings }>(
              `${base}/settings`,
              "PUT",
              { ...draft, guildId },
            );
            resource.setData(next.settings);
          }, "XPの設定を保存しました。");
        }}
      >
        <fieldset disabled={action.busy} className={ui.stack}>
          <section className={ui.card}>
            <h2>XPの獲得量と制限</h2>
            <p>メッセージや通話への参加で獲得するXPを設定します。</p>
            <div className={ui.formGrid}>
              {(
                [
                  ["messageXp", "メッセージ1件のXP", 0],
                  ["messageXpMin", "メッセージXPの最小値", 0],
                  ["messageXpMax", "メッセージXPの最大値", 0],
                  ["messageCooldownSec", "メッセージXPの待機時間（秒）", 1],
                  ["vcXpPerMinute", "通話1分のXP", 0],
                  ["vcXpPerMinuteMin", "通話XPの最小値", 0],
                  ["vcXpPerMinuteMax", "通話XPの最大値", 0],
                  ["dailyXpCap", "1日のXP上限（0で無制限）", 0],
                  ["globalMultiplier", "全体のXP倍率", 0.1],
                ] as const
              ).map(([key, label, min]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    required
                    min={min}
                    step={key === "globalMultiplier" ? 0.1 : 1}
                    value={draft.xpRates[key] ?? 0}
                    onChange={(e) => patch(key, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
          </section>
          <section className={ui.card}>
            <h2>通知とパネル更新</h2>
            <div className={ui.formGrid}>
              <ChannelSelect
                optional
                label="ランクアップ通知先"
                value={draft.notifyChannelId || ""}
                onChange={(notifyChannelId) =>
                  setDraft({ ...draft, notifyChannelId })
                }
                channels={channels}
              />
              <label>
                パネル更新間隔（分）
                <input
                  type="number"
                  min={1}
                  value={draft.updateIntervalMs / 60000}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      updateIntervalMs: Number(e.target.value) * 60000,
                    })
                  }
                />
              </label>
            </div>
          </section>
          <section className={ui.card}>
            <h2>XPを付与しない対象</h2>
            <div className={ui.grid}>
              <section>
                <h3>チャンネル</h3>
                {channels.map((channel) => (
                  <label key={channel.id} className={ui.check}>
                    <input
                      type="checkbox"
                      checked={draft.xpRates.excludeChannels.includes(
                        channel.id,
                      )}
                      onChange={(e) =>
                        patch(
                          "excludeChannels",
                          e.target.checked
                            ? [...draft.xpRates.excludeChannels, channel.id]
                            : draft.xpRates.excludeChannels.filter(
                                (id) => id !== channel.id,
                              ),
                        )
                      }
                    />
                    #{channel.name}
                  </label>
                ))}
              </section>
              <section>
                <h3>ロール</h3>
                {roles.map((role) => (
                  <label key={role.id} className={ui.check}>
                    <input
                      type="checkbox"
                      checked={draft.xpRates.excludeRoles.includes(role.id)}
                      onChange={(e) =>
                        patch(
                          "excludeRoles",
                          e.target.checked
                            ? [...draft.xpRates.excludeRoles, role.id]
                            : draft.xpRates.excludeRoles.filter(
                                (id) => id !== role.id,
                              ),
                        )
                      }
                    />
                    @{role.name}
                  </label>
                ))}
              </section>
            </div>
          </section>
        </fieldset>
        <SaveBar
          form="xp-settings"
          busy={action.busy}
          dirty={JSON.stringify(draft) !== JSON.stringify(resource.data)}
          onDiscard={() => setDraft(resource.data)}
        />
      </form>
    </>
  );
}
function Rules({
  guildId,
  presets,
  channels,
  roles,
}: {
  guildId: string;
  presets: Preset[];
  channels: Channel[];
  roles: Role[];
}) {
  const [preset, setPreset] = useState(presets[0]?.name || "");
  const resource = useResource<Rule[]>(
    preset
      ? `${base}/guilds/${guildId}/presets/${encodeURIComponent(preset)}/rules`
      : null,
  );
  const action = useAction();
  const [draft, setDraft] = useState<Rule | null>(null);
  const [existing, setExisting] = useState(false);
  useUnsavedChanges(!!draft);
  const ruleUrl = `${base}/guilds/${guildId}/presets/${encodeURIComponent(preset)}/rules`;
  return (
    <div className={ui.stack}>
      <Feedback {...action} />
      <label>
        ルールを設定するプリセット
        <select
          aria-label="ルールを設定するプリセット"
          value={preset}
          onChange={(e) => {
            if (
              !draft ||
              window.confirm("ルールの編集中です。切り替えますか？")
            ) {
              setPreset(e.target.value);
              setDraft(null);
            }
          }}
        >
          {presets.map((entry) => (
            <option key={entry.name} value={entry.name}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      {!preset ? (
        <ResourceState
          loading={false}
          empty="先に「ランクと報酬」でプリセットを作成してください。"
        />
      ) : (
        <>
          <button
            type="button"
            className={ui.primary}
            disabled={!!draft}
            onClick={() => {
              setExisting(false);
              setDraft({
                id: crypto.randomUUID(),
                name: "",
                actionType: "message",
                xpReward: 10,
                isActive: true,
                channels: [],
                roles: [],
              });
            }}
          >
            XPルールを作成
          </button>
          {resource.loading || resource.error ? (
            <ResourceState {...resource} retry={resource.reload} />
          ) : (
            <div className={ui.list}>
              {resource.data?.map((rule) => (
                <button
                  type="button"
                  key={rule.id}
                  className={ui.listButton}
                  onClick={() => {
                    if (
                      !draft ||
                      window.confirm("編集中のルールを閉じますか？")
                    ) {
                      setExisting(true);
                      setDraft(structuredClone(rule));
                    }
                  }}
                >
                  <span>
                    <strong>{rule.name}</strong>
                    <small>
                      {rule.xpReward} XP · {rule.isActive ? "有効" : "停止中"}
                    </small>
                  </span>
                  <span>編集 ›</span>
                </button>
              ))}
              {!resource.data?.length && <p>XPルールはありません。</p>}
            </div>
          )}
          {draft && (
            <form
              className={ui.card}
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  await request(
                    ruleUrl +
                      (existing ? "/" + encodeURIComponent(draft.id) : ""),
                    existing ? "PUT" : "POST",
                    draft,
                  );
                  setDraft(null);
                  resource.reload();
                }, "XPルールを保存しました。");
              }}
            >
              <fieldset disabled={action.busy} className={ui.stack}>
                <h2>ルールを編集</h2>
                <label>
                  ルール名
                  <input
                    required
                    maxLength={100}
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  説明
                  <textarea
                    value={draft.description || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                  />
                </label>
                <div className={ui.formGrid}>
                  <label>
                    対象の操作
                    <select
                      aria-label="対象の操作"
                      value={draft.actionType}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          actionType: e.target.value as Rule["actionType"],
                        })
                      }
                    >
                      {Object.entries({
                        message: "メッセージ",
                        reaction: "リアクション",
                        voiceChat: "通話",
                        invite: "招待",
                        custom: "カスタム",
                      }).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(
                    [
                      ["xpReward", "獲得XP"],
                      ["xpRewardMin", "獲得XPの最小値"],
                      ["xpRewardMax", "獲得XPの最大値"],
                      ["cooldownSec", "待機時間（秒）"],
                      ["maxPerDay", "1日の上限回数"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min={0}
                        value={draft[key] ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [key]:
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label className={ui.check}>
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) =>
                      setDraft({ ...draft, isActive: e.target.checked })
                    }
                  />
                  このルールを有効にする
                </label>
                <details>
                  <summary>対象チャンネル・ロール（未選択で全体）</summary>
                  <div className={ui.grid}>
                    {[
                      ["channels", channels],
                      ["roles", roles],
                    ].map(([key, options]) => (
                      <section key={key as string}>
                        {(options as Role[]).map((option) => (
                          <label className={ui.check} key={option.id}>
                            <input
                              type="checkbox"
                              checked={(
                                draft[key as "roles" | "channels"] || []
                              ).includes(option.id)}
                              onChange={(e) => {
                                const ids =
                                  draft[key as "roles" | "channels"] || [];
                                setDraft({
                                  ...draft,
                                  [key as string]: e.target.checked
                                    ? [...ids, option.id]
                                    : ids.filter((id) => id !== option.id),
                                });
                              }}
                            />
                            {option.name}
                          </label>
                        ))}
                      </section>
                    ))}
                  </div>
                </details>
                <div className={ui.actions}>
                  <button type="submit" className={ui.primary}>
                    ルールを保存
                  </button>
                  <button
                    type="button"
                    className={ui.secondary}
                    onClick={() => {
                      if (window.confirm("ルールの編集を閉じますか？"))
                        setDraft(null);
                    }}
                  >
                    キャンセル
                  </button>
                  {existing && (
                    <button
                      type="button"
                      className={ui.danger}
                      onClick={() => {
                        if (window.confirm("このルールを削除しますか？"))
                          void action.run(async () => {
                            await request(
                              ruleUrl + "/" + encodeURIComponent(draft.id),
                              "DELETE",
                            );
                            setDraft(null);
                            resource.reload();
                          }, "ルールを削除しました。");
                      }}
                    >
                      削除
                    </button>
                  )}
                </div>
              </fieldset>
            </form>
          )}
        </>
      )}
    </div>
  );
}
function Panels({
  guildId,
  channels,
}: {
  guildId: string;
  channels: Channel[];
}) {
  const resource = useResource<Record<string, Panel>>(
    `${base}/panels?guildId=${guildId}`,
  );
  const action = useAction();
  return (
    <div className={ui.stack}>
      <Feedback {...action} />
      <div className={ui.hint}>
        新規パネルはDiscordで <code>/staff rank action:create-panel</code>{" "}
        を実行して作成します。
      </div>
      {resource.loading || resource.error ? (
        <ResourceState {...resource} retry={resource.reload} />
      ) : (
        Object.entries(resource.data || {}).map(([id, panel]) => (
          <article className={ui.card} key={id}>
            <div className={ui.row}>
              <div>
                <h3>{panel.preset}</h3>
                <p>
                  #
                  {channels.find((channel) => channel.id === panel.channelId)
                    ?.name || panel.channelId}{" "}
                  · 上位 {panel.topCount || 10} 人
                </p>
                <small>
                  更新 {new Date(panel.lastUpdate).toLocaleString("ja-JP")}
                </small>
              </div>
              <div className={ui.actions}>
                <a
                  className={ui.secondary}
                  href={`https://discord.com/channels/${guildId}/${panel.channelId}/${panel.messageId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Discordで開く
                </a>
                <button
                  type="button"
                  className={ui.danger}
                  disabled={action.busy}
                  onClick={() => {
                    if (window.confirm("このランキングパネルを削除しますか？"))
                      void action.run(async () => {
                        await request(
                          `${base}/panels/${encodeURIComponent(id)}?guildId=${guildId}`,
                          "DELETE",
                        );
                        resource.reload();
                      }, "パネルを削除しました。");
                  }}
                >
                  削除
                </button>
              </div>
            </div>
          </article>
        ))
      )}
      {resource.data && !Object.keys(resource.data).length && (
        <ResourceState loading={false} empty="投稿済みパネルはありません。" />
      )}
    </div>
  );
}
function Reset({ guildId, guildName }: { guildId: string; guildName: string }) {
  const action = useAction();
  const [target, setTarget] = useState("user");
  const [userId, setUserId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  return (
    <section className={ui.card}>
      <Feedback {...action} />
      <h2>ランキングデータをリセット</h2>
      <p>
        この操作は取り消せません。対象のユーザーとサーバーを確認してください。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (
            window.confirm(
              "選択したランキングデータをリセットします。実行しますか？",
            )
          )
            void action.run(
              () =>
                request(
                  `${base}/guilds/${guildId}/reset`,
                  "POST",
                  target === "user" ? { userId } : {},
                ),
              "ランキングデータをリセットしました。",
            );
        }}
      >
        <fieldset disabled={action.busy} className={ui.stack}>
          <label>
            リセット対象
            <select
              aria-label="リセット対象"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="user">指定ユーザーのみ</option>
              <option value="all">サーバー全員</option>
            </select>
          </label>
          {target === "user" ? (
            <label>
              ユーザーID
              <input
                required
                pattern="[1-9][0-9]{0,19}"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
            </label>
          ) : (
            <label>
              確認のためサーバー名「{guildName}」を入力
              <input
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
          )}
          <button
            type="submit"
            className={ui.danger}
            disabled={target === "all" && confirmation !== guildName}
          >
            対象データをリセット
          </button>
        </fieldset>
      </form>
    </section>
  );
}
