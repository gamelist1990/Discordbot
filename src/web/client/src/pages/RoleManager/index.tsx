import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ServerWorkspace,
  useResource,
  useAction,
  Feedback,
  ResourceState,
  request,
  useUnsavedChanges,
  ui,
  type Role,
} from "../../components/Workspace/Workspace";
type Preset = {
  id: string;
  name: string;
  description: string;
  roles: string[];
  allowMulti: boolean;
  panelType: "toggle" | "grant_missing";
  authType: "none" | "web" | "code" | "math";
  authUrl?: string;
};
const blank = (): Preset => ({
  id: "",
  name: "",
  description: "",
  roles: [],
  allowMulti: true,
  panelType: "toggle",
  authType: "none",
  authUrl: "",
});
export default function RoleManagerPage() {
  return (
    <ServerWorkspace
      title="ロール管理"
      description="配布するロールと認証方法をまとめ、参加者用のプリセットを作成します。"
    >
      {(guild) => <Presets guildId={guild.id} />}
    </ServerWorkspace>
  );
}
function Presets({ guildId }: { guildId: string }) {
  const navigate = useNavigate();
  const resource = useResource<{ presets: Record<string, Preset> }>(
    `/api/staff/guilds/${guildId}/role-presets`,
  );
  const roles = useResource<{ roles: Role[] }>(
    `/api/staff/guilds/${guildId}/roles`,
  );
  const action = useAction();
  const [draft, setDraft] = useState<Preset | null>(null);
  const [original, setOriginal] = useState("");
  const [query, setQuery] = useState("");
  const [roleQuery, setRoleQuery] = useState("");
  const [command, setCommand] = useState("");
  const dirty = draft && JSON.stringify(draft) !== original;
  useUnsavedChanges(!!dirty);
  const edit = (preset: Preset) => {
    if (dirty && !window.confirm("編集内容を保存せずに切り替えますか？"))
      return;
    const next = { ...blank(), ...preset };
    setDraft(next);
    setOriginal(JSON.stringify(next));
    setRoleQuery("");
    setCommand("");
  };
  const patch = (value: Partial<Preset>) =>
    setDraft((current) => (current ? { ...current, ...value } : current));
  return (
    <>
      <Feedback {...action} />
      <div className={ui.toolbar}>
        <input
          aria-label="プリセットを検索"
          type="search"
          placeholder="プリセット名で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className={ui.primary}
          onClick={() => edit(blank())}
        >
          プリセットを作成
        </button>
      </div>
      {resource.loading || resource.error || roles.loading || roles.error ? (
        <ResourceState
          loading={resource.loading || roles.loading}
          error={resource.error || roles.error}
          retry={() => {
            resource.reload();
            roles.reload();
          }}
        />
      ) : (
        <div className={ui.split}>
          <div className={ui.list}>
            {Object.values(resource.data?.presets || {})
              .filter((item) =>
                item.name.toLowerCase().includes(query.toLowerCase()),
              )
              .map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-current={draft?.id === item.id ? "true" : undefined}
                  className={ui.listButton}
                  onClick={() => edit(item)}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.roles.length} ロール ·{" "}
                      {item.allowMulti ? "複数選択" : "単一選択"}
                    </small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            {!Object.keys(resource.data?.presets || {}).length && (
              <ResourceState
                loading={false}
                empty="プリセットはありません。まず1つ作成してください。"
              />
            )}
          </div>
          {draft ? (
            <form
              className={ui.card}
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  const saved = await request<Preset>(
                    `/api/staff/guilds/${guildId}/role-presets${draft.id ? "/" + encodeURIComponent(draft.id) : ""}`,
                    draft.id ? "PUT" : "POST",
                    draft,
                  );
                  setDraft(saved);
                  setOriginal(JSON.stringify(saved));
                  resource.reload();
                }, "ロールプリセットを保存しました。");
              }}
            >
              <fieldset disabled={action.busy} className={ui.stack}>
                <h2>{draft.id ? "プリセットを編集" : "プリセットを作成"}</h2>
                <label>
                  プリセット名
                  <input
                    required
                    maxLength={100}
                    value={draft.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </label>
                <label>
                  説明
                  <textarea
                    maxLength={1000}
                    value={draft.description}
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                </label>
                <section className={ui.stack}>
                  <div className={ui.row}>
                    <h3>配布するロール</h3>
                    <span className={ui.badge}>
                      {draft.roles.length} 個選択
                    </span>
                  </div>
                  <input
                    aria-label="ロールを検索"
                    type="search"
                    placeholder="ロール名で絞り込む"
                    value={roleQuery}
                    onChange={(e) => setRoleQuery(e.target.value)}
                  />
                  {roles.data?.roles
                    .filter(
                      (role) =>
                        role.id !== guildId &&
                        !role.managed &&
                        role.name
                          .toLowerCase()
                          .includes(roleQuery.toLowerCase()),
                    )
                    .map((role) => (
                      <label className={ui.check} key={role.id}>
                        <input
                          type="checkbox"
                          checked={draft.roles.includes(role.id)}
                          onChange={(e) =>
                            patch({
                              roles: e.target.checked
                                ? [...draft.roles, role.id]
                                : draft.roles.filter((id) => id !== role.id),
                            })
                          }
                        />
                        {role.name}
                      </label>
                    ))}
                </section>
                <div className={ui.formGrid}>
                  <label>
                    配布方法
                    <select
                      aria-label="配布方法"
                      value={draft.panelType}
                      onChange={(e) =>
                        patch({
                          panelType: e.target.value as Preset["panelType"],
                        })
                      }
                    >
                      <option value="toggle">押すたびに付与・解除</option>
                      <option value="grant_missing">
                        未取得のロールを付与
                      </option>
                    </select>
                  </label>
                  <label>
                    認証方法
                    <select
                      aria-label="認証方法"
                      value={draft.authType}
                      onChange={(e) =>
                        patch({
                          authType: e.target.value as Preset["authType"],
                        })
                      }
                    >
                      <option value="none">認証なし</option>
                      <option value="web">Web認証</option>
                      <option value="code">コード認証</option>
                      <option value="math">計算認証</option>
                    </select>
                  </label>
                  {draft.authType === "web" && (
                    <label className={ui.wide}>
                      認証URL
                      <input
                        type="url"
                        value={draft.authUrl || ""}
                        onChange={(e) => patch({ authUrl: e.target.value })}
                        placeholder="https://…"
                      />
                    </label>
                  )}
                </div>
                <label className={ui.check}>
                  <input
                    type="checkbox"
                    checked={draft.allowMulti}
                    onChange={(e) => patch({ allowMulti: e.target.checked })}
                  />
                  複数のロールを選択できるようにする
                </label>
                <div className={ui.actions}>
                  <button
                    className={ui.primary}
                    type="submit"
                    disabled={!draft.roles.length || !draft.name.trim()}
                  >
                    プリセットを保存
                  </button>
                  <button
                    type="button"
                    className={ui.secondary}
                    onClick={() => {
                      if (
                        !dirty ||
                        window.confirm("編集内容を取り消しますか？")
                      )
                        setDraft(null);
                    }}
                  >
                    閉じる
                  </button>
                </div>
                {draft.id && (
                  <>
                    <hr className={ui.divider} />
                    <div className={ui.actions}>
                      <button
                        type="button"
                        className={ui.secondary}
                        onClick={() =>
                          setCommand(`/staff rolepanel preset:${draft.id}`)
                        }
                      >
                        投稿コマンドを表示
                      </button>
                      <button
                        type="button"
                        className={ui.secondary}
                        onClick={() =>
                          navigate(`/staff/corepanel?guildId=${guildId}`)
                        }
                      >
                        Coreパネルを開く
                      </button>
                      <button
                        type="button"
                        className={ui.danger}
                        onClick={() => {
                          if (
                            window.confirm(`「${draft.name}」を削除しますか？`)
                          )
                            void action.run(async () => {
                              await request(
                                `/api/staff/guilds/${guildId}/role-presets/${encodeURIComponent(draft.id)}`,
                                "DELETE",
                              );
                              setDraft(null);
                              resource.reload();
                            }, "プリセットを削除しました。");
                        }}
                      >
                        削除
                      </button>
                    </div>
                    {command && (
                      <div className={ui.hint}>
                        Discordで実行：<code>{command}</code>
                      </div>
                    )}
                  </>
                )}
              </fieldset>
            </form>
          ) : (
            <ResourceState
              loading={false}
              empty="プリセットを選ぶか、新しく作成してください。"
            />
          )}
        </div>
      )}
    </>
  );
}
