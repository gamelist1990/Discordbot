import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_RAID_JOIN_ENTROPY,
    computeJoinEntropy,
    formatJoinEntropyMetric,
    readJoinEntropyConfig
} from '../src/core/anticheat/JoinEntropy.ts';

const SECOND = 1000;
const START = 1_700_000_000_000;

/** Joins whose inter-arrival gaps are exactly `gapsSeconds`. */
function joinsFromGaps(gapsSeconds: number[]): number[] {
    const times = [START];
    for (const gap of gapsSeconds) times.push(times[times.length - 1] + gap * SECOND);
    return times;
}

test('perfectly regular joins trigger the automation condition with CV and mean gap', () => {
    const timestamps = joinsFromGaps([10, 10, 10, 10, 10, 10, 10]);
    const result = computeJoinEntropy(timestamps);
    assert.equal(result.joins, 8);
    assert.equal(result.gaps, 7);
    assert.equal(result.meanGapMs, 10_000);
    assert.equal(result.stdDevMs, 0);
    assert.equal(result.cv, 0);
    assert.equal(result.computable, true);
    assert.equal(result.automated, true);
    assert.match(result.reason || '', /CV=0\.00/);
    assert.match(result.reason || '', /平均間隔=10\.0秒/);
    assert.match(result.reason || '', /8件/);
    assert.match(formatJoinEntropyMetric(result) || '', /平均 10\.0秒 \/ CV 0\.00/);
});

test('human-like irregular joins do not trigger even when they are fast', () => {
    const result = computeJoinEntropy(joinsFromGaps([1, 3, 8, 2, 12, 4, 6]));
    assert.equal(result.joins, 8);
    assert.ok((result.cv || 0) > 0.35);
    assert.equal(result.automated, false);
    assert.equal(result.reason, null);
    // The metric is still computable for the activation embed.
    assert.equal(result.computable, true);
    assert.ok(formatJoinEntropyMetric(result));
});

test('too few joins never trigger, even with a perfect cadence', () => {
    const seven = computeJoinEntropy(joinsFromGaps([5, 5, 5, 5, 5, 5]));
    assert.equal(seven.joins, 7);
    assert.equal(seven.automated, false);
    assert.equal(seven.cv, 0);
    assert.equal(computeJoinEntropy([]).automated, false);
    assert.equal(computeJoinEntropy([START]).computable, false);
    assert.equal(computeJoinEntropy([]).reason, null);
});

test('the mean-gap bound is enforced independently of the CV', () => {
    const slowButRegular = computeJoinEntropy(joinsFromGaps([61, 61, 61, 61, 61, 61, 61]));
    assert.equal(slowButRegular.cv, 0);
    assert.equal(slowButRegular.meanGapMs, 61_000);
    assert.equal(slowButRegular.automated, false);
});

test('the automation thresholds are configurable', () => {
    const timestamps = joinsFromGaps([90, 90, 90, 90, 90]);
    assert.equal(computeJoinEntropy(timestamps).automated, false);
    assert.equal(computeJoinEntropy(timestamps, {
        minJoins: 5, meanGapSeconds: 120, cvThreshold: 0.35
    }).automated, true);
    assert.equal(computeJoinEntropy(joinsFromGaps([10, 10, 10, 10, 10, 10, 10]), {
        minJoins: 20
    }).automated, false);
});

test('config defaults and clamping match the documented values', () => {
    assert.deepEqual(readJoinEntropyConfig(undefined), DEFAULT_RAID_JOIN_ENTROPY);
    const clamped = readJoinEntropyConfig({
        minJoins: 1,
        meanGapSeconds: -5,
        cvThreshold: 2
    });
    assert.equal(clamped.minJoins, 2);
    assert.equal(clamped.meanGapSeconds, DEFAULT_RAID_JOIN_ENTROPY.meanGapSeconds);
    assert.equal(clamped.cvThreshold, 2);
});

test('timestamps are sorted, so cache order cannot change the result', () => {
    const timestamps = joinsFromGaps([10, 20, 10, 10, 20, 10, 10]);
    const shuffled = [...timestamps].reverse();
    assert.deepEqual(computeJoinEntropy(shuffled), computeJoinEntropy(timestamps));
});
