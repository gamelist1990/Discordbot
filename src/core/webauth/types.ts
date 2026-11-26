/**
 * Web fingerprint authentication (WebAuth) types.
 *
 * Discord exposes no IP or device data for bots, so this flow collects it from
 * a consented browser visit and stores only HMAC hashes plus an AES-GCM sealed
 * blob. Raw IPs and raw browser signals never leave the server except through
 * the local decryption script.
 */

export type WebAuthBrowserName = 'chrome' | 'edge' | 'safari';

export type WebAuthBrowserReason =
    | 'ok'
    | 'missing-user-agent'
    | 'firefox'
    /** Legacy reason for Safari rejections; Safari is accepted now. */
    | 'safari'
    /** Legacy reason for CriOS/FxiOS/EdgiOS rejections; they are accepted now. */
    | 'ios-chrome'
    | 'in-app-webview'
    | 'headless'
    | 'unsupported-chromium'
    /** WebKit without a recognised Safari-family signature (app shells, …). */
    | 'unsupported-webkit'
    | 'brand-mismatch';

export interface BrowserBrand {
    brand: string;
    version?: string;
}

export interface BrowserGateInput {
    userAgent: string;
    /** navigator.userAgentData.brands (or a raw Sec-CH-UA string). */
    brands?: BrowserBrand[] | string[] | string | null;
    /** Raw Sec-CH-UA request header, when the browser sent one. */
    clientHint?: string | null;
}

export interface BrowserGateResult {
    allowed: boolean;
    browser: WebAuthBrowserName | null;
    reason: WebAuthBrowserReason;
}

export type IntelVerdict = 'clean' | 'blocked' | 'unavailable';
export type IntelFlag = 'proxy' | 'hosting';

export interface IpIntelResult {
    verdict: IntelVerdict;
    flags: IntelFlag[];
    source: string;
    checkedAt: number;
    cached: boolean;
    /** Short machine-readable detail; never contains the IP. */
    detail?: string;
    /**
     * Autonomous-system string reported by ip-api (`as`, e.g.
     * "AS2516 KDDI CORPORATION"). Plain text, not personal data; stored on
     * the WebAuth record next to `subnetHash`.
     */
    asn?: string | null;
}

export interface FingerprintUaCh {
    platform?: string;
    platformVersion?: string;
    model?: string;
    mobile?: boolean;
    brands?: BrowserBrand[];
}

export interface FingerprintScreen {
    width?: number;
    height?: number;
    colorDepth?: number;
    pixelDepth?: number;
}

export interface FingerprintTouch {
    maxTouchPoints?: number;
    touchEvent?: boolean;
}

/**
 * Components the canonical fingerprint is split into for fuzzy matching.
 * Each one is hashed separately so a single changed component does not lose
 * the whole device match.
 */
export type FingerprintComponentKey =
    | 'canvas'
    | 'webgl'
    | 'screen'
    | 'platform'
    | 'locale'
    | 'hardware'
    | 'audio';

export type FingerprintSignalHashes = Partial<Record<FingerprintComponentKey, string>>;

/** Raw signals posted by the auth page. Always encrypted before storage. */
export interface FingerprintSignals {
    userAgent?: string;
    uaCh?: FingerprintUaCh;
    screen?: FingerprintScreen;
    timezone?: string;
    languages?: string[];
    hardwareConcurrency?: number;
    deviceMemory?: number;
    canvasHash?: string;
    webglVendor?: string;
    webglRenderer?: string;
    /** Optional; the current page does not collect it yet. */
    audioHash?: string;
    touch?: FingerprintTouch;
}

/** Whitelisted, truncated copy of the posted signals. */
export interface NormalizedFingerprintSignals {
    userAgent: string;
    uaCh: {
        platform: string;
        platformVersion: string;
        model: string;
        mobile: boolean;
        brands: BrowserBrand[];
    };
    screen: {
        width: number;
        height: number;
        colorDepth: number;
        pixelDepth: number;
    };
    timezone: string;
    languages: string[];
    hardwareConcurrency: number;
    deviceMemory: number;
    canvasHash: string;
    webglVendor: string;
    webglRenderer: string;
    audioHash: string;
    touch: {
        maxTouchPoints: number;
        touchEvent: boolean;
    };
}

export type WebAuthRecordSource = 'web' | 'staff';

export interface WebAuthRecord {
    id: string;
    guildId: string;
    userId: string;
    createdAt: string;
    source: WebAuthRecordSource;
    verified: boolean;
    browser: {
        name: WebAuthBrowserName | null;
        reason: WebAuthBrowserReason | 'staff';
    };
    intel: {
        verdict: IntelVerdict | 'staff';
        flags: string[];
        source: string;
    };
    ipHash: string | null;
    fpHash: string | null;
    /**
     * Per-component HMAC hashes of the fingerprint. Null on records created
     * before fuzzy matching (and on staff records); fuzzy matching simply
     * does not apply to those.
     */
    signalHashes: FingerprintSignalHashes | null;
    /** ip-api `as` string (plain text, not personal). */
    asn: string | null;
    /** HMAC hex of the /24 (IPv4) or /48 (IPv6) prefix of the client IP. */
    subnetHash: string | null;
    /** hex(iv + auth tag + ciphertext); null for staff records. */
    sealed: string | null;
    presetId: string | null;
    note: string | null;
    roleGranted: boolean;
}

