import { createHash, randomBytes } from 'node:crypto';
import { config } from '../../../config.js';
import type { SettingsSession } from '../../types/index.js';
import { PERSONA_DIRECTION_MAX_LENGTH, type GuildAIPersona } from '../../../core/ai/GuildAIPersonality.js';
import { jstDateString } from '../../../core/ai/GuildEpisodeMemory.js';

/**
 * 性格の生成・調整APIの保護。
 *
 * - 認可: ギルド権限レベル2以上（管理者）またはBot管理者のみ。セッション認証（verifyAuth）と
 *   ギルド単位の権限チェック（ルーター共通のレベル1以上）に加えて、生成系はここで一段強くする。
 * - レート制限: ギルド/ユーザー単位のクールダウン、日次上限、ギルド単位の同時実行は1つまで。
 * - 流用防止: 方向プロンプトは長さ上限つきで「資料」としてのみ生成プロンプトへ渡り、
 *   出力は性格スキーマに限定される。適用はサーバー側で保持したプレビューを
 *   ワンタイムトークンで消費する方式にし、クライアントから任意の性格データを注入できない。
 */

export const PERSONA_GENERATION_LIMITS = {
    guildCooldownMs: 60_000,
    userCooldownMs: 30_000,
    guildDailyCap: 20,
    userDailyCap: 10,
} as const;

/** Bot管理者（オーナー）かどうかをセッションから判定する。判定材料はセッションとBot設定のみ。 */
export function isBotOwnerSession(session: SettingsSession | undefined): boolean {
    if (!session?.userId) return false;
    if (session.isOwner === true) return true;
    if (Array.isArray(session.owners) && session.owners.includes(session.userId)) return true;
    return Array.isArray(config.owner) && config.owner.includes(session.userId);
}

/** 性格の生成・調整を実行できるのは、ギルド管理者（レベル2以上）またはBot管理者だけ。 */
export function canGeneratePersona(actor: { permissionLevel: number; isBotOwner: boolean }): boolean {
    return actor.isBotOwner || actor.permissionLevel >= 2;
}

/** 方向プロンプトの検証。未指定は空として扱い、上限を超えたら拒否する。 */
export function validatePersonaDirection(value: unknown): { ok: true; direction: string } | { ok: false; error: string } {
    if (value === undefined || value === null) return { ok: true, direction: '' };
    if (typeof value !== 'string') return { ok: false, error: '方向プロンプトは文字列で指定してください' };
    const direction = value.trim();
    if (direction.length > PERSONA_DIRECTION_MAX_LENGTH) {
        return { ok: false, error: `方向プロンプトは${PERSONA_DIRECTION_MAX_LENGTH}文字以内で入力してください` };
    }
    return { ok: true, direction };
}

export type PersonaLimitReason = 'in-flight' | 'cooldown-guild' | 'cooldown-user' | 'daily-guild' | 'daily-user';
export type PersonaLimitVerdict = { ok: true } | { ok: false; reason: PersonaLimitReason; retryAfterMs: number };

function msUntilJstMidnight(now: number): number {
    const today = jstDateString(now);
    const next = new Date(`${today}T00:00:00+09:00`).getTime() + 24 * 60 * 60_000;
    return Math.max(1000, next - now);
}

export class PersonaGenerationLimiter {
    private inFlight = new Set<string>();
    private lastByGuild = new Map<string, number>();
    private lastByUser = new Map<string, number>();
    private dailyByGuild = new Map<string, number>();
    private dailyByUser = new Map<string, number>();

    constructor(private readonly now: () => number = () => Date.now()) {}

