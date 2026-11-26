import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createDragChallenge,
    describeDragFailure,
    DRAG_CHALLENGE_CONFIG,
    evaluateDragChallenge,
    readDragChallengeConfig
} from '../src/core/webauth/challenge.ts';
import { WebAuthService } from '../src/core/webauth/WebAuthService.ts';
import { WebAuthTokenStore, WEBAUTH_TOKEN_TTL_MS } from '../src/core/webauth/tokens.ts';
import type { DragChallenge, DragTrajectorySample } from '../src/core/webauth/types.ts';

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Deterministic LCG so challenge generation is reproducible in tests. */
function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function idSequence(prefix = 'id'): () => string {
    let counter = 0;
    return () => `${prefix}-${++counter}`;
}

function testChallenge(overrides: {
    item?: { x: number; y: number };
    target?: { x: number; y: number };
} = {}): DragChallenge {
    const item = overrides.item || { x: 60, y: 60 };
    const target = overrides.target || { x: 260, y: 170 };
    return {
        id: 'challenge-test',
        instruction: '★（星）を ゴール へ ドラッグ',
        correctItemId: 'item-correct',
        items: [
            { id: 'item-correct', symbol: '★', label: '星', x: item.x, y: item.y, size: 44 },
            { id: 'item-other', symbol: '■', label: '四角', x: 40, y: 190, size: 44 }
        ],
        target: { id: 'target', label: 'ゴール', x: target.x, y: target.y, size: 64 },
        field: { width: DRAG_CHALLENGE_CONFIG.fieldWidth, height: DRAG_CHALLENGE_CONFIG.fieldHeight },
        issuedAt: 1_700_000_000_000
    };
}

/**
 * Human-like trajectory: linear progress plus a sideways sine wobble.
 * `wobble = 0` yields the synthetic straight-line bot path.
 */
function trajectory(
    challenge: DragChallenge,
    options: {
        count?: number;
        durationMs?: number;
        wobble?: number;
        itemId?: string;
        drop?: { x: number; y: number };
    } = {}
): { itemId: string; drop: { x: number; y: number }; samples: DragTrajectorySample[] } {
    const item = challenge.items.find((entry) => entry.id === (options.itemId || challenge.correctItemId))!;
    const target = challenge.target;
    const dx = target.x - item.x;
    const dy = target.y - item.y;
    const length = Math.hypot(dx, dy) || 1;
    const perpendicularX = -dy / length;
    const perpendicularY = dx / length;
    const count = options.count ?? 40;
    const durationMs = options.durationMs ?? 800;
    const wobble = options.wobble ?? 5;
    const samples: DragTrajectorySample[] = [];
    for (let index = 0; index < count; index += 1) {
        const ratio = count === 1 ? 1 : index / (count - 1);
        const offset = Math.sin(ratio * Math.PI * 3) * wobble;
        samples.push({
            t: Math.round(ratio * durationMs),
            x: Number((item.x + dx * ratio + perpendicularX * offset).toFixed(2)),
            y: Number((item.y + dy * ratio + perpendicularY * offset).toFixed(2))
        });
    }
    return {
        itemId: item.id,
        drop: options.drop || { x: target.x, y: target.y },
        samples
    };
}

