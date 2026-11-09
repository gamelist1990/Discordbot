/**
 * Helpers for Discord forwarded messages.
 *
 * A forward embeds snapshots of the original messages on
 * `message.messageSnapshots`; the forwarded body lives on those snapshots,
 * not on `message.content` (a pure forward leaves content empty). Text
 * detectors must judge the effective content or forwarded posts are
 * invisible to them.
 *
 * This module is intentionally dependency-free: low-level detectors such as
 * ContentSafetyDetector import it, and pulling in heavier shared modules
 * (e.g. the cache) from there changes module-load side effects for every
 * consumer.
 */

export interface ForwardedSnapshotLike {
    content?: string | null;
    attachments?: unknown;
    embeds?: unknown;
}

/**
 * Snapshots embedded in a message by Discord's forward feature.
 * discord.js exposes them as a Collection of Message-shaped objects.
 */
export function getForwardedSnapshots(message: { messageSnapshots?: unknown }): ForwardedSnapshotLike[] {
    const snapshots = (message as { messageSnapshots?: unknown } | null | undefined)?.messageSnapshots as any;
    if (!snapshots) return [];
    const values = typeof snapshots.values === 'function'
        ? Array.from(snapshots.values())
        : Array.isArray(snapshots) ? snapshots : [];
    return values.filter((snapshot): snapshot is ForwardedSnapshotLike =>
        !!snapshot && typeof snapshot === 'object');
}

export function hasForwardedContent(message: { messageSnapshots?: unknown }): boolean {
    return getForwardedSnapshots(message).length > 0;
}

/**
 * The text a post effectively presents: the author's own text plus the body
 * of every forwarded snapshot, in order. Without snapshots this is exactly
 * message.content, so non-forward behavior is unchanged.
 */
export function getEffectiveContent(message: { content?: string | null; messageSnapshots?: unknown }): string {
    const own = typeof message?.content === 'string' ? message.content : '';
    const snapshots = getForwardedSnapshots(message || {});
    if (!snapshots.length) return own;
    const parts = [own, ...snapshots.map((snapshot) => typeof snapshot.content === 'string' ? snapshot.content : '')]
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    return parts.join('\n');
}

/** Origin metadata a snapshot may carry (discord.js snapshots are Message-shaped). */
export interface ForwardedSnapshotOriginLike extends ForwardedSnapshotLike {
    createdTimestamp?: number | null;
    author?: { username?: string | null } | null;
    guildId?: string | null;
}

export interface ForwardOrigin {
    /** 元メッセージの投稿時刻 (epoch ms)。取得できない場合は null。 */
    at: number | null;
    /** 元の発言者名。Discord のスナップショットは発言者を含まないことがあり、その場合は null。 */
    authorName: string | null;
    /** 元メッセージがこのギルド以外から転送されたものか。判定材料が無ければ null。 */
    fromOtherGuild: boolean | null;
}

/**
 * Origin of the first forwarded snapshot: when it was originally posted,
 * who posted it (when the payload carries an author) and whether it came
 * from another guild. Returns null for non-forwarded messages.
 */
export function getForwardOrigin(message: { guildId?: string | null; messageSnapshots?: unknown }): ForwardOrigin | null {
    const snapshots = getForwardedSnapshots(message || {}) as ForwardedSnapshotOriginLike[];
    if (!snapshots.length) return null;
    const first = snapshots[0];
    const at = typeof first.createdTimestamp === 'number' && first.createdTimestamp > 0 ? first.createdTimestamp : null;
    const authorName = typeof first.author?.username === 'string' && first.author.username ? first.author.username : null;
    const sourceGuildId = typeof first.guildId === 'string' && first.guildId ? first.guildId : null;
    const ownGuildId = typeof message?.guildId === 'string' && message.guildId ? message.guildId : null;
    const fromOtherGuild = sourceGuildId && ownGuildId ? sourceGuildId !== ownGuildId : null;
    return { at, authorName, fromOtherGuild };
}

const forwardDateFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * Short origin label for a forwarded message, e.g. `[転送: 別サーバーから, 2024/12/09]`.
 * Empty string for non-forwards. The source guild's NAME is not available
 * (the bot is not a member of it and the payload carries no name), so a
 * cross-guild forward is labelled 別サーバーから; the original date and,
 * when present, the original author's name are included. Derived only from
 * immutable message fields, so the label is stable for a given message.
 */
export function formatForwardAnnotation(message: { guildId?: string | null; messageSnapshots?: unknown }): string {
    const origin = getForwardOrigin(message || {});
    if (!origin) return '';
    const parts = [origin.fromOtherGuild ? '転送: 別サーバーから' : '転送'];
    if (origin.at) parts.push(forwardDateFormatter.format(new Date(origin.at)));
    if (origin.authorName) parts.push(origin.authorName);
    return `[${parts.join(', ')}]`;
}
