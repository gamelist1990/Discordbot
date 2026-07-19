import dns from 'dns/promises';
import net from 'net';

export async function assertSafeHttpUrl(urlText: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    let url: URL;
    try {
        url = new URL(urlText);
    } catch {
        return { ok: false, reason: 'URLとして解析できません。' };
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, reason: 'HTTP/HTTPS以外は許可されていません。' };
    }

    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') {
        return { ok: false, reason: 'ローカルホストへのアクセスは禁止です。' };
    }

    if (isPrivateOrLocalAddress(host)) {
        return { ok: false, reason: 'プライベートIP/ローカルIPへのアクセスは禁止です。' };
    }

    try {
        const resolved = await dns.lookup(host, { all: true, verbatim: false });
        if (resolved.some(entry => isPrivateOrLocalAddress(entry.address))) {
            return { ok: false, reason: 'DNS解決先がプライベートIP/ローカルIPです。' };
        }
    } catch {
        return { ok: false, reason: 'DNS解決に失敗しました。' };
    }

    return { ok: true };
}

function isPrivateOrLocalAddress(value: string): boolean {
    const ipVersion = net.isIP(value);
    if (ipVersion === 0) return false;
    if (ipVersion === 6) {
        const normalized = value.toLowerCase();
        return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
    }

    const parts = value.split('.').map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return true;
    const [a, b] = parts;
    return a === 10
        || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || a === 0;
}
