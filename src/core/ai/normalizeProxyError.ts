// Some compatible gateways return {message/detail: ...} instead of {error: {message: ...}}.
// Keep the HTTP status: this only restores diagnostics, never bypasses a denial.
export async function normalizeProxyError(response: Response, apiKey: string): Promise<Response> {
    if (response.ok) return response;
    const size = Number(response.headers.get('content-length'));
    if (!Number.isFinite(size) || size > 16384) return response;
    let data: any;
    let raw = '';
    const reader = response.clone().body?.getReader();
    if (!reader) return response;
    try {
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.length;
            if (bytes > 16384) { void reader.cancel().catch(() => {}); return response; }
            chunks.push(chunk.value);
        }
        raw = Buffer.concat(chunks).toString('utf8');
    } catch { return response; }
    try { data = JSON.parse(raw); } catch { data = null; }
    if (typeof data?.error?.message === 'string' && data.error.message) return response;
    const detail = typeof data?.error === 'string' ? data.error
        : typeof data?.message === 'string' ? data.message
        : typeof data?.detail === 'string' ? data.detail
        : typeof data?.detail?.message === 'string' ? data.detail.message
        : typeof data?.error?.description === 'string' ? data.error.description
        : typeof data?.error_description === 'string' ? data.error_description
        : data !== null ? JSON.stringify(data, (key, value) =>
            /^(authorization|api[_-]?key|token|access_token|refresh_token|password|secret|input|messages|prompt|body|content)$/i.test(key) ? '[redacted]' : value)
        : raw;
    if (!detail?.trim()) return response;
    let message = apiKey ? detail.split(apiKey).join('[redacted]') : detail;
    message = message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/https?:\/\/\S+/gi, '[URL]').replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 500);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('transfer-encoding');
    return new Response(JSON.stringify({ error: { message: `[proxy-error-body] ${message}` } }), {
        status: response.status, statusText: response.statusText, headers,
    });
}
