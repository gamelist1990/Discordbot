import {
    DebateJudgeResponse,
    DebateReplyResponse,
    DebateStance,
    DebateWinner,
    PersonalityEvaluationResponse,
    PersonalityKey,
    TranscriptEntry
} from './types.js';
import { PERSONALITY_ARCHETYPES } from './constants.js';

const AI_PERSONA_NAME_FALLBACKS = [
    'ナギ',
    'ミナト',
    'アオイ',
    'カナタ',
    'ソラ',
    'ルカ',
    'ハル',
    'ミオ',
    'レイ',
    'ヒナタ',
    'ツバサ',
    'コトハ',
    'ユズ',
    'セナ',
    'リツ',
    'サラ'
] as const;

export function createId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function hashString(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash) + value.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash);
}

export function sanitizeChannelName(input: string, fallbackPrefix: string): string {
    let base = input.trim().toLowerCase().replace(/\s+/g, '-');
    base = base.replace(/[^^\p{L}\p{N}\-_]/gu, '');
    if (!base) {
        base = `${fallbackPrefix}-${Date.now().toString(36).slice(-4)}`;
    }
    return base.slice(0, 90);
}

export function truncateText(value: string, maxLength = 1800): string {
    const trimmed = value.trim();
    if (trimmed.length <= maxLength) {
        return trimmed;
    }
    return `${trimmed.slice(0, maxLength)}...`;
}

export function summarizeTranscript(entries: TranscriptEntry[], limit = 18): string {
    if (entries.length === 0) {
        return 'ログなし';
    }

    return entries.slice(-limit).map((entry) => {
        const label = entry.authorType === 'assistant'
            ? 'AI'
            : entry.authorType === 'creator'
                ? 'CREATOR'
                : entry.authorType === 'opponent'
                    ? 'OPPONENT'
                    : entry.authorType === 'system'
                        ? 'SYSTEM'
                        : 'USER';
        return `[${label}] ${entry.content}`;
    }).join('\n');
}

export function isPersonalityKey(value: unknown): value is PersonalityKey {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERSONALITY_ARCHETYPES, value);
}

export function extractJsonObject<T>(raw: string): T | null {
    const trimmed = raw.trim();
    const candidates = [
        trimmed,
        trimmed.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    ];

    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        candidates.push(objectMatch[0]);
    }

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate) as T;
        } catch {
            continue;
        }
    }

    return null;
}

export function validatePersonalityEvaluation(value: unknown): PersonalityEvaluationResponse | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const data = value as Record<string, unknown>;
    const personalityKey = data.personality_key === null
        ? null
        : isPersonalityKey(data.personality_key)
            ? data.personality_key
            : null;

    if (typeof data.reply !== 'string' || typeof data.complete !== 'boolean' || typeof data.reason !== 'string') {
        return null;
    }

    return {
        reply: data.reply.trim(),
        complete: data.complete,
        personality_key: personalityKey,
        reason: data.reason.trim(),
        confidence: typeof data.confidence === 'number' ? clamp(Math.round(data.confidence), 0, 100) : 55,
        traits: Array.isArray(data.traits)
            ? data.traits.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean).slice(0, 6)
            : []
    };
}

export function pickAiPersonaName(seed: string, offset = 0, used: string[] = []): string {
    const normalizedUsed = new Set(used.filter(Boolean));
    const startIndex = hashString(`${seed}:${offset}`) % AI_PERSONA_NAME_FALLBACKS.length;

    for (let index = 0; index < AI_PERSONA_NAME_FALLBACKS.length; index += 1) {
        const candidate = AI_PERSONA_NAME_FALLBACKS[(startIndex + index) % AI_PERSONA_NAME_FALLBACKS.length];
        if (!normalizedUsed.has(candidate)) {
            return candidate;
        }
    }

    return AI_PERSONA_NAME_FALLBACKS[startIndex];
}

export function pickAiPersonaPair(seed: string): [string, string] {
    const first = pickAiPersonaName(seed, 0);
    const second = pickAiPersonaName(seed, 1, [first]);
    return [first, second];
}

export function validateDebateReply(value: unknown): DebateReplyResponse | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const data = value as Record<string, unknown>;
    if (typeof data.reply !== 'string') {
        return null;
    }

    return {
        reply: data.reply.trim()
    };
}

export function validateDebateJudge(value: unknown): DebateJudgeResponse | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const data = value as Record<string, unknown>;
    if (!['creator', 'opponent', 'draw'].includes(String(data.winner))) {
        return null;
    }
    if (typeof data.reason !== 'string') {
        return null;
    }

    return {
        winner: data.winner as DebateWinner,
        reason: data.reason.trim(),
        creator_score: typeof data.creator_score === 'number' ? clamp(Math.round(data.creator_score), 0, 100) : 50,
        opponent_score: typeof data.opponent_score === 'number' ? clamp(Math.round(data.opponent_score), 0, 100) : 50
    };
}

export function buildStanceLabel(stance: DebateStance): string {
    return stance === 'support' ? '賛成派' : '反対派';
}

export function parseStance(input: string): DebateStance | null {
    const normalized = input.trim().toLowerCase();
    if (['賛成', '肯定', 'pro', 'support', 'yes', '賛成派'].includes(normalized)) {
        return 'support';
    }
    if (['反対', '否定', 'con', 'oppose', 'no', '反対派'].includes(normalized)) {
        return 'oppose';
    }
    return null;
}

export function getOppositeStance(stance: DebateStance): DebateStance {
    return stance === 'support' ? 'oppose' : 'support';
}
