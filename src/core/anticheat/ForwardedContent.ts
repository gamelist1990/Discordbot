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
