import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { webAuthService } from '../../core/webauth/WebAuthService.js';
import { isWellFormedWebAuthToken } from '../../core/webauth/tokens.js';
import type { FingerprintSignals } from '../../core/webauth/types.js';
import { requestClientIp, type ResolvedClientIp } from '../middleware/clientIp.js';
import { createRateLimitMiddleware, FixedWindowRateLimiter } from '../middleware/rateLimit.js';
import {
    renderWebAuthErrorPage,
    renderWebAuthPage,
    renderWebAuthSuccessPage
} from '../webauth/page.js';

const PAGE_CSP = (nonce: string): string => [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
    'font-src https://fonts.gstatic.com',
    "connect-src 'self'",
    "img-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
].join('; ');

function rateKey(req: Request): string {
    const resolved = (req as any).clientIp as ResolvedClientIp | undefined;
    return resolved?.clientIp || resolved?.socketIp || 'unknown';
}

function attachClientIp(req: Request, _res: Response, next: () => void): void {
    (req as any).clientIp = requestClientIp(req);
    next();
}

function sendPage(res: Response, status: number, html: string, nonce: string): void {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', PAGE_CSP(nonce));
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.send(html);
}

export function createWebAuthPageRoutes(): Router {
    const router = Router();
    const pageLimiter = new FixedWindowRateLimiter(60_000, 30);
    router.use(attachClientIp);
    router.use(createRateLimitMiddleware(pageLimiter, rateKey, 'アクセスが集中しています。しばらく待ってから再試行してください。'));
    router.use((_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        next();
    });

    router.get('/success', (req: Request, res: Response) => {
        const nonce = crypto.randomBytes(16).toString('base64');
        sendPage(res, 200, renderWebAuthSuccessPage(req.query.roles !== '0', nonce), nonce);
    });

    router.get('/:token', async (req: Request, res: Response) => {
        const token = String(req.params.token || '');
        const nonce = crypto.randomBytes(16).toString('base64');
        if (!isWellFormedWebAuthToken(token)) {
            sendPage(res, 404, renderWebAuthErrorPage('invalid', null, nonce), nonce);
            return;
        }
        const resolved = requestClientIp(req);
        try {
            const data = await webAuthService.getPageData({
                token,
                userAgent: String(req.headers['user-agent'] || ''),
                clientHint: typeof req.headers['sec-ch-ua'] === 'string' ? req.headers['sec-ch-ua'] : null,
                clientIp: resolved.clientIp
            });
            const status = data.status === 'ready'
                ? 200
                : data.status === 'expired' || data.status === 'in-use'
                    ? 410
                    : 404;
            sendPage(res, status, renderWebAuthPage(data, nonce), nonce);
        } catch {
            sendPage(res, 500, renderWebAuthErrorPage('error', '一時的なエラーが発生しました。時間をおいて再試行してください。', nonce), nonce);
        }
    });

    return router;
}

type SubmitBody = { signals?: FingerprintSignals };
type ChallengeBody = {
    itemId?: unknown;
    drop?: { x?: unknown; y?: unknown } | null;
    samples?: Array<{ t?: unknown; x?: unknown; y?: unknown }>;
    pointerType?: unknown;
};

export function createWebAuthApiRoutes(): Router {
    const router = Router();
    const submitLimiter = new FixedWindowRateLimiter(60_000, 5);
    const challengeLimiter = new FixedWindowRateLimiter(60_000, 30);
    router.use(attachClientIp);

    router.post(
        '/:token/challenge',
        createRateLimitMiddleware(challengeLimiter, rateKey, '試行回数が多すぎます。1分ほど待ってから再試行してください。'),
        async (req: Request, res: Response) => {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            const token = String(req.params.token || '');
            if (!isWellFormedWebAuthToken(token)) {
                res.status(404).json({ ok: false, error: 'この認証リンクは無効です。' });
                return;
            }
            const body = (req.body || {}) as ChallengeBody;
            const drop = body.drop && typeof body.drop === 'object' ? body.drop : null;
            const result = await webAuthService.verifyChallenge({
                token,
                itemId: body.itemId,
                drop: drop
                    ? { x: Number(drop.x), y: Number(drop.y) }
                    : null,
                samples: Array.isArray(body.samples)
                    ? body.samples.map((sample) => ({
                        t: Number(sample?.t),
                        x: Number(sample?.x),
                        y: Number(sample?.y)
                    }))
                    : null,
                pointerType: typeof body.pointerType === 'string' ? body.pointerType : null,
                userAgent: String(req.headers['user-agent'] || ''),
                clientHint: typeof req.headers['sec-ch-ua'] === 'string' ? req.headers['sec-ch-ua'] : null
            });
            if (result.ok) {
                res.json({ ok: true });
                return;
            }
            const status = result.status === 'failed'
                ? 200
                : result.status === 'browser'
                    ? 403
                    : result.status === 'locked' || result.status === 'expired'
                        ? 410
                        : 404;
            res.status(status).json({
                ok: false,
                status: result.status,
                error: result.message,
                attemptsLeft: result.attemptsLeft,
                challenge: result.challenge ?? null,
                reason: result.reason ?? null
            });
        }
    );

    router.post(
        '/:token/submit',
        createRateLimitMiddleware(submitLimiter, rateKey, '試行回数が多すぎます。1分ほど待ってから再試行してください。'),
        async (req: Request, res: Response) => {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            const token = String(req.params.token || '');
            if (!isWellFormedWebAuthToken(token)) {
                res.status(404).json({ ok: false, error: 'この認証リンクは無効です。' });
                return;
            }
            const body = (req.body || {}) as SubmitBody;
            const signals = body.signals;
            if (!signals || typeof signals !== 'object' || Array.isArray(signals)) {
                res.status(400).json({ ok: false, error: '認証データが不正です。' });
                return;
            }

            const resolved = requestClientIp(req);
            if (!resolved.clientIp) {
                res.status(400).json({ ok: false, error: 'クライアントIPを判定できませんでした。' });
                return;
            }

            const result = await webAuthService.submit({
                token,
                clientIp: resolved.clientIp,
                socketIp: resolved.socketIp,
                signals,
                clientHint: typeof req.headers['sec-ch-ua'] === 'string' ? req.headers['sec-ch-ua'] : null
            });

            if (result.ok) {
                res.json({ ok: true, roleGranted: result.roleGranted });
                return;
            }

            const status = result.status === 'browser' || result.status === 'vpn' || result.status === 'challenge'
                ? 403
                : result.status === 'invalid'
                    ? 404
                    : result.status === 'expired' || result.status === 'in-use'
                        ? 410
                        : 500;
            res.status(status).json({ ok: false, error: result.message });
        }
    );

    return router;
}