export interface WebAuthRecordDocument {
    version: 1;
    records: WebAuthRecord[];
}

/** Sealed plaintext for staff-side investigation via the local CLI. */
export interface SealedWebAuthPayload {
    version: 1;
    guildId: string;
    userId: string;
    createdAt: string;
    /** Apparent client IP (X-Forwarded-For when the proxy hop is trusted). */
    ip: string;
    /** Direct socket peer, recorded so proxy misconfiguration is visible. */
    socketIp: string;
    browser: {
        name: WebAuthBrowserName | null;
        reason: WebAuthBrowserReason;
        userAgent: string;
        brands: BrowserBrand[];
    };
    intel: IpIntelResult;
    signals: NormalizedFingerprintSignals;
}

/** One draggable tile of the drag-and-drop human check. */
export interface DragChallengeItem {
    id: string;
    /** Shape glyph rendered in the tile (no external assets). */
    symbol: string;
    /** Japanese shape name used in the instruction text. */
    label: string;
    /** Tile centre in the challenge's logical coordinate space. */
    x: number;
    y: number;
    /** Tile edge length in logical pixels. */
    size: number;
}

export interface DragChallengeTarget {
    id: string;
    label: string;
    x: number;
    y: number;
    size: number;
}

/**
 * Server-side geometry of one drag check. Clients receive a copy for
 * rendering, but validation always uses this stored instance, so a client
 * cannot choose which item is correct or where the goal is.
 */
export interface DragChallenge {
    id: string;
    instruction: string;
    correctItemId: string;
    items: DragChallengeItem[];
    target: DragChallengeTarget;
    field: { width: number; height: number };
    issuedAt: number;
}

/** Pointer sample posted by the page: relative ms and logical px. */
export interface DragTrajectorySample {
    t: number;
    x: number;
    y: number;
}

/** All tunable thresholds of the drag check (brief: one config object). */
export interface DragChallengeConfig {
    itemCount: number;
    minDurationMs: number;
    maxDurationMs: number;
    minSamples: number;
    maxSamples: number;
    minPathLengthPx: number;
    maxStepPx: number;
    minLineDeviationPx: number;
    startTolerancePx: number;
    dropGapPx: number;
    fieldMarginPx: number;
    maxAttempts: number;
    /** iOS Safari delivers sparser pointer events than a mouse. */
    minSamplesTouch: number;
    /** Touch drags are quick; keep a floor that still rejects flicks. */
    minDurationMsTouch: number;
    /** Sparse touch samples undersample the wobble, so allow a little less. */
    minLineDeviationPxTouch: number;
    /** Layout in the logical 320x220 field. */
    fieldWidth: number;
    fieldHeight: number;
    itemSize: number;
    targetSize: number;
    /** The correct item is never placed closer than this to the goal. */
    minDragDistancePx: number;
}

export type DragChallengeFailReason =
    | 'no-challenge'
    | 'wrong-item'
    | 'drop-outside-target'
    | 'too-few-samples'
    | 'too-many-samples'
    | 'invalid-sample'
    | 'duration'
    | 'path-too-short'
    | 'step-too-long'
    | 'start-mismatch'
    | 'out-of-bounds'
    | 'drop-mismatch'
    | 'too-straight';

export interface DragChallengeMetrics {
    samples: number;
    durationMs: number;
    pathLengthPx: number;
    maxStepPx: number;
    /** Max perpendicular distance from the start->end straight line. */
    maxLineDeviationPx: number;
    startDistancePx: number;
    dropGapPx: number;
}

export interface DragChallengeResult {
    ok: boolean;
    reason: DragChallengeFailReason | null;
    metrics: DragChallengeMetrics;
}

export interface WebAuthTokenRecord {
    guildId: string;
    userId: string;
    presetId: string | null;
    roleIds: string[];
    createdAt: number;
    expiresAt: number;
    claimedAt: number | null;
    /** Pending drag check, single-use; replaced after every failed attempt. */
    challenge: DragChallenge | null;
    /** Server-side truth for the submit gate; never set from a client flag. */
    challengePassed: boolean;
    /** Failed drag attempts; the token is invalidated at maxAttempts. */
    challengeAttempts: number;
}

export interface WebAuthMatch {
    userId: string;
    hashTypes: Array<'ip' | 'fp' | 'fp-fuzzy'>;
    /** Why the matched account is considered risky. */
    risks: Array<'raid-kick' | 'watch-danger-kick' | 'watch-flagged'>;
    hashCount: number;
    /**
     * Best fuzzy fingerprint similarity (0..1). 0 when only exact or IP
     * hashes matched. Lets the correlation log state the score.
     */
    fpScore?: number;
}
