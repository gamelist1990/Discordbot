import { legacyFingerprintGroups, scoreFingerprintSimilarity } from '../webauth/fingerprint.js';
import type { FingerprintSignalHashes, WebAuthRecord } from '../webauth/types.js';
import type { RiskKickEntry } from './RiskKicks.js';
import { readToggle } from './RaidEnforcement.js';
import { DEFAULT_ALT_GRAPH_SETTINGS, type AltGraphSettings, type AltGraphWeights, type WatchUserEntry } from './types.js';
import { WATCH_MIN_NORMALIZED_LENGTH, normalizeWatchName } from './WatchUsers.js';

/**
 * Alt-account graph (brief 4A §4).
 *
 * Nodes are users seen in the watch store, WebAuth records or the risk-kick
 * ledger. Edges are weighted signals between two distinct users; propagation
 * sums the edges from a user being evaluated toward "bad" nodes (kicked by
 * anti-raid / watch danger, or currently watch-flagged with danger points).
 *
 * Scale: the graph is rebuilt in memory per evaluation and is O(n²) in nodes.
 * That is fine at this guild's size (hundreds of accounts, not thousands);
 * no background daemon is used, matching the event-driven brief.
 */

export type AltGraphEdgeType =
    | 'ip'
    | 'fp'
    | 'fuzzy'
    | 'subnet'
    | 'avatar'
    | 'creation'
    | 'name';

export type AltGraphBadTag =
    | 'raid-kick'
    | 'watch-danger-kick'
    | 'watch-danger-points';

export const ALT_GRAPH_EDGE_LABELS: Record<AltGraphEdgeType, string> = {
    ip: 'IP一致',
    fp: '端末ハッシュ一致',
    fuzzy: '端末類似',
    subnet: 'サブネット+ASN一致',
    avatar: '同一アバター',
    creation: '作成時刻クラスタ',
    name: '類似名'
};

export const ALT_GRAPH_BAD_LABELS: Record<AltGraphBadTag, string> = {
    'raid-kick': 'AntiRaidでキック済み',
    'watch-danger-kick': '警戒ユーザーの危険判定でキック済み',
    'watch-danger-points': '警戒中（危険ポイント > 0）'
};

export interface AltGraphNode {
    userId: string;
    ipHashes: string[];
    /** One entry per WebAuth record so multi-device users stay comparable. */
    fingerprints: Array<{
        fpHash: string | null;
        signalHashes: FingerprintSignalHashes | null;
        /** Stored signal generation (brief 9R); absent means generation 1. */
        signalSchema?: number;
    }>;
    /** Apparent-IP subnet hash paired with the ASN it was resolved under. */
    subnetPairs: Array<{ subnetHash: string; asn: string }>;
    avatarHash: string | null;
    accountCreatedAt: number;
    normalizedName: string;
    bad: boolean;
    badTags: AltGraphBadTag[];
}

export interface AltGraphLink {
    type: AltGraphEdgeType;
    weight: number;
    /** Non-identifying detail (hash prefixes, fuzzy ratio, cluster delta). */
    detail?: string;
}

export interface AltGraphEdge extends AltGraphLink {
    a: string;
    b: string;
    /** Extra context for the log; prefixes only, never raw values. */
    hashPrefix?: string;
}

export interface AltGraph {
    nodes: Map<string, AltGraphNode>;
    edges: AltGraphEdge[];
}

export interface AltGraphInput {
    watchEntries?: Array<{ userId: string; entry: WatchUserEntry }>;
    webAuthRecords?: WebAuthRecord[];
    riskKicks?: RiskKickEntry[];
}

const positiveInt = (value: unknown, fallback: number, min = 1): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.floor(parsed));
};

const positiveFloat = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

/** Reads the `settings.altGraph` block with the documented defaults. */
export function readAltGraphSettings(value: Partial<AltGraphSettings> | null | undefined): AltGraphSettings {
    const source = value || {};
    const base = DEFAULT_ALT_GRAPH_SETTINGS;
    const weights: AltGraphWeights = { ...base.weights };
    for (const key of Object.keys(base.weights) as Array<keyof AltGraphWeights>) {
        weights[key] = positiveFloat(source.weights?.[key], base.weights[key], 0, 100);
    }
    return {
        enabled: readToggle(source.enabled, base.enabled),
        flagThreshold: positiveFloat(source.flagThreshold, base.flagThreshold, 1, 1000),
        fuzzyThreshold: positiveFloat(source.fuzzyThreshold, base.fuzzyThreshold, 0.05, 1),
        creationClusterSeconds: positiveInt(source.creationClusterSeconds, base.creationClusterSeconds, 0),
        weights
    };
}

