/**
 * Automatic recovery after an AntiNuke trigger (brief AN3).
 *
 * This file is the pure half: what may be deleted / unbanned, which snapshot is
 * a legal restore source, and the report shape. The Discord side (deleting,
 * unbanning, starting the AN2 restore job, posting the report) lives in
 * SnapshotManager so it can reuse the existing restore engine.
 *
 * The one rule that must never be relaxed: only objects whose *creator* is the
 * attributed attacker may be deleted. The incident's affected lists are built
 * from audit entries filtered by `executorId === actorId` (AN1), so they are
 * the creator evidence we have. Without an actor nothing is touched.
 */

import type { AntiNukeAutoRestoreMode } from './types.js';

export type AutoRestoreMode = Exclude<AntiNukeAutoRestoreMode, 'off'>;
export type AutoRestoreStatus = 'running' | 'done' | 'stopped' | 'failed' | 'skipped';

/** The incident fields auto-recovery reads (structural, so no import cycle). */
export interface AutoRestoreAffectedLike {
    channelsCreated?: readonly string[] | null;
    rolesCreated?: readonly string[] | null;
    webhooksCreated?: readonly string[] | null;
    emojisCreated?: readonly string[] | null;
    membersBanned?: readonly string[] | null;
}

export interface AutoRestoreIncidentLike {
    id: string;
    guildId: string;
    actorId: string | null;
    windowStart?: string | null;
    startedAt?: string | null;
    detectedAt?: string | null;
    affected?: AutoRestoreAffectedLike | null;
}

export type CleanupKind = 'channel' | 'role' | 'webhook' | 'emoji' | 'ban';

export interface CleanupLogEntry {
    kind: CleanupKind;
    id: string;
    name: string | null;
    outcome: 'deleted' | 'skipped' | 'failed';
    reason?: string;
}

export interface CleanupTotals {
    deleted: number;
    skipped: number;
    failed: number;
}

export type CleanupTotalsByKind = Record<CleanupKind, CleanupTotals>;

export interface CleanupPlan {
    /** Channel / role / webhook / emoji ids the attacker created. */
    channels: string[];
    roles: string[];
    webhooks: string[];
    emojis: string[];
    /** Users the attacker banned that are safe to unban. */
    unbans: string[];
    skipUnbans: Array<{ userId: string; reason: string }>;
}

export interface AutoRestoreReport {
    id: string;
    guildId: string;
    incidentId: string;
    mode: AutoRestoreMode;
    status: AutoRestoreStatus;
    startedAt: string;
    finishedAt: string | null;
    /** True when staff pressed 「停止」 and a phase boundary noticed it. */
    stopped: boolean;
    stopReason: string | null;
    stopRequestedBy: string | null;
    /** Snapshot used as the restore source; null when none predates the incident. */
    snapshotId: string | null;
    cleanup: {
        entries: CleanupLogEntry[];
        totals: CleanupTotalsByKind;
    };
    restore: {
        jobId: string;
        snapshotId: string;
        status: string;
        totals: Record<string, { restored: number; skipped: number; failed: number }> | null;
    } | null;
    /** Ban / strip outcome: damage can continue while the actor keeps access. */
    reDamageRisk: boolean;
    notes: string[];
}

/** Standing caveat, stated in every report (brief AN3 §B4). */
export const AUTO_RESTORE_LIMITATIONS: readonly string[] = [
    'メッセージ履歴（削除された投稿・添付・ピン留め）は復元できません',
    '最後のスナップショット以降に作成されたものは復元できません（削除・BAN解除のみ対象）',
    'スナップショット後に退出したメンバーは本人の再参加が必要です',
    '元のID（ロール・チャンネルは新しいIDで作成されます）'
];

export function emptyCleanupTotals(): CleanupTotals {
    return { deleted: 0, skipped: 0, failed: 0 };
}

export function emptyCleanupTotalsByKind(): CleanupTotalsByKind {
    return {
        channel: emptyCleanupTotals(),
        role: emptyCleanupTotals(),
        webhook: emptyCleanupTotals(),
        emoji: emptyCleanupTotals(),
        ban: emptyCleanupTotals()
    };
}

export function recordCleanup(report: AutoRestoreReport, entry: CleanupLogEntry): CleanupLogEntry {
    report.cleanup.entries.push(entry);
    const totals = report.cleanup.totals[entry.kind];
    totals[entry.outcome] += 1;
    return entry;
}

export function emptyAutoRestoreReport(input: {
    id: string;
    guildId: string;
    incidentId: string;
    mode: AutoRestoreMode;
    startedAt: string;
    reDamageRisk: boolean;
}): AutoRestoreReport {
    return {
        id: input.id,
        guildId: input.guildId,
        incidentId: input.incidentId,
        mode: input.mode,
        status: 'running',
        startedAt: input.startedAt,
        finishedAt: null,
        stopped: false,
        stopReason: null,
        stopRequestedBy: null,
        snapshotId: null,
        cleanup: { entries: [], totals: emptyCleanupTotalsByKind() },
        restore: null,
        reDamageRisk: input.reDamageRisk,
        notes: []
    };
}

