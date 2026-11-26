import crypto from 'node:crypto';
import type {
    DragChallenge,
    DragChallengeConfig,
    DragChallengeFailReason,
    DragChallengeItem,
    DragChallengeMetrics,
    DragChallengeResult,
    DragChallengeTarget,
    DragTrajectorySample
} from './types.js';

/**
 * Drag-and-drop human check for the WebAuth page.
 *
 * A challenge places a few labelled tiles and one goal in a fixed logical
 * field (320 x 220). The page asks for one specific tile by symbol, and the
 * server validates the posted pointer trajectory. Everything here is pure
 * (no Express, no Discord) so the metric is directly testable.
 *
 * Human-likeness metric: **max perpendicular distance from the straight
 * start->end line**. A scripted drag interpolates the line exactly, so its
 * deviation is ~0 even with perfectly constant speed. A hand always wobbles
 * sideways by a few pixels. We additionally require enough samples, a
 * minimum path length, a bounded single step (no teleport) and a plausible
 * duration.
 */

/** All thresholds for generation and validation live in this object. */
export const DRAG_CHALLENGE_CONFIG: DragChallengeConfig = {
    itemCount: 4,
    minDurationMs: 300,
    maxDurationMs: 30_000,
    minSamples: 15,
    maxSamples: 2_000,
    minPathLengthPx: 80,
    maxStepPx: 250,
    minLineDeviationPx: 3,
    startTolerancePx: 24,
    dropGapPx: 60,
    fieldMarginPx: 40,
    maxAttempts: 5,
    fieldWidth: 320,
    fieldHeight: 220,
    itemSize: 44,
    targetSize: 64,
    minDragDistancePx: 100
};

interface DragShape {
    symbol: string;
    label: string;
}

/** Simple glyphs; the page renders them as text (no external assets). */
const DRAG_SHAPES: readonly DragShape[] = [
    { symbol: '★', label: '星' },
    { symbol: '▲', label: '三角' },
    { symbol: '■', label: '四角' },
    { symbol: '●', label: '丸' },
    { symbol: '◆', label: 'ひし形' },
    { symbol: '✚', label: '十字' }
];

const GRID_COLUMNS = 4;
const GRID_ROWS = 3;

/** Values from a stored/partial config; invalid entries keep the default. */
export function readDragChallengeConfig(
    value: Partial<DragChallengeConfig> | null | undefined
): DragChallengeConfig {
    const source = (value || {}) as Record<string, unknown>;
    const resolved = { ...DRAG_CHALLENGE_CONFIG } as Record<string, number>;
    for (const key of Object.keys(DRAG_CHALLENGE_CONFIG)) {
        const parsed = Number(source[key]);
        if (Number.isFinite(parsed) && parsed > 0) resolved[key] = parsed;
    }
    return resolved as unknown as DragChallengeConfig;
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
    const copy = [...values];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const target = Math.floor(random() * (index + 1));
        const swap = copy[index];
        copy[index] = copy[target];
        copy[target] = swap;
    }
    return copy;
}

const distance = (ax: number, ay: number, bx: number, by: number): number =>
    Math.hypot(ax - bx, ay - by);

interface Layout {
    target: DragChallengeTarget;
    items: DragChallengeItem[];
}

function buildLayout(
    random: () => number,
    idFactory: () => string,
    config: DragChallengeConfig,
    shapes: readonly DragShape[]
): Layout {
    const cellWidth = config.fieldWidth / GRID_COLUMNS;
    const cellHeight = config.fieldHeight / GRID_ROWS;
    const cells = shuffle(
        Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_value, index) => index),
        random
    );

    const cellCenter = (cell: number, x: number, y: number): { x: number; y: number } => ({
        x: (cell % GRID_COLUMNS) * cellWidth + cellWidth / 2 + x,
        y: Math.floor(cell / GRID_COLUMNS) * cellHeight + cellHeight / 2 + y
    });

    const targetCell = cells[0];
    const targetCenter = cellCenter(targetCell, 0, 0);
    const target: DragChallengeTarget = {
        id: idFactory(),
        label: 'ゴール',
        x: Math.round(targetCenter.x * 10) / 10,
        y: Math.round(targetCenter.y * 10) / 10,
        size: config.targetSize
    };

    const halfItem = config.itemSize / 2;
    const limitX = cellWidth / 2 - halfItem - 2;
    const limitY = cellHeight / 2 - halfItem - 2;
    const items = cells.slice(1, config.itemCount + 1).map((cell, index) => {
        const jitterX = (random() - 0.5) * Math.max(0, limitX) * 2;
        const jitterY = (random() - 0.5) * Math.max(0, limitY) * 2;
        const center = cellCenter(cell, jitterX, jitterY);
        return {
            id: idFactory(),
            symbol: shapes[index].symbol,
            label: shapes[index].label,
            x: Math.round(center.x * 10) / 10,
            y: Math.round(center.y * 10) / 10,
            size: config.itemSize
        };
    });

    return { target, items };
}