test('challenge generation is random per issue and consistent inside one challenge', () => {
    const first = createDragChallenge({ random: seeded(7), idFactory: idSequence('a'), now: () => 111 });
    const second = createDragChallenge({ random: seeded(7), idFactory: idSequence('b'), now: () => 222 });
    const other = createDragChallenge({ random: seeded(8), idFactory: idSequence('c'), now: () => 333 });

    assert.equal(first.items.length, DRAG_CHALLENGE_CONFIG.itemCount);
    assert.equal(first.field.width, DRAG_CHALLENGE_CONFIG.fieldWidth);
    assert.equal(first.field.height, DRAG_CHALLENGE_CONFIG.fieldHeight);
    assert.equal(first.issuedAt, 111);
    assert.equal(second.issuedAt, 222);

    // Same seed -> same geometry, different ids.
    assert.deepEqual(
        first.items.map((item) => [item.symbol, item.x, item.y]),
        second.items.map((item) => [item.symbol, item.x, item.y])
    );
    // Different seed -> different arrangement (positions or symbols).
    assert.notDeepEqual(
        first.items.map((item) => [item.symbol, item.x, item.y]),
        other.items.map((item) => [item.symbol, item.x, item.y])
    );

    // Ids are unique, symbols are distinct, everything is inside the field.
    assert.equal(new Set(first.items.map((item) => item.id)).size, first.items.length);
    assert.equal(new Set(first.items.map((item) => item.symbol)).size, first.items.length);
    for (const item of first.items) {
        assert.ok(item.x > 0 && item.x < first.field.width, 'item inside field x');
        assert.ok(item.y > 0 && item.y < first.field.height, 'item inside field y');
        const insideTarget =
            Math.abs(item.x - first.target.x) <= first.target.size / 2 &&
            Math.abs(item.y - first.target.y) <= first.target.size / 2;
        assert.equal(insideTarget, false, 'no tile overlaps the goal');
    }

    const correct = first.items.find((item) => item.id === first.correctItemId)!;
    assert.ok(correct, 'correct item exists');
    assert.ok(first.instruction.includes(correct.symbol));
    assert.ok(first.instruction.includes(correct.label));
    assert.ok(
        Math.hypot(correct.x - first.target.x, correct.y - first.target.y) >= DRAG_CHALLENGE_CONFIG.minDragDistancePx,
        'the correct tile is far enough from the goal for a measurable drag'
    );
});

test('a jittered human-like drag passes and reports its metrics', () => {
    const challenge = testChallenge();
    const path = trajectory(challenge);
    const result = evaluateDragChallenge({ challenge, ...path });
    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.metrics.samples, 40);
    assert.ok(result.metrics.durationMs >= 700 && result.metrics.durationMs <= 900);
    assert.ok(result.metrics.pathLengthPx >= DRAG_CHALLENGE_CONFIG.minPathLengthPx);
    assert.ok(result.metrics.maxLineDeviationPx > DRAG_CHALLENGE_CONFIG.minLineDeviationPx);
    assert.ok(result.metrics.maxStepPx <= DRAG_CHALLENGE_CONFIG.maxStepPx);
});

test('a synthetic straight-line constant-speed bot path fails as too straight', () => {
    const challenge = testChallenge();
    const path = trajectory(challenge, { wobble: 0, durationMs: 900 });
    const result = evaluateDragChallenge({ challenge, ...path });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'too-straight');
    // Two-decimal rounding in the test helper leaves a sub-pixel deviation.
    assert.ok(result.metrics.maxLineDeviationPx < 0.1);
});

test('a teleport path (one oversized step) fails', () => {
    const challenge = testChallenge({ item: { x: 20, y: 20 }, target: { x: 300, y: 200 } });
    const start = challenge.items.find((item) => item.id === challenge.correctItemId)!;
    const samples: DragTrajectorySample[] = [{ t: 0, x: start.x, y: start.y }];
    for (let index = 1; index < 16; index += 1) {
        samples.push({ t: index * 50, x: challenge.target.x, y: challenge.target.y });
    }
    const result = evaluateDragChallenge({
        challenge,
        itemId: start.id,
        drop: { x: challenge.target.x, y: challenge.target.y },
        samples
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'step-too-long');
    assert.ok(result.metrics.maxStepPx > DRAG_CHALLENGE_CONFIG.maxStepPx);
});

test('a too-fast drag fails the duration floor', () => {
    const challenge = testChallenge();
    const path = trajectory(challenge, { durationMs: 200 });
    const result = evaluateDragChallenge({ challenge, ...path });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'duration');
});

test('a drag slower than the 30 s ceiling fails', () => {
    const challenge = testChallenge();
    const path = trajectory(challenge, { durationMs: 31_000 });
    const result = evaluateDragChallenge({ challenge, ...path });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'duration');
});

