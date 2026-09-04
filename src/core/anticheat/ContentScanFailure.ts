// Do not copy arbitrary decoder/API messages: they can contain post text or signed URLs.
export function contentFailureReason(error: unknown): string {
    const value = error as { message?: string; name?: string; code?: string; cause?: { code?: string } } | null;
    const message = typeof value?.message === 'string' ? value.message : '';
    if (/^(?:Media|Moderation API) HTTP \d{3}$/.test(message)) return message;
    const known = ['Media too large', 'Unsupported media URL', 'Non-public media host', 'No preview image',
        'Unsupported image', 'Animation decode budget exceeded', 'Input buffer contains unsupported image format',
        'Input image exceeds pixel limit', 'Moderation batch deadline exceeded', 'Truncated moderation response',
        'Moderation API did not return required submit_verdict tool call', 'Invalid moderation verdict', 'Invalid moderation explanation'];
    if (known.includes(message)) return message;
    if (value?.name === 'SyntaxError') return 'Invalid JSON response';
    if (value?.name === 'TimeoutError' || value?.name === 'AbortError') return value.name;
    const code = value?.code ?? value?.cause?.code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
    return 'Unrecognized processing error';
}