const idOk = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80;

const uniqueIds = (values: readonly string[] | null | undefined): string[] => {
    const seen = new Set<string>();
    for (const value of values ?? []) {
        if (!idOk(value)) continue;
        seen.add(value.trim());
    }
    return Array.from(seen);
};

/** Start of the attack window as epoch ms, or null when the record is unusable. */
export function incidentStartMs(incident: AutoRestoreIncidentLike): number | null {
    for (const value of [incident.windowStart, incident.startedAt, incident.detectedAt]) {
        if (!value) continue;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

/**
 * Newest snapshot whose createdAt is at or before the incident start. A
 * post-attack snapshot is never a legal restore source.
 */
export function selectPreIncidentSnapshot<T extends { id: string; createdAt: string }>(
    snapshots: readonly T[],
    startMs: number | null
): T | null {
    if (startMs === null || !Number.isFinite(startMs)) return null;
    let best: T | null = null;
    let bestTime = -Infinity;
    for (const snapshot of snapshots) {
        const created = Date.parse(snapshot.createdAt);
        if (!Number.isFinite(created) || created > startMs) continue;
        if (created > bestTime) {
            bestTime = created;
            best = snapshot;
        }
    }
    return best;
}

/**
 * Decide what cleanup may touch.
 *
 * - deletion targets come from the incident's audit-collected "created" lists,
 *   which AN1 filled by filtering audit entries to the attacker, so they are
 *   creator-verified by construction;
 * - unbans come from the attacker's ban entries, but never the attacker,
 *   never protected ids (owner / this bot), and never anyone the pre-incident
 *   snapshot already had banned.
 *
 * With no attributed actor, nothing is planned: guessing is worse than doing
 * nothing, and the report says so.
 */
export function planAutoRestoreCleanup(input: {
    incident: AutoRestoreIncidentLike;
    snapshotBannedIds?: readonly string[];
    protectIds?: readonly string[];
}): { plan: CleanupPlan; notes: string[] } {
    const plan: CleanupPlan = {
        channels: [],
        roles: [],
        webhooks: [],
        emojis: [],
        unbans: [],
        skipUnbans: []
    };
    const notes: string[] = [];
    const actorId = input.incident.actorId;
    if (!actorId) {
        notes.push('実行者を特定できなかったため、作成物の削除とBAN解除は行いません（監査ログで作成者を確認できないため）');
        return { plan, notes };
    }

    const affected = input.incident.affected ?? {};
    plan.channels = uniqueIds(affected.channelsCreated);
    plan.roles = uniqueIds(affected.rolesCreated);
    plan.webhooks = uniqueIds(affected.webhooksCreated);
    plan.emojis = uniqueIds(affected.emojisCreated);

    const snapshotBanned = new Set(uniqueIds(input.snapshotBannedIds));
    const protectedIds = new Set(uniqueIds(input.protectIds));
    protectedIds.add(actorId);

    for (const userId of uniqueIds(affected.membersBanned)) {
        if (userId === actorId) {
            plan.skipUnbans.push({ userId, reason: '実行者自身のため解除しません' });
            continue;
        }
        if (protectedIds.has(userId)) {
            plan.skipUnbans.push({ userId, reason: '保護対象（サーバー所有者またはこのBot）のため解除しません' });
            continue;
        }
        if (snapshotBanned.has(userId)) {
            plan.skipUnbans.push({ userId, reason: '攻撃前のスナップショット時点でBAN済みのため維持します' });
            continue;
        }
        plan.unbans.push(userId);
    }

    if (!plan.channels.length && !plan.roles.length && !plan.webhooks.length && !plan.emojis.length) {
        notes.push('監査ログから攻撃者の作成物は確認できませんでした（削除対象なし）');
    }
    return { plan, notes };
}

/** One-line summary used by the report embed and the staff UI. */
export function formatCleanupTotals(totals: CleanupTotalsByKind): string[] {
    const label: Record<CleanupKind, string> = {
        channel: 'チャンネル',
        role: 'ロール',
        webhook: 'Webhook',
        emoji: '絵文字',
        ban: 'BAN解除'
    };
    return (Object.keys(label) as CleanupKind[]).map((kind) => {
        const value = totals[kind];
        const parts: string[] = [];
        if (kind === 'ban') {
            parts.push(`解除 ${value.deleted}`);
        } else {
            parts.push(`削除 ${value.deleted}`);
        }
        if (value.skipped) parts.push(`スキップ ${value.skipped}`);
        if (value.failed) parts.push(`失敗 ${value.failed}`);
        return `${label[kind]}: ${parts.join(' / ')}`;
    });
}
