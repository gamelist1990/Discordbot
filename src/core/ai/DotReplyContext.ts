/** Ground Dot ambient replies in a single, time-ordered Discord conversation. */

export interface DotTimedMessage {
    id: string;
    createdTimestamp: number;
}

/**
 * Build the history as it existed when the target was posted.
 * A new message while the model is thinking must not become evidence for
 * an earlier reply. Keep the target, even if the Discord fetch omitted it.
 */
export function selectDotConversationWindow<T extends DotTimedMessage>(
    messages: readonly T[],
    target: T,
    limit = 24,
    maxAgeMs = 30 * 60_000,
): T[] {
    const unique = new Map<string, T>();
    for (const message of messages) {
        if (message.createdTimestamp > target.createdTimestamp || message.id === target.id) {
            if (message.id !== target.id) continue;
        }
        if (message.id !== target.id && target.createdTimestamp - message.createdTimestamp > maxAgeMs) continue;
        unique.set(message.id, message);
    }
    unique.set(target.id, target);
    return [...unique.values()]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp || a.id.localeCompare(b.id))
        .slice(-Math.max(1, Math.floor(limit)));
}

export type DotUnsupportedClaim = 'invented-username' | 'unverified-link-scam';

/**
 * Reject narrowly identifiable high-impact inventions before Discord posting.
 * Does not claim to be a general factuality checker; uncertain claims should
 * be phrased cautiously by the generation prompt.
 */
export function findUnsupportedDotClaim(
    reply: string,
    targetContent: string,
    verifiedReferenceContent = '',
): DotUnsupportedClaim | null {
    const source = targetContent + '\n' + verifiedReferenceContent;
    const label = reply.match(/ユーザー名(?:は|が|[:：])\s*[「『"“]?([^」』"”、。！？!?\s]{1,40})/u);
    if (label && !source.includes(label[1])) return 'invented-username';

    // A user's claim to be a police notice is not evidence of a link or URL.
    // Calling it link fraud without even a link invents an unrelated allegation.
    if (/(?:リンク詐欺|フィッシング(?:詐欺)?|詐欺リンク)/u.test(reply) &&
        !/(?:https?:\/\/|www\.|discord\.gg\/|[a-z0-9-]+\.[a-z]{2,}\/)/iu.test(source)) {
        return 'unverified-link-scam';
    }
    return null;
}
