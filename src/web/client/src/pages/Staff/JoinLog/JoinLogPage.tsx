import { useEffect, useState } from "react";
import {
  ServerWorkspace,
  useResource,
  useAction,
  Feedback,
  ResourceState,
  ChannelSelect,
  SaveBar,
  Tabs,
  request,
  ui,
  type Channel,
} from "../../../components/Workspace/Workspace";
type Settings = {
  enabled: boolean;
  channelId: string | null;
  logBots: boolean;
  joinTitle: string;
  joinDescription: string;
  leaveTitle: string;
  leaveDescription: string;
  joinColor: number;
  leaveColor: number;
};
type State = {
  settings: Settings;
  defaults: Settings;
  channels: Channel[];
  placeholders: string[];
};
const hex = (value: number) => "#" + value.toString(16).padStart(6, "0");
export default function JoinLogPage() {
  return (
    <ServerWorkspace
      title="参加・退出ログ"
      description="通知先を決め、メッセージをプレビューしながら参加・退出通知を設定します。"
    >
      {(guild) => <LogSettings guildId={guild.id} guildName={guild.name} />}
    </ServerWorkspace>
  );
}
function LogSettings({
  guildId,
  guildName,
}: {
  guildId: string;
  guildName: string;
}) {
  const resource = useResource<State>(`/api/staff/join-log/${guildId}`);
  const action = useAction();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [tab, setTab] = useState<"join" | "leave">("join");
  const [focused, setFocused] = useState<"title" | "body">("body");
  useEffect(() => {
    if (resource.data) setDraft(resource.data.settings);
  }, [resource.data]);
  const patch = (value: Partial<Settings>) =>
    setDraft((current) => (current ? { ...current, ...value } : current));
  if (resource.loading || resource.error || !draft)
    return <ResourceState {...resource} retry={resource.reload} />;
  const titleKey = tab === "join" ? "joinTitle" : "leaveTitle";
  const bodyKey = tab === "join" ? "joinDescription" : "leaveDescription";
  const colorKey = tab === "join" ? "joinColor" : "leaveColor";
  const preview = (text: string) =>
    text.replace(
      /\{([^}]+)\}/g,
      (match, key) =>
        (
          ({
            user: "サンプルユーザー",
            display_name: "サンプルユーザー",
            tag: "sample_user",
            mention: "@サンプルユーザー",
            id: "123456789012345678",
            server: guildName,
            member_count: "128",
            roles: "@メンバー",
            joined_duration: "30日",
            account_created: "2024/01/01",
          }) as Record<string, string>
        )[key] || match,
    );
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(resource.data?.settings);
  return (
    <>
      <Feedback {...action} />
      <form
        id="join-log-settings"
        className={ui.stack}
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const data = await request<{ settings: Settings }>(
              `/api/staff/join-log/${guildId}`,
              "PUT",
              draft,
            );
            resource.setData({ ...resource.data!, settings: data.settings });
          }, "参加・退出ログの設定を保存しました。");
        }}
      >
        <fieldset className={ui.stack} disabled={action.busy}>
          <section className={ui.card}>
            <h2>通知の基本設定</h2>
            <div className={ui.formGrid}>
              <label className={ui.check}>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => patch({ enabled: e.target.checked })}
                />
                参加・退出通知を有効にする
              </label>
              <label className={ui.check}>
                <input
                  type="checkbox"
                  checked={draft.logBots}
                  onChange={(e) => patch({ logBots: e.target.checked })}
                />
                Botの参加・退出も通知する
              </label>
              <ChannelSelect
                optional={!draft.enabled}
                label="通知先チャンネル"
                value={draft.channelId || ""}
                onChange={(value) => patch({ channelId: value || null })}
                channels={resource.data!.channels.map((channel) => ({
                  ...channel,
                  type: 0,
                }))}
              />
            </div>
          </section>
          <div className={ui.card}>
            <Tabs
              value={tab}
              onChange={setTab}
              options={[
                ["join", "参加メッセージ"],
                ["leave", "退出メッセージ"],
              ]}
            />
            <div className={ui.grid}>
              <div className={ui.stack}>
                <label>
                  タイトル
                  <input
                    required
                    maxLength={256}
                    value={draft[titleKey]}
                    onFocus={() => setFocused("title")}
                    onChange={(e) => patch({ [titleKey]: e.target.value })}
                  />
                </label>
                <label>
                  本文
                  <textarea
                    required
                    maxLength={4096}
                    value={draft[bodyKey]}
                    onFocus={() => setFocused("body")}
                    onChange={(e) => patch({ [bodyKey]: e.target.value })}
                  />
                  <small>{draft[bodyKey].length} / 4096文字</small>
                </label>
                <label>
                  通知の色
                  <input
                    aria-label="通知の色"
                    type="color"
                    value={hex(draft[colorKey])}
                    onChange={(e) =>
                      patch({
                        [colorKey]: parseInt(e.target.value.slice(1), 16),
                      })
                    }
                  />
                </label>
                <details>
                  <summary>置換文字を挿入</summary>
                  <p>直前に選んだタイトルまたは本文の末尾に追加します。</p>
                  <div className={ui.actions}>
                    {resource.data!.placeholders.map((value) => (
                      <button
                        type="button"
                        className={ui.secondary}
                        key={value}
                        onClick={() => {
                          const key = focused === "title" ? titleKey : bodyKey;
                          patch({ [key]: draft[key] + value });
                        }}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </details>
                <button
                  type="button"
                  className={ui.secondary}
                  onClick={() => {
                    if (
                      window.confirm(
                        "表示中のメッセージを初期テンプレートに戻しますか？",
                      )
                    )
                      patch({
                        [titleKey]: resource.data!.defaults[titleKey],
                        [bodyKey]: resource.data!.defaults[bodyKey],
                        [colorKey]: resource.data!.defaults[colorKey],
                      });
                  }}
                >
                  このテンプレートを初期化
                </button>
              </div>
              <section>
                <h3>通知プレビュー</h3>
                <p>ユーザー情報はサンプルです。</p>
                <div
                  className={ui.preview}
                  style={{ borderLeftColor: hex(draft[colorKey]) }}
                >
                  <strong>{preview(draft[titleKey])}</strong>
                  <p>{preview(draft[bodyKey])}</p>
                </div>
              </section>
            </div>
          </div>
        </fieldset>
        <SaveBar
          busy={action.busy}
          dirty={dirty}
          form="join-log-settings"
          onDiscard={() => setDraft(resource.data!.settings)}
        />
      </form>
    </>
  );
}
