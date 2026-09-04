import test from 'node:test';
import assert from 'node:assert/strict';
import { retryMediaDownload } from '../src/core/anticheat/ContentMedia.ts';

test('connection reset retries and returns only the successful download', async () => {
    let attempts = 0;
    const result = await retryMediaDownload(async () => {
        if (++attempts === 1) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        return Buffer.from('complete image');
    }, AbortSignal.timeout(3000));
    assert.equal(attempts, 2);
    assert.equal(result.toString(), 'complete image');
});

test('persistent resets stop after three attempts', async () => {
    let attempts = 0;
    const indices: number[] = [];
    await assert.rejects(retryMediaDownload(async attempt => {
        indices.push(attempt);
        attempts++;
        throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    }, AbortSignal.timeout(3000)), /reset/);
    assert.equal(attempts, 3);
    assert.deepEqual(indices, [0, 1, 2]);
});

test('permanent failures do not retry; cancellation interrupts backoff', async () => {
    for (const message of ['Media HTTP 403', 'Media too large', 'Non-public media host']) {
        let attempts = 0;
        await assert.rejects(retryMediaDownload(async () => { attempts++; throw new Error(message); }, AbortSignal.timeout(3000)));
        assert.equal(attempts, 1);
    }
    let attempts = 0;
    await assert.rejects(retryMediaDownload(async () => {
        attempts++;
        throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    }, AbortSignal.timeout(50)));
    assert.equal(attempts, 1);
});
