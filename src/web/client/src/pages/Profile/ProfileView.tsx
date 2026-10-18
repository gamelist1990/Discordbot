import type { CSSProperties } from "react";
import {
  normalizeProfile,
  safeColor,
  safeWebUrl,
} from "../../../../shared/profileSafety";
import styles from "./ProfileView.module.css";
export function ProfileView({
  custom,
  username = "プレビュー",
  avatar,
  compact = false,
}: {
  custom: unknown;
  username?: string;
  avatar?: string | null;
  compact?: boolean;
}) {
  const data = normalizeProfile(custom).profile;
  const banner = data.banner;
  const background: CSSProperties = {
    background: safeColor(data.themeColor) ? data.themeColor : "#537763",
  };
  if (banner?.type === "color" && safeColor(banner.value))
    background.background = banner.value;
  if (banner?.type === "gradient" && banner.gradient)
    background.background = `linear-gradient(${({ horizontal: "to right", vertical: "to bottom", diagonal: "135deg" } as Record<string, string>)[banner.gradient.direction]},${banner.gradient.colors.join(",")})`;
  if (banner?.type === "image" && safeWebUrl(banner.value))
    background.backgroundImage = `url(${JSON.stringify(safeWebUrl(banner.value))})`;
  if (banner?.type === "pattern")
    background.backgroundImage =
      banner.value === "grid"
        ? "repeating-linear-gradient(0deg,transparent,transparent 23px,#ffffff24 24px),repeating-linear-gradient(90deg,transparent,transparent 23px,#ffffff24 24px)"
        : "radial-gradient(#ffffff66 1.5px, transparent 1.5px)";
  return (
    <div
      className={styles.profile}
      data-compact={compact}
      style={
        {
          "--profile-accent": safeColor(data.themeColor)
            ? data.themeColor
            : "#537763",
        } as CSSProperties
      }
    >
      <div className={styles.banner} style={background} />
      <div className={styles.identity}>
        {safeWebUrl(avatar) ? (
          <img
            className={styles.avatar}
            src={safeWebUrl(avatar)}
            referrerPolicy="no-referrer"
            alt=""
          />
        ) : (
          <span className={styles.fallback} aria-hidden="true">
            {(data.displayName || username).slice(0, 1)}
          </span>
        )}
        <div>
          <h2>{data.displayName || username}</h2>
          <p>
            @{username}
            {data.pronouns && ` · ${data.pronouns}`}
          </p>
        </div>
      </div>
      <div className={styles.body}>
        {data.bio && <p className={styles.bio}>{data.bio}</p>}
        <div className={styles.links}>
          {data.location?.label && (
            <span>
              {data.location.emoji}{" "}
              {safeWebUrl(data.location.url) ? (
                <a
                  href={safeWebUrl(data.location.url)}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {data.location.label} ↗
                </a>
              ) : (
                data.location.label
              )}
            </span>
          )}
          {safeWebUrl(data.website) && (
            <a
              href={safeWebUrl(data.website)}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {new URL(safeWebUrl(data.website)!).hostname} ↗
            </a>
          )}
        </div>
        {!!data.favoriteEmojis?.length && (
          <div className={styles.emojis}>
            {data.favoriteEmojis.map((item: any, i: number) => (
              <span key={i} title={item.label}>
                {item.emoji}
              </span>
            ))}
          </div>
        )}
        {safeWebUrl(data.favoriteImage) && (
          <img
            className={styles.favorite}
            src={safeWebUrl(data.favoriteImage)}
            referrerPolicy="no-referrer"
            loading="lazy"
            alt="お気に入りの画像"
          />
        )}
        {!!data.overviewConfig?.cards?.length && (
          <section className={styles.cards} aria-label="プロフィールカード">
            {data.overviewConfig.cards.map((card: any, index: number) => (
              <article
                className={styles.card}
                key={card.id || index}
                style={{
                  color: safeColor(card.meta?.color)
                    ? card.meta.color
                    : undefined,
                  fontSize: card.meta?.fontSize,
                  textAlign: card.meta?.align,
                  fontWeight: card.meta?.fontWeight,
                  fontFamily: card.meta?.fontFamily,
                  gridColumn: card.pxW >= 500 ? "1 / -1" : undefined,
                }}
              >
                {card.type === "image" ? (
                  safeWebUrl(card.content) && (
                    <img
                      src={safeWebUrl(card.content)}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      alt="プロフィール画像カード"
                    />
                  )
                ) : (
                  <p>{card.content}</p>
                )}
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
