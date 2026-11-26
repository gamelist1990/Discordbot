import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWebAuthApiRoutes } from '../src/web/routes/webauth.ts';
import { webAuthService } from '../src/core/webauth/WebAuthService.ts';
import type { DragChallenge } from '../src/core/webauth/types.ts';

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function createApp() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/webauth', createWebAuthApiRoutes());
    return app;
}

async function serve(app: ReturnType<typeof createApp>) {
    const server = await new Promise<import('node:http').Server>((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return {
        base: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve) => server.close(() => resolve()))
    };
}

/** Same human-like path as the pure tests: linear motion plus a sine wobble. */
function humanPath(challenge: DragChallenge) {
    const item = challenge.items.find((entry) => entry.id === challenge.correctItemId)!;
    const target = challenge.target;
    const dx = target.x - item.x;
    const dy = target.y - item.y;
    const length = Math.hypot(dx, dy) || 1;
    const perpendicularX = -dy / length;
    const perpendicularY = dx / length;
    const samples = Array.from({ length: 40 }, (_value, index) => {
        const ratio = index / 39;
        const wobble = Math.sin(ratio * Math.PI * 3) * 5;
        return {
            t: Math.round(ratio * 800),
            x: Number((item.x + dx * ratio + perpendicularX * wobble).toFixed(1)),
            y: Number((item.y + dy * ratio + perpendicularY * wobble).toFixed(1))
        };
    });
    return { itemId: item.id, drop: { x: target.x, y: target.y }, samples };
}

async function postJson(url: string, body: unknown) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME_UA },
        body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
}

test('submit is refused (403) until the drag check has passed server-side', async () => {
    const app = createApp();
    const { base, close } = await serve(app);
    try {
        const { token } = webAuthService.createToken({ guildId: 'guild-route-gate', userId: 'user-route-gate' });
        const response = await postJson(`${base}/api/webauth/${token}/submit`, {
            signals: { userAgent: CHROME_UA }
        });
        assert.equal(response.status, 403);
        assert.equal(response.body.ok, false);
        assert.match(String(response.body.error), /操作チェック/);
        assert.equal(webAuthService.tokens.peek(token).status, 'valid', 'token is not burned by the refusal');

        // A client-side flag in the body is ignored; only token state counts.
        const spoofed = await postJson(`${base}/api/webauth/${token}/submit`, {
            signals: { userAgent: CHROME_UA },
            challengePassed: true
        });
        assert.equal(spoofed.status, 403);
        assert.equal(webAuthService.tokens.peek(token).status, 'valid');
    } finally {
        await close();
    }
});

test('the challenge endpoint accepts a human-like drag and flips the submit gate', async () => {
    const app = createApp();
    const { base, close } = await serve(app);
    try {
        const { token } = webAuthService.createToken({ guildId: 'guild-route-pass', userId: 'user-route-pass' });
        const challenge = webAuthService.issueChallenge(token);
        assert.ok(challenge);

        const response = await postJson(`${base}/api/webauth/${token}/challenge`, humanPath(challenge!));
        assert.equal(response.status, 200);
        assert.equal(response.body.ok, true);

        const record = webAuthService.tokens.peek(token).record!;
        assert.equal(record.challengePassed, true);
        assert.equal(record.challenge, null);
    } finally {
        await close();
    }
});

test('a teleport-style bot trajectory is rejected and gets a fresh arrangement', async () => {
    const app = createApp();
    const { base, close } = await serve(app);
    try {
        const { token } = webAuthService.createToken({ guildId: 'guild-route-bot', userId: 'user-route-bot' });
        const challenge = webAuthService.issueChallenge(token)!;
        const item = challenge.items.find((entry) => entry.id === challenge.correctItemId)!;
        const samples = [{ t: 0, x: item.x, y: item.y }];
        for (let index = 1; index < 30; index += 1) {
            samples.push({ t: index * 30, x: challenge.target.x, y: challenge.target.y });
        }
        const response = await postJson(`${base}/api/webauth/${token}/challenge`, {
            itemId: item.id,
            drop: { x: challenge.target.x, y: challenge.target.y },
            samples
        });
        assert.equal(response.status, 200);
        assert.equal(response.body.ok, false);
        assert.equal(response.body.status, 'failed');
        assert.equal(response.body.attemptsLeft, 4);
        assert.ok(response.body.challenge && response.body.challenge.id !== challenge.id);
        assert.equal(webAuthService.tokens.peek(token).record?.challengePassed, false);
    } finally {
        await close();
    }
});

test('five failed attempts return 410 and invalidate the link', async () => {
    const app = createApp();
    const { base, close } = await serve(app);
    try {
        const { token } = webAuthService.createToken({ guildId: 'guild-route-lock', userId: 'user-route-lock' });
        const statuses: number[] = [];
        let lastBody: any = null;
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const response = await postJson(`${base}/api/webauth/${token}/challenge`, {
                itemId: 'wrong-item',
                drop: { x: 0, y: 0 },
                samples: []
            });
            statuses.push(response.status);
            lastBody = response.body;
        }
        assert.deepEqual(statuses, [200, 200, 200, 200, 410]);
        assert.equal(lastBody.status, 'locked');
        assert.equal(webAuthService.tokens.peek(token).status, 'missing');
    } finally {
        await close();
    }
});
