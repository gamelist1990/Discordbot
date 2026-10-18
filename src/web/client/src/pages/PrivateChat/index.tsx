import { useEffect, useState } from "react";
import {
  ServerWorkspace,
  useResource,
  useAction,
  Feedback,
  ResourceState,
  request,
  ui,
} from "../../components/Workspace/Workspace";
import type { PrivateChat, ChatMember } from "../../services/api";
export default function PrivateChatPage() {
  return (
    <ServerWorkspace
      title="プライベートチャット"
      description="部屋を探し、参加メンバーを確認してから管理できます。"
    >
      {(guild) => <Rooms guildId={guild.id} />}
    </ServerWorkspace>
  );
}
function Rooms({ guildId }: { guildId: string }) {
  const resource = useResource<{ chats: PrivateChat[] }>(
    `/api/staff/privatechats?guildId=${guildId}`,
  );
  const action = useAction();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [search, setSearch] = useState("");
  const searchResource = useResource<{
    users: { id: string; username: string; displayName?: string }[];
  }>(
    search.length >= 2 && selected
      ? `/api/staff/searchusers?guildId=${guildId}&chatId=${encodeURIComponent(selected)}&query=${encodeURIComponent(search)}`
      : null,
  );
  const members = useResource<{ members: ChatMember[] }>(
    selected
      ? `/api/staff/privatechats/${encodeURIComponent(selected)}/members?guildId=${guildId}`
      : null,
  );
  const room = resource.data?.chats.find((item) => item.chatId === selected);
  useEffect(() => {
    const stream = new EventSource(
      `/api/staff/privatechats/stream?guildId=${guildId}`,
    );
    stream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "update" && Array.isArray(data.chats))
          resource.setData({ chats: data.chats });
      } catch {
        /* Ignore malformed stream events. */
      }
    };
    stream.onerror = () => stream.close();
    return () => {
      stream.close();
    };
  }, [guildId]);
  const changeRoom = (id: string) => {
    setSelected(id);
    setCreating(false);
    setMemberQuery("");
    setSearch("");
  };
  const addMember = async (username: string) => {
    if (
      await action.run(async () => {
        await request(
          `/api/staff/privatechats/${encodeURIComponent(selected)}/members?guildId=${guildId}`,
          "POST",
          { userName: username },
        );
        members.reload();
      }, "メンバーを追加しました。")
    ) {
      setMemberQuery("");
      setSearch("");
    }
  };
  return (
    <>
      <Feedback {...action} />
      <div className={ui.toolbar}>
        <input
          aria-label="部屋を検索"
          type="search"
          placeholder="部屋名・ユーザー名で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={ui.actions}>
          <button
            type="button"
            className={ui.secondary}
            onClick={resource.reload}
          >
            一覧を更新
          </button>
          <button
            type="button"
            className={ui.primary}
            onClick={() => {
              setCreating(true);
              setSelected("");
            }}
          >
            部屋を作成
          </button>
        </div>
      </div>
      {resource.loading || resource.error ? (
        <ResourceState {...resource} retry={resource.reload} />
      ) : (
        <div className={ui.split}>
          <div className={ui.list}>
            {resource.data?.chats
              .filter((item) =>
                [item.roomName, item.userName, item.staffName].some((text) =>
                  text?.toLowerCase().includes(query.toLowerCase()),
                ),
              )
              .map((item) => (
                <button
                  type="button"
                  className={ui.listButton}
                  aria-current={selected === item.chatId ? "true" : undefined}
                  key={item.chatId}
                  onClick={() => changeRoom(item.chatId)}
                >
                  <span>
                    <strong>
                      {item.roomName || item.userName || "プライベートチャット"}
                    </strong>
                    <small>
                      {item.staffName} ·{" "}
                      {new Date(item.createdAt).toLocaleDateString("ja-JP")}
                    </small>
                  </span>
                  <span className={ui.badge}>
                    {item.channelExists ? "利用中" : "チャンネルなし"}
                  </span>
                </button>
              ))}
            {!resource.data?.chats.length && (
              <ResourceState
                loading={false}
                empty="部屋はありません。「部屋を作成」から追加できます。"
              />
            )}
          </div>
          {creating ? (
            <form
              className={ui.card}
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  await request(
                    `/api/staff/privatechats?guildId=${guildId}`,
                    "POST",
                    { roomName: name.trim(), members: [] },
                  );
                  setName("");
                  setCreating(false);
                  resource.reload();
                }, "部屋を作成しました。");
              }}
            >
              <fieldset disabled={action.busy} className={ui.stack}>
                <h2>新しい部屋</h2>
                <label>
                  部屋名
                  <input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                </label>
                <p>作成後にメンバーを追加できます。</p>
                <div className={ui.actions}>
                  <button type="submit" className={ui.primary}>
                    作成する
                  </button>
                  <button
                    type="button"
                    className={ui.secondary}
                    onClick={() => setCreating(false)}
                  >
                    キャンセル
                  </button>
                </div>
              </fieldset>
            </form>
          ) : room ? (
            <section className={ui.card}>
              <div className={ui.row}>
                <h2>{room.roomName || room.userName}</h2>
                {room.channelExists && (
                  <a
                    className={ui.secondary}
                    href={`https://discord.com/channels/${guildId}/${room.channelId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Discordで開く
                  </a>
                )}
              </div>
              <p>参加メンバーを確認して、必要な人だけ追加してください。</p>
              {members.loading || members.error ? (
                <ResourceState {...members} retry={members.reload} />
              ) : (
                members.data?.members.map((member) => (
                  <div className={ui.entry} key={member.id}>
                    <div>
                      <strong>{member.username}</strong>
                      <small>{member.id}</small>
                    </div>
                    <button
                      type="button"
                      className={ui.danger}
                      disabled={action.busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `${member.username} をこの部屋から外しますか？`,
                          )
                        )
                          void action.run(async () => {
                            await request(
                              `/api/staff/privatechats/${encodeURIComponent(selected)}/members/${member.id}?guildId=${guildId}`,
                              "DELETE",
                            );
                            members.reload();
                          }, "メンバーを外しました。");
                      }}
                    >
                      メンバーから外す
                    </button>
                  </div>
                ))
              )}
              <form
                className={ui.stack}
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearch(memberQuery.trim());
                }}
              >
                <h3>メンバーを追加</h3>
                <label>
                  ユーザー名を検索
                  <input
                    minLength={2}
                    required
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                  />
                </label>
                <button className={ui.secondary} type="submit">
                  ユーザーを検索
                </button>
              </form>
              {searchResource.loading || searchResource.error ? (
                <ResourceState
                  {...searchResource}
                  retry={searchResource.reload}
                />
              ) : (
                searchResource.data?.users.map((user) => (
                  <div className={ui.entry} key={user.id}>
                    <span>
                      {user.displayName || user.username}
                      <small>@{user.username}</small>
                    </span>
                    <button
                      type="button"
                      className={ui.secondary}
                      disabled={action.busy}
                      onClick={() => void addMember(user.username)}
                    >
                      追加
                    </button>
                  </div>
                ))
              )}
              {search && searchResource.data?.users.length === 0 && (
                <p>一致するユーザーはいません。</p>
              )}
              <hr className={ui.divider} />
              <button
                type="button"
                className={ui.danger}
                disabled={action.busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "この部屋とDiscordチャンネルを削除します。よろしいですか？",
                    )
                  )
                    void action.run(async () => {
                      await request(
                        `/api/staff/privatechats/${encodeURIComponent(selected)}?guildId=${guildId}`,
                        "DELETE",
                      );
                      changeRoom("");
                      resource.reload();
                    }, "部屋を削除しました。");
                }}
              >
                この部屋を削除
              </button>
            </section>
          ) : (
            <ResourceState
              loading={false}
              empty="左の一覧から部屋を選択してください。スマホでは一覧の下に編集画面が開きます。"
            />
          )}
        </div>
      )}
    </>
  );
}
