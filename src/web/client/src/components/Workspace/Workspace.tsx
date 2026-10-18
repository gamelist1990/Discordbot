import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import styles from "./Workspace.module.css";
export { styles as ui };
export type Guild = { id: string; name: string };
export type Channel = { id: string; name: string; type: number };
export type Role = {
  id: string;
  name: string;
  managed?: boolean;
  position?: number;
};
export const confirmWorkspaceLeave = () =>
  window.dispatchEvent(
    new Event("workspace-before-leave", { cancelable: true }),
  );
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const leave = (event: Event) => {
      if (!window.confirm("未保存の変更があります。保存せずに移動しますか？"))
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("workspace-before-leave", leave);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("workspace-before-leave", leave);
    };
  }, [dirty]);
}
export async function request<T = any>(
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "include",
    signal,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error ||
        data.errors?.join("\n") ||
        `通信に失敗しました（${response.status}）`,
    );
  return data;
}
export function useResource<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const previousUrl = useRef(url);
  useEffect(() => {
    if (previousUrl.current !== url) setData(null);
    previousUrl.current = url;
    setError("");
    if (!url) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    request<T>(url, "GET", undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setData(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision]);
  return {
    data: previousUrl.current === url ? data : null,
    setData,
    loading:
      (loading || previousUrl.current !== url) &&
      (data === null || previousUrl.current !== url),
    refreshing: loading,
    error,
    reload: () => setRevision((value) => value + 1),
  };
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const run = async (
    action: () => Promise<unknown>,
    message = "保存しました。",
  ) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "処理に失敗しました。");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { busy, error, notice, run };
}
export function Feedback({
  error,
  notice,
}: {
  error?: string;
  notice?: string;
}) {
  return (
    <>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <div role="status" aria-live="polite">
        {notice && <div className={styles.notice}>{notice}</div>}
      </div>
    </>
  );
}

export function StringListInput({
  label,
  values,
  onChange,
  spaces = false,
  maxItems = 10,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  spaces?: boolean;
  maxItems?: number;
}) {
  const canonical = values.join(spaces ? " " : ", ");
  const [text, setText] = useState(canonical);
  const parse = (text: string) =>
    text
      .split(spaces ? /\s+/ : /,/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, maxItems);
  useEffect(() => {
    setText((current) =>
      parse(current).join(spaces ? " " : ", ") === canonical
        ? current
        : canonical,
    );
  }, [canonical, spaces]);
  return (
    <label>
      {label}
      <input
        aria-label={label}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(parse(event.target.value));
        }}
      />
    </label>
  );
}
export function ResourceState({
  loading,
  error,
  retry,
  empty = "データがありません。",
}: {
  loading: boolean;
  error?: string;
  retry?: () => void;
  empty?: string;
}) {
  return (
    <div className={styles.empty} role={error ? "alert" : "status"}>
      <p>{loading ? "読み込んでいます…" : error || empty}</p>
      {!loading && retry && (
        <button className={styles.secondary} type="button" onClick={retry}>
          再取得
        </button>
      )}
    </div>
  );
}
export function ServerWorkspace({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: (guild: Guild) => ReactNode;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const route = useParams();
  const resource = useResource<{ guilds: Guild[] }>("/api/staff/guilds");
  const [chosen, setChosen] = useState(
    params.get("guildId") || route.guildId || "",
  );
  const routeGuild = params.get("guildId") || route.guildId || "";
  useEffect(() => {
    setChosen(routeGuild);
  }, [routeGuild]);
  const guild =
    resource.data?.guilds.find((item) => item.id === chosen) ||
    resource.data?.guilds[0];
  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.back}
        onClick={() => {
          if (confirmWorkspaceLeave()) navigate("/staff");
        }}
      >
        ← スタッフツール
      </button>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>COMMUNITY / WORKSPACE</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <div className={styles.serverBar}>
        <label>
          操作するサーバー
          <select
            aria-label="操作するサーバー"
            value={guild?.id || ""}
            onChange={(event) => {
              if (confirmWorkspaceLeave()) setChosen(event.target.value);
            }}
          >
            {!guild && <option value="">サーバーを選択</option>}
            {resource.data?.guilds.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <span>操作対象を確認してから変更してください。</span>
      </div>
      {resource.loading || resource.error || !guild ? (
        <ResourceState
          {...resource}
          retry={resource.reload}
          empty="操作できるサーバーがありません。権限を確認してください。"
        />
      ) : (
        <div key={guild.id}>{children(guild)}</div>
      )}
    </div>
  );
}
export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly (readonly [T, string])[];
}) {
  return (
    <nav className={styles.tabs} aria-label="ページ内メニュー">
      {options.map(([id, label]) => (
        <button
          type="button"
          key={id}
          aria-current={value === id ? "page" : undefined}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
export function SaveBar({
  busy,
  dirty,
  onDiscard,
  label = "変更を保存",
  form,
}: {
  busy: boolean;
  dirty: boolean;
  onDiscard: () => void;
  label?: string;
  form: string;
}) {
  useUnsavedChanges(dirty);
  return (
    <footer className={styles.saveBar}>
      <strong>
        {busy
          ? "保存しています…"
          : dirty
            ? "未保存の変更があります"
            : "保存済み"}
      </strong>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy || !dirty}
          onClick={() => {
            if (window.confirm("未保存の変更を取り消しますか？")) onDiscard();
          }}
        >
          変更を取り消す
        </button>
        <button
          type="submit"
          form={form}
          className={styles.primary}
          disabled={busy || !dirty}
        >
          {busy ? "保存中…" : label}
        </button>
      </div>
    </footer>
  );
}
export function ChannelSelect({
  label,
  value,
  onChange,
  channels,
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  channels: Channel[];
  optional?: boolean;
}) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        required={!optional}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{optional ? "指定しない" : "チャンネルを選択"}</option>
        {channels
          .filter((channel) => [0, 5].includes(channel.type))
          .map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{channel.name}
            </option>
          ))}
      </select>
    </label>
  );
}
export function RoleSelect({
  label,
  value,
  onChange,
  roles,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  roles: Role[];
}) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">指定しない</option>
        {roles
          .filter((role) => !role.managed)
          .map((role) => (
            <option key={role.id} value={role.id}>
              @{role.name}
            </option>
          ))}
      </select>
    </label>
  );
}