/**
 * Creates one challenge with random tile placement and a random correct
 * tile. `random` is injectable so tests can be deterministic.
 */
export function createDragChallenge(options: {
    random?: () => number;
    now?: () => number;
    idFactory?: () => string;
} = {}): DragChallenge {
    const config = DRAG_CHALLENGE_CONFIG;
    const random = options.random || Math.random;
    const now = options.now || Date.now;
    const idFactory = options.idFactory || (() => crypto.randomBytes(6).toString('hex'));

    const itemCount = Math.max(
        1,
        Math.min(Math.floor(config.itemCount), DRAG_SHAPES.length, GRID_COLUMNS * GRID_ROWS - 1)
    );
    const shapes = shuffle(DRAG_SHAPES, random).slice(0, itemCount);
    const layoutConfig = { ...config, itemCount };
    let layout = buildLayout(random, idFactory, layoutConfig, shapes);

    // A valid drag must be long enough to measure a trajectory, so never ask
    // for a tile that sits right next to the goal. Reshuffle a few times;
    // otherwise fall back to the farthest tile in the last layout.
    let candidates = layout.items.filter((item) =>
        distance(item.x, item.y, layout.target.x, layout.target.y) >= config.minDragDistancePx
    );
    for (let attempt = 0; attempt < 12 && candidates.length === 0; attempt += 1) {
        layout = buildLayout(random, idFactory, layoutConfig, shapes);
        candidates = layout.items.filter((item) =>
            distance(item.x, item.y, layout.target.x, layout.target.y) >= config.minDragDistancePx
        );
    }
    if (!candidates.length) {
        candidates = [layout.items.reduce((best, item) =>
            distance(item.x, item.y, layout.target.x, layout.target.y)
                > distance(best.x, best.y, layout.target.x, layout.target.y)
                ? item
                : best
        )];
    }

    const correct = candidates[Math.floor(random() * candidates.length)] || candidates[0];
    return {
        id: idFactory(),
        instruction: `${correct.symbol}（${correct.label}）を ゴール へ ドラッグ`,
        correctItemId: correct.id,
        items: layout.items,
        target: layout.target,
        field: { width: config.fieldWidth, height: config.fieldHeight },
        issuedAt: now()
    };
}

const emptyMetrics = (): DragChallengeMetrics => ({
    samples: 0,
    durationMs: 0,
    pathLengthPx: 0,
    maxStepPx: 0,
    maxLineDeviationPx: 0,
    startDistancePx: 0,
    dropGapPx: 0
});

function fail(reason: DragChallengeFailReason, metrics: DragChallengeMetrics): DragChallengeResult {
    return { ok: false, reason, metrics };
}

