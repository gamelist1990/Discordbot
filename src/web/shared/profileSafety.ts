/** Data, never HTML/CSS/JavaScript. Used on writes and again on reads of legacy profiles. */
export function safeWebUrl(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(value)
  )
    return;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    return url.href;
  } catch {
    return;
  }
}
export const safeColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
export const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function publicProfileFields(input: unknown): Record<string, any> {
  const profile = normalizeProfile(input).profile;
  // Public pages never receive private guild/preset selections from the editor.
  if (profile.overviewConfig)
    profile.overviewConfig = { cards: profile.overviewConfig.cards || [] };
  if (!profile.privacy?.showActivity) profile.activitySource = "none";
  return profile;
}

export function normalizeProfile(input: unknown): {
  profile: Record<string, any>;
  errors: string[];
} {
  const profile: Record<string, any> = {};
  const errors: string[] = [];
  if (!isRecord(input))
    return {
      profile,
      errors: ["プロフィールはオブジェクトで指定してください。"],
    };
  const text = (
    source: Record<string, any>,
    target: Record<string, any>,
    key: string,
    max: number,
  ) => {
    if (source[key] === undefined) return;
    if (typeof source[key] !== "string" || source[key].length > max)
      errors.push(`${key} は${max}文字以内の文字列で指定してください。`);
    else target[key] = source[key];
  };
  const url = (
    source: Record<string, any>,
    target: Record<string, any>,
    key: string,
  ) => {
    if (source[key] === undefined) return;
    if (source[key] === "") target[key] = "";
    else {
      const value = safeWebUrl(source[key]);
      if (value) target[key] = value;
      else errors.push(`${key} は http / https のURLを指定してください。`);
    }
  };
  const color = (
    source: Record<string, any>,
    target: Record<string, any>,
    key: string,
  ) => {
    if (source[key] === undefined) return;
    if (safeColor(source[key])) target[key] = source[key];
    else errors.push(`${key} は #RRGGBB 形式で指定してください。`);
  };
  for (const [key, max] of Object.entries({
    displayName: 32,
    bio: 500,
    pronouns: 40,
  }))
    text(input, profile, key, max);
  url(input, profile, "website");
  url(input, profile, "favoriteImage");
  color(input, profile, "themeColor");
  if (input.location !== undefined) {
    const location =
      typeof input.location === "string"
        ? { label: input.location }
        : input.location;
    if (!isRecord(location)) errors.push("場所の形式が不正です。");
    else {
      const target = {};
      text(location, target, "label", 100);
      text(location, target, "code", 8);
      text(location, target, "emoji", 20);
      url(location, target, "url");
      profile.location = target;
    }
  }
  if (input.privacy !== undefined) {
    if (!isRecord(input.privacy)) errors.push("公開範囲の形式が不正です。");
    else {
      const target: Record<string, boolean> = {};
      for (const key of [
        "allowPublicView",
        "showStats",
        "showServers",
        "showActivity",
      ]) {
        if (input.privacy[key] !== undefined) {
          if (typeof input.privacy[key] !== "boolean")
            errors.push(`${key} は真偽値で指定してください。`);
          else target[key] = input.privacy[key];
        }
      }
      profile.privacy = target;
    }
  }
  if (input.banner !== undefined) {
    const banner = input.banner;
    if (
      !isRecord(banner) ||
      !["color", "gradient", "image", "pattern"].includes(banner.type)
    )
      errors.push("バナーの種類が不正です。");
    else {
      const target: Record<string, any> = { type: banner.type };
      if (banner.type === "color") {
        color(banner, target, "value");
        if (!safeColor(banner.value)) {
          if (banner.value === undefined)
            errors.push("バナーの色を指定してください。");
          target.value = "#537763";
        }
      }
      if (banner.type === "image") {
        url(banner, target, "value");
        if (!safeWebUrl(banner.value)) {
          if (!banner.value) errors.push("バナー画像のURLを指定してください。");
          target.type = "color";
          target.value = "#537763";
        }
      }
      if (banner.type === "pattern") {
        if (["dots", "grid"].includes(banner.value))
          target.value = banner.value;
        else {
          errors.push("バナーパターンが不正です。");
          target.value = "dots";
        }
      }
      if (banner.type === "gradient") {
        const gradient = banner.gradient;
        if (
          !isRecord(gradient) ||
          !Array.isArray(gradient.colors) ||
          gradient.colors.length < 2 ||
          gradient.colors.length > 4 ||
          !gradient.colors.every(safeColor) ||
          !["horizontal", "vertical", "diagonal"].includes(gradient.direction)
        ) {
          errors.push("グラデーションの設定が不正です。");
          target.gradient = {
            colors: ["#537763", "#97bea5"],
            direction: "horizontal",
          };
        } else
          target.gradient = {
            colors: [...gradient.colors],
            direction: gradient.direction,
          };
        target.value = "";
      }
      profile.banner = target;
    }
  }
  if (input.favoriteEmojis !== undefined) {
    if (
      !Array.isArray(input.favoriteEmojis) ||
      input.favoriteEmojis.length > 10
    )
      errors.push("絵文字は10個まで指定できます。");
    else
      profile.favoriteEmojis = input.favoriteEmojis.flatMap((item) => {
        if (!isRecord(item)) {
          errors.push("絵文字の形式が不正です。");
          return [];
        }
        const target = {};
        text(item, target, "emoji", 100);
        text(item, target, "label", 50);
        return [target];
      });
  }
  if (input.activitySource !== undefined) {
    if (!["ranking", "stats", "none"].includes(input.activitySource))
      errors.push("活動表示の設定が不正です。");
    else profile.activitySource = input.activitySource;
  }
  if (input.overviewConfig !== undefined) {
    if (!isRecord(input.overviewConfig)) errors.push("カード設定が不正です。");
    else {
      const config: Record<string, any> = {};
      if (input.overviewConfig.cards !== undefined) {
        if (
          !Array.isArray(input.overviewConfig.cards) ||
          input.overviewConfig.cards.length > 48
        )
          errors.push("カードは48枚までです。");
        else
          config.cards = input.overviewConfig.cards.flatMap((card: unknown) => {
            if (
              !isRecord(card) ||
              !["text", "image", "sticker"].includes(card.type)
            ) {
              errors.push("カードの形式が不正です。");
              return [];
            }
            const target: Record<string, any> = { type: card.type };
            text(card, target, "id", 100);
            text(card, target, "content", card.type === "sticker" ? 200 : 2000);
            if (card.type === "image") url(card, target, "content");
            for (const [key, min, max] of [
              ["x", 0, 4000],
              ["y", 0, 4000],
              ["pxW", 20, 1200],
              ["pxH", 20, 1200],
              ["w", 1, 12],
              ["h", 1, 12],
              ["rotation", -360, 360],
              ["zIndex", 0, 100],
              ["opacity", 0, 1],
            ] as const) {
              if (card[key] === undefined) continue;
              if (
                typeof card[key] !== "number" ||
                !Number.isFinite(card[key]) ||
                card[key] < min ||
                card[key] > max
              )
                errors.push(`カードの ${key} が不正です。`);
              else target[key] = card[key];
            }
            if (card.meta !== undefined) {
              if (!isRecord(card.meta))
                errors.push("カードの装飾設定が不正です。");
              else {
                const meta: Record<string, any> = {};
                color(card.meta, meta, "color");
                if (
                  typeof card.meta.fontSize === "number" &&
                  card.meta.fontSize >= 10 &&
                  card.meta.fontSize <= 72
                )
                  meta.fontSize = card.meta.fontSize;
                if (["left", "center", "right"].includes(card.meta.align))
                  meta.align = card.meta.align;
                const weight = typeof card.meta.fontWeight === 'string' || typeof card.meta.fontWeight === 'number' ? String(card.meta.fontWeight) : '';
                if (["400", "500", "600", "700", "bold", "normal"].includes(weight)) meta.fontWeight = weight;
                else if (card.meta.fontWeight !== undefined) errors.push('カードの文字の太さが不正です。');
                if (
                  ["sans-serif", "serif", "monospace"].includes(
                    card.meta.fontFamily,
                  )
                )
                  meta.fontFamily = card.meta.fontFamily;
                target.meta = meta;
              }
            }
            return [target];
          });
      }
      if (input.overviewConfig.widgets !== undefined) {
        if (
          !Array.isArray(input.overviewConfig.widgets) ||
          input.overviewConfig.widgets.length > 6
        )
          errors.push("ウィジェットは6個までです。");
        else
          config.widgets = input.overviewConfig.widgets.flatMap(
            (item: unknown) => {
              if (
                !isRecord(item) ||
                !["ranking", "rankPosition", "custom", "stats"].includes(
                  item.type,
                )
              ) {
                errors.push("ウィジェットの形式が不正です。");
                return [];
              }
              const target = { type: item.type };
              text(item, target, "guildId", 20);
              text(item, target, "preset", 100);
              return [target];
            },
          );
      }
      profile.overviewConfig = config;
    }
  }
  return { profile, errors };
}