const addUnique = <T>(list: T[], value: T): void => {
    if (!list.includes(value)) list.push(value);
};

function ensureNode(nodes: Map<string, AltGraphNode>, userId: string): AltGraphNode {
    let node = nodes.get(userId);
    if (!node) {
        node = {
            userId,
            ipHashes: [],
            fingerprints: [],
            subnetPairs: [],
            avatarHash: null,
            accountCreatedAt: 0,
            normalizedName: '',
            bad: false,
            badTags: []
        };
        nodes.set(userId, node);
    }
    return node;
}

const markBad = (node: AltGraphNode, tag: AltGraphBadTag): void => {
    node.bad = true;
    addUnique(node.badTags, tag);
};

const parseTime = (value: string | null | undefined): number => {
    if (typeof value !== 'string' || !value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** Builds the in-memory graph from the three persisted sources. */
export function buildAltGraph(input: AltGraphInput, settings: AltGraphSettings = DEFAULT_ALT_GRAPH_SETTINGS): AltGraph {
    const nodes = new Map<string, AltGraphNode>();

    for (const { userId, entry } of input.watchEntries || []) {
        if (!userId || !entry || entry.dismissed) continue;
        const node = ensureNode(nodes, userId);
        const createdAt = parseTime(entry.accountCreatedAt);
        if (!node.accountCreatedAt && createdAt) node.accountCreatedAt = createdAt;
        if (!node.avatarHash && entry.avatarHash) node.avatarHash = entry.avatarHash;
        if (!node.normalizedName) {
            node.normalizedName = entry.normalizedName
                || normalizeWatchName(entry.nameSnapshot);
        }
        const dangerPoints = (entry.dangerPoints || [])
            .reduce((sum, point) => sum + (Number(point.points) || 0), 0);
        if (dangerPoints > 0) markBad(node, 'watch-danger-points');
    }

    for (const record of input.webAuthRecords || []) {
        if (!record || !record.userId) continue;
        const node = ensureNode(nodes, record.userId);
        if (record.ipHash) addUnique(node.ipHashes, record.ipHash);
        if (record.fpHash || record.signalHashes) {
            node.fingerprints.push({
                fpHash: record.fpHash || null,
                signalHashes: record.signalHashes || null,
                signalSchema: record.signalSchema
            });
        }
        if (record.subnetHash && record.asn) {
            const pair = { subnetHash: record.subnetHash, asn: record.asn };
            if (!node.subnetPairs.some((entry) => entry.subnetHash === pair.subnetHash && entry.asn === pair.asn)) {
                node.subnetPairs.push(pair);
            }
        }
    }

    for (const kick of input.riskKicks || []) {
        if (!kick || !kick.userId) continue;
        const node = ensureNode(nodes, kick.userId);
        markBad(node, kick.source === 'watch-danger' ? 'watch-danger-kick' : 'raid-kick');
    }

    const nodeList = [...nodes.values()];
    const edges: AltGraphEdge[] = [];
    for (let left = 0; left < nodeList.length; left++) {
        for (let right = left + 1; right < nodeList.length; right++) {
            const a = nodeList[left];
            const b = nodeList[right];
            // Edges need two distinct users; a user can never link to itself.
            if (a.userId === b.userId) continue;
            for (const link of linkAltGraphNodes(a, b, settings)) {
                edges.push({ ...link, a: a.userId, b: b.userId });
            }
        }
    }

    return { nodes, edges };
}

/** Weighted signals between two distinct nodes (pure). */
export function linkAltGraphNodes(
    a: AltGraphNode,
    b: AltGraphNode,
    settings: AltGraphSettings = DEFAULT_ALT_GRAPH_SETTINGS
): AltGraphLink[] {
    const links: AltGraphLink[] = [];
    if (!a || !b || a.userId === b.userId) return links;
    const weights = settings.weights;

    const sharedIp = a.ipHashes.find((hash) => b.ipHashes.includes(hash));
    if (sharedIp) {
        links.push({ type: 'ip', weight: weights.ipHash, detail: `IP ${sharedIp.slice(0, 8)}` });
    }

    const sharedFp = a.fingerprints
        .map((entry) => entry.fpHash)
        .find((hash) => !!hash && b.fingerprints.some((other) => other.fpHash === hash));
    if (sharedFp) {
        links.push({ type: 'fp', weight: weights.fpHash, detail: `端末 ${sharedFp.slice(0, 8)}` });
    } else {
        // Fuzzy is only an additional signal when no exact fingerprint match exists.
        let best = { matches: false, ratio: 0 };
        for (const left of a.fingerprints) {
            if (!left.signalHashes) continue;
            for (const right of b.fingerprints) {
                if (!right.signalHashes) continue;
                // Both sides are stored records, so a group either one
                // predates is excluded from the score (brief 9R).
                const score = scoreFingerprintSimilarity(left.signalHashes, right.signalHashes, {
                    threshold: settings.fuzzyThreshold,
                    peerLegacyGroups: [...new Set([
                        ...legacyFingerprintGroups(left.signalSchema, left.signalHashes),
                        ...legacyFingerprintGroups(right.signalSchema, right.signalHashes)
                    ])]
                });
                if (score.matches && score.ratio > best.ratio) {
                    best = { matches: true, ratio: score.ratio };
                }
            }
        }
        if (best.matches) {
            links.push({
                type: 'fuzzy',
                weight: weights.fuzzyFingerprint,
                detail: `類似 ${best.ratio.toFixed(2)}`
            });
        }
    }

    const sharedSubnet = a.subnetPairs.find((pair) => b.subnetPairs
        .some((other) => other.subnetHash === pair.subnetHash && other.asn === pair.asn));
    if (sharedSubnet) {
        links.push({ type: 'subnet', weight: weights.subnetAsn });
    }

    if (a.avatarHash && b.avatarHash && a.avatarHash === b.avatarHash) {
        links.push({ type: 'avatar', weight: weights.avatarHash, detail: `アバター ${a.avatarHash.slice(0, 8)}` });
    }

    if (a.accountCreatedAt > 0 && b.accountCreatedAt > 0) {
        const deltaMs = Math.abs(a.accountCreatedAt - b.accountCreatedAt);
        if (deltaMs <= settings.creationClusterSeconds * 1000) {
            links.push({
                type: 'creation',
                weight: weights.creationCluster,
                detail: `作成差 ${Math.round(deltaMs / 1000)}秒`
            });
        }
    }

    if (
        a.normalizedName
        && b.normalizedName
        && a.normalizedName === b.normalizedName
        && a.normalizedName.length >= WATCH_MIN_NORMALIZED_LENGTH
    ) {
        links.push({ type: 'name', weight: weights.similarName });
    }

    return links;
}

export interface AltGraphContribution extends AltGraphLink {
    otherUserId: string;
    badTags: AltGraphBadTag[];
}

export interface AltGraphPropagation {
    userId: string;
    total: number;
    threshold: number;
    flagged: boolean;
    /** True when the target is already a bad node (never self-flag). */
    targetBad: boolean;
    /** Contributions sorted by weight, then user id. */
    contributions: AltGraphContribution[];
    /** Edge types ordered by total contribution weight. */
    topTypes: AltGraphEdgeType[];
    badUserIds: string[];
}

/**
 * Sums the target's edge weights toward bad nodes and decides whether the
 * threshold is reached. Pure; the caller writes the watch entry.
 */
export function evaluateGraphPropagation(
    graph: AltGraph,
    userId: string,
    settings: AltGraphSettings = DEFAULT_ALT_GRAPH_SETTINGS
): AltGraphPropagation {
    const target = graph.nodes.get(userId);
    const threshold = settings.flagThreshold;
    if (!target) {
        return {
            userId, total: 0, threshold, flagged: false, targetBad: false,
            contributions: [], topTypes: [], badUserIds: []
        };
    }
    if (target.bad) {
        // Already flagged/kicked: a user never flags themselves via their own record.
        return {
            userId, total: 0, threshold, flagged: false, targetBad: true,
            contributions: [], topTypes: [], badUserIds: []
        };
    }

    const contributions: AltGraphContribution[] = [];
    for (const edge of graph.edges) {
        if (edge.a !== userId && edge.b !== userId) continue;
        const otherUserId = edge.a === userId ? edge.b : edge.a;
        if (otherUserId === userId) continue;
        const other = graph.nodes.get(otherUserId);
        if (!other || !other.bad) continue;
        contributions.push({
            type: edge.type,
            weight: edge.weight,
            detail: edge.detail,
            otherUserId,
            badTags: [...other.badTags]
        });
    }

    contributions.sort((left, right) => right.weight - left.weight || left.otherUserId.localeCompare(right.otherUserId));
    const total = contributions.reduce((sum, entry) => sum + entry.weight, 0);

    const weightByType = new Map<AltGraphEdgeType, number>();
    for (const entry of contributions) {
        weightByType.set(entry.type, (weightByType.get(entry.type) || 0) + entry.weight);
    }
    const topTypes = [...weightByType.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([type]) => type);
    const badUserIds = [...new Set(contributions.map((entry) => entry.otherUserId))];

    return {
        userId,
        total,
        threshold,
        flagged: total >= threshold,
        targetBad: false,
        contributions,
        topTypes,
        badUserIds
    };
}