    check(guildId: string, userId: string): PersonaLimitVerdict {
        const now = this.now();
        if (this.inFlight.has(guildId)) return { ok: false, reason: 'in-flight', retryAfterMs: 5000 };
        const guildLast = this.lastByGuild.get(guildId) ?? 0;
        if (now - guildLast < PERSONA_GENERATION_LIMITS.guildCooldownMs) {
            return { ok: false, reason: 'cooldown-guild', retryAfterMs: PERSONA_GENERATION_LIMITS.guildCooldownMs - (now - guildLast) };
        }
        const userLast = this.lastByUser.get(userId) ?? 0;
        if (now - userLast < PERSONA_GENERATION_LIMITS.userCooldownMs) {
            return { ok: false, reason: 'cooldown-user', retryAfterMs: PERSONA_GENERATION_LIMITS.userCooldownMs - (now - userLast) };
        }
        const day = jstDateString(now);
        if ((this.dailyByGuild.get(`${day}:${guildId}`) ?? 0) >= PERSONA_GENERATION_LIMITS.guildDailyCap) {
            return { ok: false, reason: 'daily-guild', retryAfterMs: msUntilJstMidnight(now) };
        }
        if ((this.dailyByUser.get(`${day}:${userId}`) ?? 0) >= PERSONA_GENERATION_LIMITS.userDailyCap) {
            return { ok: false, reason: 'daily-user', retryAfterMs: msUntilJstMidnight(now) };
        }
        return { ok: true };
    }

    /** 生成の開始を記録する（同時実行・クールダウン・日次カウントはここから数える）。 */
    begin(guildId: string, userId: string): void {
        const now = this.now();
        const day = jstDateString(now);
        this.inFlight.add(guildId);
        this.lastByGuild.set(guildId, now);
        this.lastByUser.set(userId, now);
        this.dailyByGuild.set(`${day}:${guildId}`, (this.dailyByGuild.get(`${day}:${guildId}`) ?? 0) + 1);
        this.dailyByUser.set(`${day}:${userId}`, (this.dailyByUser.get(`${day}:${userId}`) ?? 0) + 1);
    }

    /** 生成の終了（成功・失敗共通）。 */
    end(guildId: string): void {
        this.inFlight.delete(guildId);
    }
}

/**
 * プレビュー→適用のためのサーバー側保持ストア。
 * FileShare のワンタイムトークンの流儀に倣い、トークンはランダム256-bit・10分で失効・
 * 1回だけ消費可能で、ギルドと実行ユーザーに束縛する。サーバーはハッシュだけをキーに保持し、
 * 適用時に実行者の認可を再検証する（ルーター側）。性格データそのものはサーバーから外に出ない。
 */
export interface PersonaPreviewRecord {
    guildId: string;
    userId: string;
    persona: GuildAIPersona;
    baseGeneratedAt?: string;
    expiresAt: number;
}

export const PERSONA_PREVIEW_TTL_MS = 10 * 60_000;
const personaPreviews = new Map<string, PersonaPreviewRecord>();

function previewKey(previewId: string): string {
    return createHash('sha256').update(previewId).digest('hex');
}

export function createPersonaPreview(
    record: Omit<PersonaPreviewRecord, 'expiresAt'>,
    now: number = Date.now(),
): string {
    for (const [key, value] of personaPreviews) {
        if (value.expiresAt <= now) personaPreviews.delete(key);
    }
    const previewId = randomBytes(32).toString('hex');
    personaPreviews.set(previewKey(previewId), { ...record, expiresAt: now + PERSONA_PREVIEW_TTL_MS });
    return previewId;
}

/** プレビューを取り出す。成否にかかわらず1回で消費される（使い回し不可）。 */
export function consumePersonaPreview(
    previewId: unknown,
    guildId: string,
    userId: string,
    now: number = Date.now(),
): PersonaPreviewRecord | null {
    if (typeof previewId !== 'string' || !previewId) return null;
    const key = previewKey(previewId);
    const record = personaPreviews.get(key);
    if (!record) return null;
    personaPreviews.delete(key);
    if (record.expiresAt <= now) return null;
    if (record.guildId !== guildId || record.userId !== userId) return null;
    return record;
}
