import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeProfile } from "../../../../shared/profileSafety";
import {
  useResource,
  useAction,
  Feedback,
  ResourceState,
  SaveBar,
  Tabs,
  confirmWorkspaceLeave,
  StringListInput,
  ui,
} from "../../components/Workspace/Workspace";
import { ProfileView } from "./ProfileView";
type Custom = Record<string, any>;
export default function ProfileSettings() {
  const navigate = useNavigate();
  const resource = useResource<Custom>("/api/user/profile/custom");
  const identity = useResource<{ username: string; avatar?: string }>(
    "/api/user/profile",
  );
  const [draft, setDraft] = useState<Custom | null>(null);
  const [baseline, setBaseline] = useState("");
  const [tab, setTab] = useState<"basic" | "design" | "cards" | "privacy">(
    "basic",
  );
  const action = useAction();
  useEffect(() => {
    if (resource.data) {
      const next = {
        ...normalizeProfile(resource.data).profile,
        privacy: {
          allowPublicView: false,
          showStats: false,
          showServers: false,
          showActivity: false,
          ...resource.data.privacy,
        },
      };
      setDraft(next);
      setBaseline(JSON.stringify(next));
    }
  }, [resource.data]);
  const patch = (value: Custom) =>
    setDraft((current) => ({ ...current, ...value }));
  const banner = draft?.banner || { type: "color", value: "#537763" };
  const cards: Custom[] = draft?.overviewConfig?.cards || [];
  const setCards = (cards: Custom[]) =>
    patch({ overviewConfig: { ...draft?.overviewConfig, cards } });
  const updateCard = (index: number, value: Custom) =>
    setCards(
      cards.map((entry, i) => (index === i ? { ...entry, ...value } : entry)),
    );
  const moveCard = (index: number, delta: number) => {
    const next = [...cards];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setCards(next);
  };
  const colors = [
    "#537763",
    "#496b91",
    "#94704f",
    "#8e6688",
    "#37352f",
    "#b55f62",
  ];
  return (
    <div className={ui.page}>
      <button
        type="button"
        className={ui.back}
        onClick={() => {
          if (confirmWorkspaceLeave()) navigate("/profile");
        }}
      >
        ← プロフィール
      </button>
      <header className={ui.header}>
        <div>
          <span className={ui.eyebrow}>YOUR SPACE</span>
          <h1>プロフィールを編集</h1>
          <p>
            見た目も紹介内容も、自分らしく。プレビューで仕上がりを確認できます。
          </p>
        </div>
      </header>
      {resource.loading || resource.error || !draft ? (
        <ResourceState {...resource} retry={resource.reload} />
      ) : (
        <>
          <Feedback {...action} />
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              ["basic", "基本情報"],
              ["design", "デザイン"],
              ["cards", "自由に並べるカード"],
              ["privacy", "公開範囲"],
            ]}
          />
          <details className={`${ui.card} ${ui.mobilePreview}`}>
            <summary>表示プレビューを開く</summary>
            <ProfileView
              custom={draft}
              username={identity.data?.username || "あなた"}
              avatar={identity.data?.avatar}
              compact
            />
          </details>
          <form
            id="profile-settings"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                const normalized = normalizeProfile(draft);
                if (normalized.errors.length)
                  throw new Error(normalized.errors.join("\n"));
                const response = await fetch("/api/user/profile/custom", {
                  method: "PUT",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(normalized.profile),
                });
                const data = await response.json();
                if (!response.ok)
                  throw new Error(
                    data.error ||
                      data.errors?.join("\n") ||
                      "プロフィールを保存できませんでした。",
                  );
                resource.setData(data.profile);
              }, "プロフィールを保存しました。");
            }}
          >
            <fieldset disabled={action.busy} className={ui.grid}>
              <div className={ui.stack}>
                {tab === "basic" && (
                  <section className={ui.card}>
                    <h2>自己紹介とリンク</h2>
                    <div className={ui.stack}>
                      <label>
                        表示名
                        <input
                          maxLength={32}
                          value={draft.displayName || ""}
                          onChange={(e) =>
                            patch({ displayName: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        自己紹介
                        <textarea
                          maxLength={500}
                          value={draft.bio || ""}
                          onChange={(e) => patch({ bio: e.target.value })}
                        />
                        <small>{(draft.bio || "").length} / 500文字</small>
                      </label>
                      <label>
                        代名詞・呼び方
                        <input
                          maxLength={40}
                          value={draft.pronouns || ""}
                          onChange={(e) => patch({ pronouns: e.target.value })}
                          placeholder="例：he/him、she/her"
                        />
                      </label>
                      <label>
                        場所
                        <input
                          maxLength={100}
                          value={draft.location?.label || ""}
                          onChange={(e) =>
                            patch({
                              location: {
                                ...draft.location,
                                label: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        場所のリンク（任意）
                        <input
                          type="url"
                          value={draft.location?.url || ""}
                          onChange={(e) =>
                            patch({
                              location: {
                                ...draft.location,
                                url: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        ウェブサイト
                        <input
                          type="url"
                          value={draft.website || ""}
                          placeholder="https://…"
                          onChange={(e) => patch({ website: e.target.value })}
                        />
                      </label>
                      <label>
                        お気に入りの画像URL
                        <input
                          type="url"
                          value={draft.favoriteImage || ""}
                          onChange={(e) =>
                            patch({ favoriteImage: e.target.value })
                          }
                        />
                      </label>
                    </div>
                  </section>
                )}
                {tab === "design" && (
                  <section className={ui.card}>
                    <h2>カラーとバナー</h2>
                    <div className={ui.stack}>
                      <label>
                        テーマカラー
                        <input
                          type="color"
                          value={draft.themeColor || "#537763"}
                          onChange={(e) =>
                            patch({ themeColor: e.target.value })
                          }
                        />
                      </label>
                      <div className={ui.actions}>
                        {colors.map((color) => (
                          <button
                            type="button"
                            key={color}
                            className={ui.secondary}
                            aria-label={`テーマ色 ${color}`}
                            style={{ borderBottom: "4px solid " + color }}
                            onClick={() => patch({ themeColor: color })}
                          >
                            {color}
                          </button>
                        ))}
                      </div>
                      <label>
                        バナーの種類
                        <select
                          aria-label="バナーの種類"
                          value={banner.type}
                          onChange={(e) =>
                            patch({
                              banner: {
                                type: e.target.value,
                                value:
                                  e.target.value === "pattern"
                                    ? "dots"
                                    : e.target.value === "color"
                                      ? "#537763"
                                      : "",
                                ...(e.target.value === "gradient"
                                  ? {
                                      gradient: {
                                        colors: ["#537763", "#97bea5"],
                                        direction: "horizontal",
                                      },
                                    }
                                  : {}),
                              },
                            })
                          }
                        >
                          <option value="color">単色</option>
                          <option value="gradient">グラデーション</option>
                          <option value="image">画像</option>
                          <option value="pattern">パターン</option>
                        </select>
                      </label>
                      {banner.type === "color" && (
                        <label>
                          バナーの色
                          <input
                            type="color"
                            value={banner.value}
                            onChange={(e) =>
                              patch({
                                banner: { ...banner, value: e.target.value },
                              })
                            }
                          />
                        </label>
                      )}
                      {banner.type === "image" && (
                        <label>
                          バナー画像のURL
                          <input
                            type="url"
                            required
                            value={banner.value}
                            onChange={(e) =>
                              patch({
                                banner: { ...banner, value: e.target.value },
                              })
                            }
                          />
                        </label>
                      )}
                      {banner.type === "pattern" && (
                        <label>
                          パターン
                          <select
                            aria-label="バナーパターン"
                            value={banner.value}
                            onChange={(e) =>
                              patch({
                                banner: { ...banner, value: e.target.value },
                              })
                            }
                          >
                            <option value="dots">ドット</option>
                            <option value="grid">グリッド</option>
                          </select>
                        </label>
                      )}
                      {banner.type === "gradient" && (
                        <>
                          <div className={ui.formGrid}>
                            {banner.gradient.colors.map(
                              (color: string, index: number) => (
                                <label key={index}>
                                  色 {index + 1}
                                  <input
                                    type="color"
                                    value={color}
                                    onChange={(e) =>
                                      patch({
                                        banner: {
                                          ...banner,
                                          gradient: {
                                            ...banner.gradient,
                                            colors: banner.gradient.colors.map(
                                              (value: string, i: number) =>
                                                i === index
                                                  ? e.target.value
                                                  : value,
                                            ),
                                          },
                                        },
                                      })
                                    }
                                  />
                                </label>
                              ),
                            )}
                          </div>
                          <label>
                            向き
                            <select
                              aria-label="グラデーションの向き"
                              value={banner.gradient.direction}
                              onChange={(e) =>
                                patch({
                                  banner: {
                                    ...banner,
                                    gradient: {
                                      ...banner.gradient,
                                      direction: e.target.value,
                                    },
                                  },
                                })
                              }
                            >
                              <option value="horizontal">横</option>
                              <option value="vertical">縦</option>
                              <option value="diagonal">斜め</option>
                            </select>
                          </label>
                        </>
                      )}
                      <StringListInput
                        label="お気に入りの絵文字（スペース区切り・最大10個）"
                        spaces
                        values={
                          draft.favoriteEmojis?.map(
                            (entry: any) => entry.emoji,
                          ) || []
                        }
                        onChange={(values) =>
                          patch({
                            favoriteEmojis: values.map((emoji) => ({ emoji })),
                          })
                        }
                      />
                    </div>
                  </section>
                )}
                {tab === "cards" && (
                  <section className={ui.card}>
                    <h2>プロフィールカード</h2>
                    <p>
                      文章・画像・絵文字のカードを並べてページを作れます。変更はプレビューに反映されます。
                    </p>
                    <div className={ui.stack}>
                      {cards.map((card, index) => (
                        <section className={ui.card} key={card.id || index}>
                          <div className={ui.row}>
                            <strong>カード {index + 1}</strong>
                            <div className={ui.actions}>
                              <button
                                type="button"
                                aria-label={`カード${index + 1}を上へ`}
                                className={ui.secondary}
                                disabled={index === 0}
                                onClick={() => moveCard(index, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`カード${index + 1}を下へ`}
                                className={ui.secondary}
                                disabled={index === cards.length - 1}
                                onClick={() => moveCard(index, 1)}
                              >
                                ↓
                              </button>
                            </div>
                          </div>
                          <label>
                            種類
                            <select
                              aria-label={`カード${index + 1}の種類`}
                              value={card.type}
                              onChange={(e) =>
                                updateCard(index, {
                                  type: e.target.value,
                                  content: "",
                                })
                              }
                            >
                              <option value="text">文章</option>
                              <option value="image">画像</option>
                              <option value="sticker">
                                絵文字・ステッカー
                              </option>
                            </select>
                          </label>
                          <label>
                            内容
                            {card.type === "image" ? (
                              <input
                                aria-label={`カード${index + 1}の内容`}
                                type="url"
                                required
                                value={card.content}
                                onChange={(e) =>
                                  updateCard(index, { content: e.target.value })
                                }
                              />
                            ) : (
                              <textarea
                                aria-label={`カード${index + 1}の内容`}
                                maxLength={card.type === "sticker" ? 200 : 2000}
                                value={card.content}
                                onChange={(e) =>
                                  updateCard(index, { content: e.target.value })
                                }
                              />
                            )}
                          </label>
                          <div className={ui.formGrid}>
                            <label>
                              カードの幅
                              <select
                                aria-label={`カード${index + 1}の幅`}
                                value={card.pxW >= 500 ? "full" : "half"}
                                onChange={(e) =>
                                  updateCard(index, {
                                    pxW: e.target.value === "full" ? 700 : 300,
                                  })
                                }
                              >
                                <option value="half">半分</option>
                                <option value="full">全幅</option>
                              </select>
                            </label>
                            <label>
                              文字サイズ
                              <input
                                type="number"
                                min={10}
                                max={72}
                                value={card.meta?.fontSize || 16}
                                onChange={(e) =>
                                  updateCard(index, {
                                    meta: {
                                      ...card.meta,
                                      fontSize: Number(e.target.value),
                                    },
                                  })
                                }
                              />
                            </label>
                            <label>
                              文字色
                              <input
                                type="color"
                                value={card.meta?.color || "#537763"}
                                onChange={(e) =>
                                  updateCard(index, {
                                    meta: {
                                      ...card.meta,
                                      color: e.target.value,
                                    },
                                  })
                                }
                              />
                            </label>
                            <label>
                              文字の配置
                              <select
                                aria-label={`カード${index + 1}の文字配置`}
                                value={card.meta?.align || "left"}
                                onChange={(e) =>
                                  updateCard(index, {
                                    meta: {
                                      ...card.meta,
                                      align: e.target.value,
                                    },
                                  })
                                }
                              >
                                <option value="left">左</option>
                                <option value="center">中央</option>
                                <option value="right">右</option>
                              </select>
                            </label>
                          </div>
                          <button
                            type="button"
                            className={ui.danger}
                            onClick={() => {
                              if (window.confirm("このカードを削除しますか？"))
                                setCards(cards.filter((_, i) => i !== index));
                            }}
                          >
                            カードを削除
                          </button>
                        </section>
                      ))}
                      <button
                        type="button"
                        className={ui.primary}
                        disabled={cards.length >= 48}
                        onClick={() =>
                          setCards([
                            ...cards,
                            {
                              id: crypto.randomUUID(),
                              type: "text",
                              content: "",
                              pxW: 700,
                              pxH: 160,
                              x: 0,
                              y: 0,
                            },
                          ])
                        }
                      >
                        カードを追加
                      </button>
                    </div>
                  </section>
                )}
                {tab === "privacy" && (
                  <section className={ui.card}>
                    <h2>プロフィールの公開範囲</h2>
                    <p>
                      公開したプロフィールは、ログイン中の他のユーザーが閲覧できます。検索には共通サーバーの公開メンバーのみ表示されます。
                    </p>
                    <div className={ui.stack}>
                      {Object.entries({
                        allowPublicView: "他のユーザーにプロフィールを公開する",
                        showStats: "活動の統計を公開する",
                        showServers: "共通の参加サーバーを公開する",
                        showActivity: "活動情報を公開する",
                      }).map(([key, label]) => (
                        <label className={ui.check} key={key}>
                          <input
                            type="checkbox"
                            checked={draft.privacy?.[key] === true}
                            onChange={(e) =>
                              patch({
                                privacy: {
                                  ...draft.privacy,
                                  [key]: e.target.checked,
                                },
                              })
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className={ui.hint}>
                      自己紹介やカードはテキストとして表示されます。リンクと画像は
                      http / https のURLに対応します。
                    </div>
                  </section>
                )}
              </div>
              <aside className={ui.desktopPreview}>
                <h2>表示プレビュー</h2>
                <ProfileView
                  custom={draft}
                  username={identity.data?.username || "あなた"}
                  avatar={identity.data?.avatar}
                  compact
                />
                <p className={ui.muted}>
                  プレビューは編集中の内容です。保存するとプロフィールに反映されます。
                </p>
              </aside>
            </fieldset>
            <SaveBar
              busy={action.busy}
              dirty={JSON.stringify(draft) !== baseline}
              form="profile-settings"
              onDiscard={() => setDraft(JSON.parse(baseline))}
            />
          </form>
        </>
      )}
    </div>
  );
}