test('wrong item, wrong drop and too few samples are rejected', () => {
    const challenge = testChallenge();
    const path = trajectory(challenge);

    assert.equal(
        evaluateDragChallenge({ challenge, ...path, itemId: 'item-other' }).reason,
        'wrong-item'
    );
    assert.equal(
        evaluateDragChallenge({ challenge, ...path, drop: { x: 10, y: 10 } }).reason,
        'drop-outside-target'
    );
    assert.equal(
        evaluateDragChallenge({ challenge, ...trajectory(challenge, { count: 10 }) }).reason,
        'too-few-samples'
    );
    assert.equal(
        evaluateDragChallenge({ challenge, ...path, drop: null }).reason,
        'drop-outside-target'
    );
});

test('paths that are too short, start away from the item, leave the field or miss the last point fail', () => {
    const challenge = testChallenge();
    const item = challenge.items.find((entry) => entry.id === challenge.correctItemId)!;

    const bunched = Array.from({ length: 20 }, (_value, index) => ({
        t: index * 20,
        x: item.x + (index % 3),
        y: item.y
    }));
    assert.equal(
        evaluateDragChallenge({ challenge, itemId: item.id, drop: { x: challenge.target.x, y: challenge.target.y }, samples: bunched }).reason,
        'path-too-short'
    );

    const shifted = trajectory(challenge).samples.map((sample) => ({ ...sample, x: sample.x + 100 }));
    assert.equal(
        evaluateDragChallenge({ challenge, itemId: item.id, drop: { x: challenge.target.x, y: challenge.target.y }, samples: shifted }).reason,
        'start-mismatch'
    );

    const outside = trajectory(challenge).samples.map((sample, index) =>
        index === 20 ? { ...sample, x: challenge.field.width + 50 } : sample
    );
    assert.equal(
        evaluateDragChallenge({ challenge, itemId: item.id, drop: { x: challenge.target.x, y: challenge.target.y }, samples: outside }).reason,
        'out-of-bounds'
    );

    const farEnd = trajectory(challenge).samples.map((sample, index) =>
        index === 39 ? { ...sample, x: challenge.target.x - 85 } : sample
    );
    assert.equal(
        evaluateDragChallenge({ challenge, itemId: item.id, drop: { x: challenge.target.x, y: challenge.target.y }, samples: farEnd }).reason,
        'drop-mismatch'
    );
});

test('malformed or out-of-order samples and a missing challenge are rejected', () => {
    const challenge = testChallenge();
    const path = trajectory(challenge);
    const nan = path.samples.map((sample, index) => index === 3 ? { ...sample, x: Number.NaN } : sample);
    assert.equal(
        evaluateDragChallenge({ challenge, itemId: path.itemId, drop: path.drop, samples: nan }).reason,
        'invalid-sample'
    );

    const reversedT = path.samples.map((sample, index) =>
        index === 20 ? { ...sample, t: 10 } : sample
    );
    assert.equal(
        evaluateDragChallenge({ challenge, itemId: path.itemId, drop: path.drop, samples: reversedT }).reason,
        'invalid-sample'
    );

    const tooMany = Array.from({ length: DRAG_CHALLENGE_CONFIG.maxSamples + 1 }, (_value, index) => ({
        t: index,
        x: 1,
        y: 1
    }));
    assert.equal(
        evaluateDragChallenge({ challenge, itemId: path.itemId, drop: path.drop, samples: tooMany }).reason,
        'too-many-samples'
    );

    assert.equal(
        evaluateDragChallenge({ challenge: null, itemId: path.itemId, drop: path.drop, samples: path.samples }).reason,
        'no-challenge'
    );
});

test('thresholds come from the single config object and can be overridden', () => {
    const challenge = testChallenge();
    const path = trajectory(challenge, { wobble: 5, durationMs: 800 });
    assert.equal(evaluateDragChallenge({ challenge, ...path }).ok, true);
    assert.equal(
        evaluateDragChallenge({ challenge, ...path }, { minLineDeviationPx: 10 }).reason,
        'too-straight'
    );
    assert.equal(
        evaluateDragChallenge({ challenge, ...path }, { minDurationMs: 5_000 }).reason,
        'duration'
    );

    const defaults = readDragChallengeConfig({});
    assert.equal(defaults.minSamples, 15);
    assert.equal(defaults.minPathLengthPx, 80);
    assert.equal(defaults.maxStepPx, 250);
    assert.equal(defaults.minLineDeviationPx, 3);
    const overridden = readDragChallengeConfig({ minSamples: 30, bogus: 'x' } as any);
    assert.equal(overridden.minSamples, 30);
    assert.equal(overridden.maxStepPx, defaults.maxStepPx);

    // Failure reasons map to Japanese retry/status text.
    for (const reason of ['wrong-item', 'drop-outside-target', 'too-straight', 'no-challenge', null] as const) {
        assert.ok(describeDragFailure(reason).length > 0);
    }
});

