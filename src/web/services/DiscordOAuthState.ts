import crypto from 'node:crypto';

export interface DiscordOAuthState {
    guildId: string;
    redirectPath: string;
    createdAt: number;
    nonce: string;
}

const MAX_AGE_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;

export function safeOAuthRedirectPath(input: unknown): string {
    if (typeof input !== 'string' || input.length > 512 || !input.startsWith('/') ||
        input.startsWith('//') || /[\\\\\r\n\0]/.test(input)) return '/';
    try {
        const decoded = decodeURIComponent(input);
        if (decoded.startsWith('//') || decoded.includes('\\')) return '/';
    } catch {
        return '/';
    }
    return input;
}

function sign(data: string, secret: string): Buffer {
    return crypto.createHmac('sha256', secret).update('pexbot-discord-oauth-state-v1:')
        .update(data).digest();
}

export function createDiscordOAuthState(
    secret: string,
    guildId: string,
    redirectPath: string,
    now = Date.now(),
): { state: string; nonce: string } {
    if (!secret) throw new Error('Discord OAuth signing secret is not configured');
    const nonce = crypto.randomBytes(18).toString('base64url');
    const payload: DiscordOAuthState = {
        guildId: guildId.slice(0, 80),
        redirectPath: safeOAuthRedirectPath(redirectPath),
        createdAt: now,
        nonce,
    };
    const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { state: text + '.' + sign(text, secret).toString('base64url'), nonce };
}

export function verifyDiscordOAuthState(
    secret: string, state: unknown, now = Date.now(),
): { status: 'valid'; value: DiscordOAuthState }
    | { status: 'expired' | 'invalid' } {
    if (!secret || typeof state !== 'string' || state.length > 1500) return { status: 'invalid' };
    const parts = state.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
        !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return { status: 'invalid' };
    const supplied = Buffer.from(parts[1], 'base64url');
    const expected = sign(parts[0], secret);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        return { status: 'invalid' };
    }
    try {
        const decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as DiscordOAuthState;
        if (!decoded || typeof decoded.guildId !== 'string' ||
            typeof decoded.redirectPath !== 'string' ||
            typeof decoded.nonce !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(decoded.nonce) ||
            !Number.isSafeInteger(decoded.createdAt) || decoded.createdAt > now + MAX_FUTURE_SKEW_MS) {
            return { status: 'invalid' };
        }
        if (safeOAuthRedirectPath(decoded.redirectPath) !== decoded.redirectPath) return { status: 'invalid' };
        if (now - decoded.createdAt > MAX_AGE_MS) return { status: 'expired' };
        return { status: 'valid', value: decoded };
    } catch {
        return { status: 'invalid' };
    }
}

export function appendPendingOAuthNonce(previous: unknown, nonce: string): string {
    const old = typeof previous === 'string' ? previous.split('.') : [];
    return [...old.filter(n => /^[A-Za-z0-9_-]{24}$/.test(n) && n !== nonce).slice(-4), nonce].join('.');
}

export function consumePendingOAuthNonce(previous: unknown, nonce: string) {
    const prior = typeof previous === 'string' ? previous.split('.') : [];
    return {
        found: prior.includes(nonce),
        remaining: prior.filter(n => n !== nonce && /^[A-Za-z0-9_-]{24}$/.test(n)).join('.'),
    };
}

export const OAUTH_STATE_MAX_AGE_MS = MAX_AGE_MS;
