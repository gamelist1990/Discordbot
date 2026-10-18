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
  request,
  ui,
  type Channel,
  type Role,
} from "../../../components/Workspace/Workspace";
type Feature = {
  key: string;
  label: string;
  description: string;
  emoji: string;
  webSettings: { spectatorRole: boolean; requestSettings: boolean };
};
type Config = {
  panelKind: string;
  channelId: string;
  spectatorRoleId: string | null;
  requestDoneChannelId?: string | null;
  requestCategoryName?: string | null;
  requestLabels?: string[];
  requestStaffRoleId?: string | null;
  requestTrackingChannelId?: string | null;
};
type State = {
  features: Feature[];
  config: Config | null;
  panelUrl: string | null;
};
export default function CorePanelPage() {
  return (
    <ServerWorkspace
      title="Core パネル"
      description="機能を選び、設定を確認してからDiscordへ投稿できます。"
    >
      {(guild) => <Panel guildId={guild.id} />}
    </ServerWorkspace>
  );
}
function Panel({ guildId }: { guildId: string }) {
  const [kind, setKind] = useState("combined");
  const resource = useResource<State>(
    `/api/staff/corepanel/${guildId}?panelKind=${encodeURIComponent(kind)}`,
  );
  const channels = useResource<{ channels: Channel[] }>(
    `/api/staff/guilds/${guildId}/channels`,
  );
  const roles = useResource<{ roles: Role[] }>(
    `/api/staff/guilds/${guildId}/roles`,
  );
  const [draft, setDraft] = useState<Config | null>(null);
  const [baseline, setBaseline] = useState("");
  const [labels, setLabels] = useState("");
  const action = useAction();
  useEffect(() => {
    if (resource.data) {
      const next = {
        panelKind: kind,
        channelId: "",
        spectatorRoleId: null,
        ...resource.data.config,
      };
      setDraft(next);
      setLabels(next.requestLabels?.join(", ") || "");
      setBaseline(JSON.stringify(next));
    }
  }, [resource.data, kind]);
  const feature = resource.data?.features.find((item) => item.key === kind);
  const usesRequests =
    kind === "combined"
      ? resource.data?.features.some((item) => item.webSettings.requestSettings)
      : feature?.webSettings.requestSettings;
  const usesSpectator =
    kind === "combined"
      ? resource.data?.features.some((item) => item.webSettings.spectatorRole)
      : feature?.webSettings.spectatorRole;
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const patch = (value: Partial<Config>) =>
    setDraft((current) => (current ? { ...current, ...value } : current));
  const save = (post: boolean) =>
    void action.run(
      async () => {
        if (!draft?.channelId)
          throw new Error("投稿先チャンネルを選択してください。");
        const data = await request<State>(
          `/api/staff/corepanel/${guildId}/${post ? "post" : "config"}`,
          "POST",
          draft,
        );
        resource.setData({ ...resource.data!, ...data });
      },
      post
        ? "Discordにパネルを投稿・更新しました。"
        : "パネル設定を保存しました。",
    );
  const error = resource.error || channels.error || roles.error;
  return (
    <>
      <Feedback {...action} />
      <div className={ui.steps}>
        <span>01 機能を選択</span>
        <span>02 投稿先とオプションを設定</span>
        <span>03 確認して投稿</span>
      </div>
      <label className={`${ui.card} ${ui.selectorCard}`}>
        パネルの種類
        <select
          aria-label="パネルの種類"
          value={kind}
          disabled={action.busy}
          onChange={(e) => {
            if (
              !dirty ||
              window.confirm("未保存の変更を取り消して切り替えますか？")
            )
              setKind(e.target.value);
          }}
        >
          <option value="combined">すべての機能をまとめる</option>
          {resource.data?.features.map((item) => (
            <option value={item.key} key={item.key}>
              {item.emoji} {item.label}
            </option>
          ))}
        </select>
      </label>
      {resource.loading ||
      channels.loading ||
      roles.loading ||
      error ||
      !draft ? (
        <ResourceState
          loading={resource.loading || channels.loading || roles.loading}
          error={error}
          retry={() => {
            resource.reload();
            channels.reload();
            roles.reload();
          }}
        />
      ) : (
        <form
          id="core-panel-settings"
          className={ui.stack}
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <fieldset disabled={action.busy} className={ui.grid}>
            <section className={ui.card}>
              <h2>投稿の設定</h2>
              <p>
                {feature?.description ||
                  "登録済みの機能を1つのパネルにまとめます。"}
              </p>
              <div className={ui.stack}>
                <ChannelSelect
                  label="パネルの投稿先"
                  value={draft.channelId}
                  onChange={(channelId) => patch({ channelId })}
                  channels={channels.data?.channels || []}
                />
                {usesSpectator && (
                  <RoleSelect
                    label="観戦ロール"
                    value={draft.spectatorRoleId || ""}
                    roles={roles.data?.roles || []}
                    onChange={(value) =>
                      patch({ spectatorRoleId: value || null })
                    }
                  />
                )}
                {usesRequests && (
                  <details>
                    <summary>リクエスト機能の設定</summary>
                    <div className={ui.stack}>
                      <label>
                        作成するカテゴリ名
                        <input
                          value={draft.requestCategoryName || ""}
                          maxLength={100}
                          onChange={(e) =>
                            patch({ requestCategoryName: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        リクエストの種類（カンマ区切り）
                        <input
                          value={labels}
                          onChange={(e) => {
                            setLabels(e.target.value);
                            patch({
                              requestLabels: e.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter(Boolean),
                            });
                          }}
                        />
                      </label>
                      <RoleSelect
                        label="対応スタッフのロール"
                        value={draft.requestStaffRoleId || ""}
                        roles={roles.data?.roles || []}
                        onChange={(value) =>
                          patch({ requestStaffRoleId: value || null })
                        }
                      />
                      <ChannelSelect
                        optional
                        label="完了通知先"
                        value={draft.requestDoneChannelId || ""}
                        onChange={(value) =>
                          patch({ requestDoneChannelId: value || null })
                        }
                        channels={channels.data?.channels || []}
                      />
                      <ChannelSelect
                        optional
                        label="進捗通知先"
                        value={draft.requestTrackingChannelId || ""}
                        onChange={(value) =>
                          patch({ requestTrackingChannelId: value || null })
                        }
                        channels={channels.data?.channels || []}
                      />
                    </div>
                  </details>
                )}
              </div>
            </section>
            <section className={ui.card}>
              <h2>投稿内容の確認</h2>
              <p>投稿・更新は保存とは別の操作です。</p>
              <div className={ui.preview}>
                <strong>
                  {feature
                    ? feature.emoji + " " + feature.label
                    : "🧩 Core パネル"}
                </strong>
                <p>
                  {feature?.description ||
                    resource.data?.features
                      .map((item) => item.label)
                      .join(" / ")}
                </p>
                <small>
                  投稿先：#
                  {channels.data?.channels.find(
                    (channel) => channel.id === draft.channelId,
                  )?.name || "未選択"}
                </small>
              </div>
              <hr className={ui.divider} />
              <button
                type="button"
                className={ui.primary}
                disabled={!draft.channelId}
                onClick={() => {
                  if (
                    window.confirm(
                      "表示中の設定でDiscordのパネルを投稿・更新しますか？",
                    )
                  )
                    save(true);
                }}
              >
                この設定で投稿・更新
              </button>
              {resource.data?.panelUrl && (
                <p>
                  <a
                    href={resource.data.panelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    投稿済みパネルをDiscordで開く ↗
                  </a>
                </p>
              )}
            </section>
          </fieldset>
          <SaveBar
            busy={action.busy}
            dirty={dirty}
            form="core-panel-settings"
            onDiscard={() => {
              setDraft(JSON.parse(baseline));
              setLabels(JSON.parse(baseline).requestLabels?.join(", ") || "");
            }}
          />
        </form>
      )}
    </>
  );
}