function isFinitePoint(value: unknown): value is { x: number; y: number } {
    if (!value || typeof value !== 'object') return false;
    const point = value as { x?: unknown; y?: unknown };
    return Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

/**
 * Pure validation of a posted drag attempt against the stored geometry.
 * Returns a machine reason; the caller maps it to Japanese status text.
 */
export function evaluateDragChallenge(
    input: {
        challenge: DragChallenge | null;
        itemId: unknown;
        drop: { x: number; y: number } | null | undefined;
        samples: DragTrajectorySample[] | null | undefined;
    },
    configValue: Partial<DragChallengeConfig> = {}
): DragChallengeResult {
    const config = readDragChallengeConfig(configValue);
    const metrics = emptyMetrics();
    const challenge = input?.challenge || null;
    if (!challenge) return fail('no-challenge', metrics);

    if (typeof input.itemId !== 'string' || input.itemId !== challenge.correctItemId) {
        return fail('wrong-item', metrics);
    }
    if (!isFinitePoint(input.drop)) return fail('drop-outside-target', metrics);
    const drop = { x: Number(input.drop.x), y: Number(input.drop.y) };
    const halfTarget = challenge.target.size / 2;
    if (
        Math.abs(drop.x - challenge.target.x) > halfTarget ||
        Math.abs(drop.y - challenge.target.y) > halfTarget
    ) {
        return fail('drop-outside-target', metrics);
    }

    const rawSamples = Array.isArray(input.samples) ? input.samples : [];
    metrics.samples = rawSamples.length;
    if (rawSamples.length < config.minSamples) return fail('too-few-samples', metrics);
    if (rawSamples.length > config.maxSamples) return fail('too-many-samples', metrics);

    const samples: DragTrajectorySample[] = [];
    for (const raw of rawSamples) {
        if (!raw || typeof raw !== 'object') return fail('invalid-sample', metrics);
        const t = Number((raw as DragTrajectorySample).t);
        const x = Number((raw as DragTrajectorySample).x);
        const y = Number((raw as DragTrajectorySample).y);
        if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) {
            return fail('invalid-sample', metrics);
        }
        if (samples.length && t < samples[samples.length - 1].t) {
            return fail('invalid-sample', metrics);
        }
        samples.push({ t, x, y });
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    metrics.durationMs = last.t - first.t;
    if (metrics.durationMs < config.minDurationMs || metrics.durationMs > config.maxDurationMs) {
        return fail('duration', metrics);
    }

    let pathLength = 0;
    let maxStep = 0;
    for (let index = 1; index < samples.length; index += 1) {
        const step = distance(samples[index - 1].x, samples[index - 1].y, samples[index].x, samples[index].y);
        pathLength += step;
        if (step > maxStep) maxStep = step;
    }
    metrics.pathLengthPx = pathLength;
    metrics.maxStepPx = maxStep;
    if (pathLength < config.minPathLengthPx) return fail('path-too-short', metrics);
    if (maxStep > config.maxStepPx) return fail('step-too-long', metrics);

    const item = challenge.items.find((entry) => entry.id === challenge.correctItemId);
    if (!item) return fail('no-challenge', metrics);
    metrics.startDistancePx = distance(first.x, first.y, item.x, item.y);
    if (metrics.startDistancePx > item.size / 2 + config.startTolerancePx) {
        return fail('start-mismatch', metrics);
    }

    const margin = config.fieldMarginPx;
    for (const sample of samples) {
        if (
            sample.x < -margin || sample.y < -margin ||
            sample.x > challenge.field.width + margin || sample.y > challenge.field.height + margin
        ) {
            return fail('out-of-bounds', metrics);
        }
    }

    metrics.dropGapPx = distance(last.x, last.y, drop.x, drop.y);
    if (metrics.dropGapPx > config.dropGapPx) return fail('drop-mismatch', metrics);

    const lineLength = distance(first.x, first.y, last.x, last.y);
    let deviation = 0;
    if (lineLength >= 1) {
        const dx = (last.x - first.x) / lineLength;
        const dy = (last.y - first.y) / lineLength;
        for (const sample of samples) {
            const px = sample.x - first.x;
            const py = sample.y - first.y;
            // Perpendicular component of the point relative to the unit
            // start->end direction.
            const perpendicular = Math.abs(px * dy - py * dx);
            if (perpendicular > deviation) deviation = perpendicular;
        }
    }
    metrics.maxLineDeviationPx = deviation;
    if (deviation <= config.minLineDeviationPx) return fail('too-straight', metrics);

    return { ok: true, reason: null, metrics };
}

const GENERIC_RETRY_MESSAGE = '操作を確認できませんでした。もう一度、ゆっくりドラッグしてください。';

/** Japanese status text for a failed attempt (page-facing). */
export function describeDragFailure(reason: DragChallengeFailReason | null): string {
    switch (reason) {
        case 'wrong-item':
            return '指示された図形ではありません。新しい配置でもう一度お試しください。';
        case 'drop-outside-target':
            return 'ゴール枠の中にドロップしてください。新しい配置でもう一度お試しください。';
        case 'no-challenge':
            return 'チェックを開始できませんでした。ページを再読み込みしてください。';
        default:
            return GENERIC_RETRY_MESSAGE;
    }
}
