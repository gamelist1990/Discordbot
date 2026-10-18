import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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
  confirmWorkspaceLeave,
  StringListInput,
  ui,
  type Channel,
} from "../../../components/Workspace/Workspace";
type Status = "todo" | "doing" | "review" | "blocked" | "done";
type Item = {
  id: string;
  title: string;
  status: Status;
  priority: "low" | "medium" | "high" | "critical";
  progress: number;
  summary: string;
  details: string;
  assignee: string;
  dueDate: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};
type Board = {
  version: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  summary: string;
  items: Item[];
};
type State = {
  todo: { board: Board; jumpUrl: string | null } | null;
  boardCount: number;
  boardLimit: number;
};
const statuses: readonly (readonly [Status, string])[] = [
  ["todo", "未着手"],
  ["doing", "進行中"],
  ["review", "確認待ち"],
  ["blocked", "停止中"],
  ["done", "完了"],
];
const priorities = {
  low: "低",
  medium: "通常",
  high: "高",
  critical: "最優先",
};
export default function TodoPage() {
  return (
    <ServerWorkspace
      title="Todo"
      description="タスクを追加し、担当・期限・進捗を整理してDiscordへ反映します。"
    >
      {(guild) => <Boards guildId={guild.id} />}
    </ServerWorkspace>
  );
}
function Boards({ guildId }: { guildId: string }) {
  const params = useParams();
  const channels = useResource<{ channels: Channel[] }>(
    `/api/staff/guilds/${guildId}/channels`,
  );
  const [channel, setChannel] = useState(params.channelId || "");
  useEffect(() => {
    if (
      channels.data &&
      !channels.data.channels.some((item) => item.id === channel)
    )
      setChannel(
        channels.data.channels.find((item) => [0, 5].includes(item.type))?.id ||
          "",
      );
  }, [channels.data]);
  return (
    <div className={ui.stack}>
      {channels.loading || channels.error ? (
        <ResourceState {...channels} retry={channels.reload} />
      ) : (
        <div className={ui.card}>
          <ChannelSelect
            label="Todoを保存するチャンネル"
            value={channel}
            channels={channels.data?.channels || []}
            onChange={(value) => {
              if (confirmWorkspaceLeave()) setChannel(value);
            }}
          />
        </div>
      )}
      {channel && (
        <TodoEditor key={channel} guildId={guildId} channelId={channel} />
      )}
    </div>
  );
}
function TodoEditor({
  guildId,
  channelId,
}: {
  guildId: string;
  channelId: string;
}) {
  const resource = useResource<State>(
    `/api/staff/todo/${guildId}/${channelId}`,
  );
  const [draft, setDraft] = useState<Board | null>(null);
  const [baseline, setBaseline] = useState("");
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"list" | "board">("list");
  const [filter, setFilter] = useState("all");
  const action = useAction();
  useEffect(() => {
    if (resource.data) {
      const next = resource.data.todo?.board || {
        version: 3,
        guildId,
        channelId,
        messageId: null,
        title: "チームのTodo",
        summary: "",
        items: [],
      };
      setDraft(next);
      setBaseline(JSON.stringify(next));
    }
  }, [resource.data, guildId, channelId]);
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const item = draft?.items.find((entry) => entry.id === selected);
  const patch = (changes: Partial<Item>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            items: current.items.map((entry) =>
              entry.id === selected
                ? { ...entry, ...changes, updatedAt: new Date().toISOString() }
                : entry,
            ),
          }
        : current,
    );
  const add = () => {
    const entry: Item = {
      id: crypto.randomUUID(),
      title: "新しいタスク",
      status: "todo",
      priority: "medium",
      progress: 0,
      summary: "",
      details: "",
      assignee: "",
      dueDate: null,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setDraft((current) =>
      current ? { ...current, items: [...current.items, entry] } : current,
    );
    setSelected(entry.id);
  };
  if (resource.loading || resource.error || !draft)
    return <ResourceState {...resource} retry={resource.reload} />;
  const visible = draft.items.filter(
    (entry) =>
      (filter === "all" || entry.status === filter) &&
      [entry.title, entry.assignee, ...entry.tags]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <Feedback {...action} />
      <form
        id="todo-board"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const next = await request<State>(
              `/api/staff/todo/${guildId}/${channelId}`,
              "POST",
              draft,
            );
            resource.setData(next);
          }, "Todoを保存し、Discordの投稿を更新しました。");
        }}
      >
        <fieldset disabled={action.busy} className={ui.stack}>
          <div className={ui.toolbar}>
            <div>
              <h2>{draft.title}</h2>
              <p>
                {draft.items.filter((entry) => entry.status === "done").length}{" "}
                / {draft.items.length} 件完了 · 最大10件
              </p>
            </div>
            <div className={ui.actions}>
              {resource.data?.todo?.jumpUrl && (
                <a
                  className={ui.secondary}
                  href={resource.data.todo.jumpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Discordで開く
                </a>
              )}
              <button
                type="button"
                className={ui.primary}
                disabled={draft.items.length >= 10}
                onClick={add}
              >
                タスクを追加
              </button>
            </div>
          </div>
          <div className={ui.formGrid}>
            <input
              aria-label="タスクを検索"
              type="search"
              placeholder="タスク・担当・タグで検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="タスクの状態で絞り込み"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">すべての状態</option>
              {statuses.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </div>
          <Tabs
            value={mode}
            onChange={setMode}
            options={[
              ["list", "一覧"],
              ["board", "ステータス別"],
            ]}
          />
          {mode === "board" && (
            <div className={ui.scroll}>
              <div className={ui.kanban}>
                {statuses.map(([id, title]) => (
                  <section key={id} className={ui.lane}>
                    <h3>{title}</h3>
                    {visible
                      .filter((entry) => entry.status === id)
                      .map((entry) => (
                        <button
                          type="button"
                          key={entry.id}
                          className={ui.listButton}
                          onClick={() => setSelected(entry.id)}
                        >
                          <span>
                            <strong>{entry.title}</strong>
                            <small>
                              {entry.assignee || "担当未設定"} ·{" "}
                              {entry.progress}%
                            </small>
                          </span>
                        </button>
                      ))}
                  </section>
                ))}
              </div>
            </div>
          )}
          <div className={ui.split}>
            <div className={ui.list}>
              {mode === "list" &&
                visible.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className={ui.listButton}
                    aria-current={selected === entry.id ? "true" : undefined}
                    onClick={() => setSelected(entry.id)}
                  >
                    <span>
                      <strong>{entry.title}</strong>
                      <small>
                        {entry.assignee || "担当未設定"} ·{" "}
                        {entry.dueDate || "期限なし"} · {entry.progress}%
                      </small>
                    </span>
                    <span className={ui.badge}>
                      {statuses.find(([id]) => id === entry.status)?.[1]}
                    </span>
                  </button>
                ))}
              {!visible.length && (
                <ResourceState
                  loading={false}
                  empty={
                    draft.items.length
                      ? "検索条件に一致するタスクはありません。"
                      : "タスクを追加して作業を始めましょう。"
                  }
                />
              )}
            </div>
            {item ? (
              <section className={ui.card}>
                <h2>タスクを編集</h2>
                <div className={ui.stack}>
                  <label>
                    タスク名
                    <input
                      required
                      maxLength={90}
                      value={item.title}
                      onChange={(e) => patch({ title: e.target.value })}
                    />
                  </label>
                  <div className={ui.formGrid}>
                    <label>
                      状態
                      <select
                        aria-label="タスクの状態"
                        value={item.status}
                        onChange={(e) =>
                          patch({
                            status: e.target.value as Status,
                            ...(e.target.value === "done"
                              ? { progress: 100 }
                              : {}),
                          })
                        }
                      >
                        {statuses.map(([id, title]) => (
                          <option key={id} value={id}>
                            {title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      優先度
                      <select
                        aria-label="優先度"
                        value={item.priority}
                        onChange={(e) =>
                          patch({
                            priority: e.target.value as Item["priority"],
                          })
                        }
                      >
                        {Object.entries(priorities).map(([id, title]) => (
                          <option key={id} value={id}>
                            {title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      担当者
                      <input
                        maxLength={80}
                        value={item.assignee}
                        onChange={(e) => patch({ assignee: e.target.value })}
                      />
                    </label>
                    <label>
                      期限
                      <input
                        type="date"
                        value={item.dueDate?.slice(0, 10) || ""}
                        onChange={(e) =>
                          patch({ dueDate: e.target.value || null })
                        }
                      />
                    </label>
                    <label>
                      進捗（%）
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={item.progress}
                        onChange={(e) =>
                          patch({ progress: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    概要
                    <textarea
                      maxLength={220}
                      value={item.summary}
                      onChange={(e) => patch({ summary: e.target.value })}
                    />
                  </label>
                  <label>
                    詳細
                    <textarea
                      maxLength={1000}
                      value={item.details}
                      onChange={(e) => patch({ details: e.target.value })}
                    />
                  </label>
                  <StringListInput
                    key={item.id + "-tags"}
                    label="タグ（カンマ区切り）"
                    values={item.tags}
                    onChange={(tags) => patch({ tags })}
                  />
                  <div className={ui.actions}>
                    <button
                      type="button"
                      className={ui.secondary}
                      onClick={() => setSelected("")}
                    >
                      編集を閉じる
                    </button>
                    <button
                      type="button"
                      className={ui.danger}
                      onClick={() => {
                        if (
                          window.confirm(
                            `「${item.title}」を削除しますか？保存するまで確定しません。`,
                          )
                        ) {
                          setDraft({
                            ...draft,
                            items: draft.items.filter(
                              (entry) => entry.id !== item.id,
                            ),
                          });
                          setSelected("");
                        }
                      }}
                    >
                      タスクを削除
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <ResourceState
                loading={false}
                empty="タスクを選択すると、ここで詳細を編集できます。"
              />
            )}
          </div>
          <details className={ui.card}>
            <summary>ボードのタイトル・説明</summary>
            <div className={ui.stack}>
              <label>
                ボード名
                <input
                  required
                  maxLength={120}
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <label>
                ボードの説明
                <textarea
                  maxLength={1200}
                  value={draft.summary}
                  onChange={(e) =>
                    setDraft({ ...draft, summary: e.target.value })
                  }
                />
              </label>
            </div>
          </details>
        </fieldset>
        <SaveBar
          busy={action.busy}
          dirty={dirty}
          form="todo-board"
          label="Discordへ保存"
          onDiscard={() => {
            setDraft(JSON.parse(baseline));
            setSelected("");
          }}
        />
      </form>
    </>
  );
}
