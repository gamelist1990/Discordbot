export interface ChatAISpamCandidate {
    id: string;
    authorId: string;
    timestamp: number;
    content: string;
}

export interface ChatAISpamDecision {
    spam: boolean;
    ignoredMessageIds: string[];
    reason?: 'duplicate' | 'rapid' | 'repeated-content' | 'dominant-character-flood' | 'oversized-low-information' | 'mention-flood';
}

interface SpamRecord extends ChatAISpamCandidate {
    normalized: string;
}

const TRACKING_WINDOW_MS = 60_000;
const DUPLICATE_WINDOW_MS = 20_000;
const DUPLICATE_THRESHOLD = 3;
const RAPID_WINDOW_MS = 5_000;
const RAPID_THRESHOLD = 6;
const MENTION_THRESHOLD = 5;
const DOMINANT_CHARACTER_MIN_LENGTH = 40;
const DOMINANT_CHARACTER_RATIO = 0.8;
const OVERSIZED_CONTENT_LENGTH = 1_000;
const OVERSIZED_UNIQUE_RATIO = 0.08;

function normalize(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isRepeatedContent(value: string): boolean {
    const compact = value.replace(/\s+/g, '');
    if (compact.length < 8) return false;
    if (/^(.)\1{7,}$/u.test(compact)) return true;
    return /^(.{1,4})\1{4,}$/u.test(compact);
}

function getCharacterStats(value: string): { length: number; unique: number; dominantRatio: number } {
    const characters = Array.from(value.replace(/\s+/g, ''));
    if (characters.length === 0) return { length: 0, unique: 0, dominantRatio: 0 };

    const counts = new Map<string, number>();
    let dominantCount = 0;
    for (const character of characters) {
        const count = (counts.get(character) || 0) + 1;
        counts.set(character, count);
        dominantCount = Math.max(dominantCount, count);
    }

    return {
        length: characters.length,
        unique: counts.size,
        dominantRatio: dominantCount / characters.length,
    };
}

function countMentions(value: string): number {
    return (value.match(/<@!?&?\d+>/g) || []).length;
}

/**
 * 常駐AI専用の軽量スパム判定。
 * Discord投稿自体は削除せず、該当IDをAIの応答対象・履歴・ユーザーメモから除外する。
 */
export class ChatAISpamGuard {
    private records: SpamRecord[] = [];
    private readonly ignoredIds = new Set<string>();

    inspect(candidate: ChatAISpamCandidate): ChatAISpamDecision {
        const normalized = normalize(candidate.content);
        const record: SpamRecord = { ...candidate, normalized };
        const cutoff = candidate.timestamp - TRACKING_WINDOW_MS;
        this.records = this.records.filter(entry => entry.timestamp >= cutoff);
        this.records.push(record);

        if (normalized && isRepeatedContent(normalized)) {
            return this.ignore([record], 'repeated-content');
        }

        const characterStats = getCharacterStats(candidate.content);
        // 「ｗｗｗ…＋末尾に少量の文章」のように、完全一致の反復ではなくても
        // 一文字が本文の大半を占める荒らし投稿を検知する。
        if (
            characterStats.length >= DOMINANT_CHARACTER_MIN_LENGTH
            && characterStats.dominantRatio >= DOMINANT_CHARACTER_RATIO
        ) {
            return this.ignore([record], 'dominant-character-flood');
        }

        // 極端に長いのに文字種がほとんどない投稿も低情報量スパムとして除外する。
        if (
            characterStats.length >= OVERSIZED_CONTENT_LENGTH
            && characterStats.unique / characterStats.length <= OVERSIZED_UNIQUE_RATIO
        ) {
            return this.ignore([record], 'oversized-low-information');
        }

        if (countMentions(candidate.content) >= MENTION_THRESHOLD) {
            return this.ignore([record], 'mention-flood');
        }

        if (normalized) {
            const duplicates = this.records.filter(entry =>
                entry.authorId === candidate.authorId
                && entry.normalized === normalized
                && candidate.timestamp - entry.timestamp <= DUPLICATE_WINDOW_MS,
            );
            if (duplicates.length >= DUPLICATE_THRESHOLD) {
                return this.ignore(duplicates, 'duplicate');
            }
        }

        const rapid = this.records.filter(entry =>
            entry.authorId === candidate.authorId
            && candidate.timestamp - entry.timestamp <= RAPID_WINDOW_MS,
        );
        if (rapid.length >= RAPID_THRESHOLD) {
            return this.ignore(rapid, 'rapid');
        }

        return { spam: false, ignoredMessageIds: [] };
    }

    isIgnored(messageId: string): boolean {
        return this.ignoredIds.has(messageId);
    }

    filterHistory<T extends ChatAISpamCandidate>(messages: T[]): T[] {
        const replay = new ChatAISpamGuard();
        const chronological = [...messages].sort((left, right) => left.timestamp - right.timestamp);
        for (const message of chronological) replay.inspect(message);
        return messages.filter(message => !this.ignoredIds.has(message.id) && !replay.isIgnored(message.id));
    }

    private ignore(records: SpamRecord[], reason: ChatAISpamDecision['reason']): ChatAISpamDecision {
        const ids = records.map(record => record.id);
        for (const id of ids) this.ignoredIds.add(id);
        return { spam: true, ignoredMessageIds: ids, reason };
    }
}
