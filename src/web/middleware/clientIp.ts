import type { Request } from 'express';
import net from 'node:net';
import { isPrivateOrLocalIp } from '../../core/webauth/ipIntel.js';
import { normalizeIpForHash } from '../../core/webauth/fingerprint.js';

export interface ClientIpInput {
    socketAddress?: string | null;
    forwardedFor?: string | string[] | undefined;
    realIp?: string | string[] | undefined;
}

export interface ResolvedClientIp {
    /** Direct TCP peer (the reverse proxy in production). */
    socketIp: string;
    /** Apparent client address used for intel and hashing. */
    clientIp: string;
    trustedProxy: boolean;
    source: 'socket' | 'x-forwarded-for' | 'x-real-ip';
    chain: string[];
}

function headerValues(value: string | string[] | undefined): string[] {
    if (!value) return [];
    const raw = Array.isArray(value) ? value.join(',') : value;
    return raw.split(',').map((entry) => normalizeCandidate(entry)).filter(Boolean);
}

function normalizeCandidate(value: unknown): string {
    let text = String(value ?? '').trim();
    if (!text) return '';
    // `1.2.3.4:5678` (some proxies append a port) and `[::1]:443` brackets.
    if (text.startsWith('[')) {
        const end = text.indexOf(']');
        if (end > 0) text = text.slice(1, end);
    } else if (text.split(':').length === 2 && net.isIP(text.split(':')[0]) === 4) {
        text = text.split(':')[0];
    }
    const normalized = normalizeIpForHash(text);
    return net.isIP(normalized) ? normalized : '';
}

const isTrustedHop = (ip: string): boolean => isPrivateOrLocalIp(ip);

/**
 * Resolves the real client IP behind the bot's reverse proxy.
 *
 * The proxy hop is trusted only when the direct socket peer is loopback or a
 * private address (production: nginx on 10.0.0.97 -> bot on 10.0.0.225).
 * X-Forwarded-For is walked right-to-left and the first public hop is taken,
 * so a client-supplied prefix cannot override the proxy's own entry. Both the
 * socket address and the apparent client IP are returned; the apparent client
 * IP is used for intel and hashing.
 */
export function resolveClientIp(input: ClientIpInput): ResolvedClientIp {
    const socketIp = normalizeCandidate(input.socketAddress);
    const forwarded = headerValues(input.forwardedFor);
    const realIp = headerValues(input.realIp);
    const trustedProxy = !!socketIp && isTrustedHop(socketIp);
    if (!trustedProxy) {
        return { socketIp, clientIp: socketIp, trustedProxy: false, source: 'socket', chain: [] };
    }

    if (forwarded.length) {
        for (let index = forwarded.length - 1; index >= 0; index -= 1) {
            if (!isTrustedHop(forwarded[index])) {
                return {
                    socketIp,
                    clientIp: forwarded[index],
                    trustedProxy: true,
                    source: 'x-forwarded-for',
                    chain: forwarded
                };
            }
        }
        return {
            socketIp,
            clientIp: forwarded[0],
            trustedProxy: true,
            source: 'x-forwarded-for',
            chain: forwarded
        };
    }

    if (realIp.length) {
        return {
            socketIp,
            clientIp: realIp[realIp.length - 1],
            trustedProxy: true,
            source: 'x-real-ip',
            chain: realIp
        };
    }

    return { socketIp, clientIp: socketIp, trustedProxy: true, source: 'socket', chain: [] };
}

export function requestClientIp(req: Request): ResolvedClientIp {
    return resolveClientIp({
        socketAddress: req.socket?.remoteAddress,
        forwardedFor: req.headers?.['x-forwarded-for'] as string | string[] | undefined,
        realIp: req.headers?.['x-real-ip'] as string | string[] | undefined
    });
}