test('the challenge is bound to the token, replaced after failure and survives a reload', async () => {
    const service = new WebAuthService();
    const { token } = service.createToken({ guildId: 'guild-challenge', userId: 'user-challenge' });

    const issued = service.issueChallenge(token);
    assert.ok(issued);
    assert.equal(service.issueChallenge(token)?.id, issued!.id, 'reload reuses the pending geometry');

    const wrong = await service.verifyChallenge({
        token,
        itemId: 'not-the-item',
        drop: { x: 0, y: 0 },
        samples: [],
        userAgent: CHROME_UA
    });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) {
        assert.equal(wrong.status, 'failed');
        assert.equal(wrong.attemptsLeft, DRAG_CHALLENGE_CONFIG.maxAttempts - 1);
        assert.ok(wrong.challenge && wrong.challenge.id !== issued!.id, 'new arrangement issued');
        assert.match(wrong.message, /図形/);
    }

    const record = service.tokens.peek(token).record!;
    assert.equal(record.challengeAttempts, 1);
    assert.equal(record.challenge?.id, (wrong as any).challenge.id);

    const passed = await service.verifyChallenge({
        token,
        ...trajectory(record.challenge!),
        userAgent: CHROME_UA
    });
    assert.equal(passed.ok, true);
    assert.equal(service.tokens.peek(token).record?.challengePassed, true);
    assert.equal(service.tokens.peek(token).record?.challenge, null);

    // Idempotent: a second verify on a passed token is still ok.
    assert.equal((await service.verifyChallenge({ token, itemId: 'x', drop: null, samples: [], userAgent: CHROME_UA })).ok, true);
});

test('five failed attempts invalidate the token (attempt/lifetime handling)', async () => {
    const service = new WebAuthService();
    const { token } = service.createToken({ guildId: 'guild-attempts', userId: 'user-attempts' });

    const statuses: string[] = [];
    for (let attempt = 1; attempt <= DRAG_CHALLENGE_CONFIG.maxAttempts; attempt += 1) {
        const result = await service.verifyChallenge({
            token,
            itemId: 'wrong',
            drop: { x: 0, y: 0 },
            samples: [],
            userAgent: CHROME_UA
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
            statuses.push(result.status);
            if (attempt < DRAG_CHALLENGE_CONFIG.maxAttempts) {
                assert.equal(result.attemptsLeft, DRAG_CHALLENGE_CONFIG.maxAttempts - attempt);
                assert.ok(result.challenge);
            }
        }
    }
    assert.deepEqual(statuses, ['failed', 'failed', 'failed', 'failed', 'locked']);
    assert.equal(service.tokens.peek(token).status, 'missing');
    assert.equal(service.issueChallenge(token), null);
});

test('the token lifetime still bounds the challenge and non-Chrome clients cannot verify', async () => {
    let clock = 1_700_000_000_000;
    const tokens = new WebAuthTokenStore(() => clock);
    const service = new WebAuthService({ tokens });
    const { token } = service.createToken({ guildId: 'guild-expiry', userId: 'user-expiry' });
    const challenge = service.issueChallenge(token)!;

    const firefox = await service.verifyChallenge({
        token,
        ...trajectory(challenge),
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'
    });
    assert.equal(firefox.ok, false);
    if (!firefox.ok) assert.equal(firefox.status, 'browser');
    assert.equal(tokens.peek(token).record?.challengeAttempts, 0, 'browser refusal does not burn an attempt');

    clock += WEBAUTH_TOKEN_TTL_MS;
    const expired = await service.verifyChallenge({ token, ...trajectory(challenge), userAgent: CHROME_UA });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.status, 'expired');
    assert.equal(service.issueChallenge(token), null);
});
