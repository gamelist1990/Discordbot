import {
    buildAltGraph,
    evaluateGraphPropagation,
    readAltGraphSettings,
    type AltGraphBadTag
} from '../anticheat/AltGraph.js';
import { readToggle } from '../anticheat/RaidEnforcement.js';
import type { RiskKickEntry } from '../anticheat/RiskKicks.js';
import {
    DEFAULT_WEBAUTH_BLOCK_SETTINGS,
    type AltGraphSettings,
    type WatchUserEntry,
    type WebAuthBlockSettings
} from '../anticheat/types.js';
import { correlateWebAuthRecord } from './records.js';
import { FINGERPRINT_FUZZY_CONFIG, scoreFingerprintSimilarity } from './fingerprint.js';
import type { WebAuthBlockRule, WebAuthMatch, WebAuthRecord } from './types.js';

/**
 * Auth-point blocking for the WebAuth submit flow (brief 8).
 *
 * Today a device/IP matching a kicked account still completes WebAuth, gets
 * its roles and is only auto-flagged afterwards. This module decides — from
 * data the caller has already read — whether the attempt must be refused
 * BEFORE any role is granted. It is pure: no storage, no Discord, no clock
 * reads beyond the values handed in, so the whole policy is unit-testable.
 *
 * Decision order (after the token / challenge / browser / VPN gates):
 *   0. automation — the page reported `navigator.webdriver === true`
 *                  (brief 9). A normally browsed browser never reports it.
 *   1. exact  — `ipHash` or `fpHash` equals a record of a user kicked by
 *               anti-raid or by the watch danger pipeline.
 *   2. fuzzy  — the 4A fuzzy fingerprint score against a kicked user's
 *               record meets the 4A threshold.
 *   3. graph  — the alt-graph edge weight toward bad nodes (kicked, or
 *               watch-flagged with danger points > 0) meets the 4A
 *               propagation threshold.
 *
 * A user who is only watch-flagged is monitoring, not a conviction: they are
 * not blocked by rules 1–2 (no bad match) and rule 3 never counts their own
 * record, so their auth proceeds while any bad match keeps its existing
 * auto-flag behaviour.
 */

export type { WebAuthBlockRule };

/** Staff-facing rule names; never contains a matched account or signal. */
export const WEB_AUTH_BLOCK_RULE_LABELS: Record<WebAuthBlockRule, string> = {
    automation: '自動化ブラウザの検出',
    exact: 'IP・端末の完全一致',
    fuzzy: '端末の類似一致',
    graph: '相関グラフの危険アカウント連結'
};

export interface WebAuthBlockMatch {
    /** The bad account this attempt was connected to. */
    userId: string;
    rules: WebAuthBlockRule[];
    badTags: AltGraphBadTag[];
}

export interface WebAuthBlockInput {
    /** The candidate record (built, not yet stored). */
    record: WebAuthRecord;
    /** Records already stored for the guild (the candidate need not be included). */
    records?: WebAuthRecord[];
    riskKicks?: RiskKickEntry[];
    watchEntries?: Array<{ userId: string; entry: WatchUserEntry }>;
    /** Rule switches; missing values use the defaults (all ON). */
    settings?: Partial<WebAuthBlockSettings> | null;
    /** Alt-graph weights/thresholds; missing values use the 4A defaults. */
    altGraph?: Partial<AltGraphSettings> | null;
}

export interface WebAuthBlockDecision {
    blocked: boolean;
    /** Enabled rules that hit, in decision order. */
    rules: WebAuthBlockRule[];
    /** Bad accounts with the rule(s) that connected them, sorted by rule count. */
    matches: WebAuthBlockMatch[];
    /** Correlation evidence (existing matcher, risks annotated below). */
    correlation: WebAuthMatch[];
    /** Best fuzzy ratio when the fuzzy rule hit; 0 otherwise. */
    fpScore: number;
    /** Alt-graph total/threshold when the graph rule ran; 0 otherwise. */
    graphScore: number;
    graphThreshold: number;
}

/** Reads `settings.webAuthBlock`, defaulting every rule to ON. */
export function readWebAuthBlockSettings(
    value: Partial<WebAuthBlockSettings> | null | undefined
): WebAuthBlockSettings {
    const source = value || {};
    const base = DEFAULT_WEBAUTH_BLOCK_SETTINGS;
    return {
        automation: readToggle(source.automation, base.automation),
        exact: readToggle(source.exact, base.exact),
        fuzzy: readToggle(source.fuzzy, base.fuzzy),
        graph: readToggle(source.graph, base.graph)
    };
}

const kickTag = (source: RiskKickEntry['source']): AltGraphBadTag =>
    source === 'watch-danger' ? 'watch-danger-kick' : 'raid-kick';

/**
 * Runs the existing correlation + alt-graph evaluation and returns the block
 * decision. Pure; the caller stores the record / consumes the token.
 */
