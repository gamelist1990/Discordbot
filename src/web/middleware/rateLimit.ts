import type { Request, RequestHandler } from 'express';
import type { ResolvedClientIp } from './clientIp.js';

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
}

interface WindowEntry {
    count: number;
    resetAt: number;
}

/** Small fixed-window limiter; enough for the public WebAuth page and submit. */
export class FixedWindowRateLimiter {
    private windows = new Map<string, WindowEntry>();

    constructor(
        private readonly windowMs: number,
        private readonly max: number,
        private readonly now: () => number = Date.now
    ) {}

    hit(key: string): RateLimitResult {
        const now = this.now();
        const current = this.windows.get(key);
        if (!current || current.resetAt <= now) {
            this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
            this.prune(now);
            return { allowed: true, remaining: this.max - 1, retryAfterMs: 0 };
        }
        if (current.count >= this.max) {
            return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, current.resetAt - now) };
        }
        current.count += 1;
        return { allowed: true, remaining: this.max - current.count, retryAfterMs: 0 };
    }

    reset(): void {
        this.windows.clear();
    }

    private prune(now: number): void {
        if (this.windows.size < 10_000) return;
        for (const [key, entry] of this.windows.entries()) {
            if (entry.resetAt <= now) this.windows.delete(key);
        }
    }
}

export function createRateLimitMiddleware(
    limiter: FixedWindowRateLimiter,
    keyFor: (req: Request) => string,
    message: string
): RequestHandler {
    return (req, res, next) => {
        const result = limiter.hit(keyFor(req));
        if (!result.allowed) {
            res.setHeader('Retry-After', Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
            res.status(429).json({ error: message });
            return;
        }
        next();
    };
}

export interface RequestWithClientIp {
    clientIp?: ResolvedClientIp;
}