export function evaluateWebAuthBlock(input: WebAuthBlockInput): WebAuthBlockDecision {
    const settings = readWebAuthBlockSettings(input.settings);
    const altGraph = readAltGraphSettings(input.altGraph);
    const record = input.record;
    const records = input.records || [];
    const riskKicks = input.riskKicks || [];
    const watchEntries = (input.watchEntries || [])
        .filter((entry) => !!entry?.userId && !!entry.entry);

    const rules: WebAuthBlockRule[] = [];

    // Rule A (brief 9): the page reported navigator.webdriver=true. Chromium
    // sets it for automation-controlled sessions; normal browsing never does.
    // It is its own switch because it is an environment property, not a
    // correlation result, and staff may want to soften it for kiosk setups.
    if (settings.automation && record.automation?.webdriver === true) {
        rules.push('automation');
    }

    const byUser = new Map<string, WebAuthBlockMatch>();
    const attach = (userId: string, rule: WebAuthBlockRule, badTags: AltGraphBadTag[]): void => {
        let match = byUser.get(userId);
        if (!match) {
            match = { userId, rules: [], badTags: [] };
            byUser.set(userId, match);
        }
        if (!match.rules.includes(rule)) match.rules.push(rule);
        for (const tag of badTags) {
            if (!match.badTags.includes(tag)) match.badTags.push(tag);
        }
    };

    // Rules 1–2 read the same correlation the auto-flag flow uses, so the
    // block and the flag can never disagree about a match.
    const correlation = correlateWebAuthRecord(records, record).matches;
    const kicked = new Map<string, AltGraphBadTag>();
    for (const kick of riskKicks) {
        if (kick?.userId && !kicked.has(kick.userId)) kicked.set(kick.userId, kickTag(kick.source));
    }

    let fpScore = 0;
    for (const match of correlation) {
        const tag = kicked.get(match.userId);
        if (!tag) continue; // rules 1–2 only fire for a kicked user
        const exact = match.hashTypes.includes('ip') || match.hashTypes.includes('fp');
        if (exact) {
            // Complete IP or device match.
            if (settings.exact) {
                if (!rules.includes('exact')) rules.push('exact');
                attach(match.userId, 'exact', [tag]);
            }
            continue;
        }
        const score = Number(match.fpScore) || 0;
        if (settings.fuzzy && match.hashTypes.includes('fp-fuzzy') && score >= FINGERPRINT_FUZZY_CONFIG.threshold) {
            if (!rules.includes('fuzzy')) rules.push('fuzzy');
            attach(match.userId, 'fuzzy', [tag]);
            fpScore = Math.max(fpScore, score);
        }
    }

    // A kicked member can rejoin with the same Discord account. The peer
    // correlation above never links a user to themselves, so their own
    // previous record is checked explicitly: being kicked is a conviction,
    // so a returning kicked account is refused by rule 1/2 like any device.
    const ownTag = kicked.get(record.userId);
    if (ownTag) {
        for (const other of records) {
            if (other.userId !== record.userId) continue;
            const exact = (!!record.ipHash && other.ipHash === record.ipHash)
                || (!!record.fpHash && other.fpHash === record.fpHash);
            if (exact) {
                if (settings.exact) {
                    if (!rules.includes('exact')) rules.push('exact');
                    attach(record.userId, 'exact', [ownTag]);
                }
                continue;
            }
            if (!settings.fuzzy || !record.signalHashes || !other.signalHashes) continue;
            const own = scoreFingerprintSimilarity(record.signalHashes, other.signalHashes);
            if (own.comparable && own.matches) {
                if (!rules.includes('fuzzy')) rules.push('fuzzy');
                attach(record.userId, 'fuzzy', [ownTag]);
                fpScore = Math.max(fpScore, own.ratio);
            }
        }
    }

    // Rule 3: the alt-graph decision exactly as the auto-flag path computes
    // it, but with the candidate device included before anything is granted.
    let graphScore = 0;
    let graphThreshold = altGraph.flagThreshold;
    if (settings.graph && altGraph.enabled) {
        const graph = buildAltGraph({
            watchEntries,
            webAuthRecords: [...records, record],
            riskKicks
        }, altGraph);
        const propagation = evaluateGraphPropagation(graph, record.userId, altGraph);
        graphThreshold = propagation.threshold;
        if (propagation.flagged) {
            graphScore = propagation.total;
            if (!rules.includes('graph')) rules.push('graph');
            for (const contribution of propagation.contributions) {
                attach(contribution.otherUserId, 'graph', contribution.badTags);
            }
        }
    }

    const matches = [...byUser.values()]
        .sort((left, right) => right.rules.length - left.rules.length || left.userId.localeCompare(right.userId));

    return {
        blocked: rules.length > 0,
        rules,
        matches,
        correlation,
        fpScore,
        graphScore,
        graphThreshold
    };
}
