/** Tool handlers often report failures as tagged strings instead of throwing. */
export function toolResultError(result: unknown): string | undefined {
    if (result && typeof result === 'object' && !Array.isArray(result) && 'error' in result && result.error) {
        const error = result.error;
        return (typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error)).slice(0, 500);
    }
    if (typeof result !== 'string') return undefined;
    const text = result.trim();
    return /^(?:[A-Z][A-Z_]*_(?:ERROR|BLOCKED|DENIED|UNSUPPORTED)\b|SEARCH_UNAVAILABLE\b|Error:)/.test(text) ? text.slice(0, 500) : undefined;
}

/** Only metadata needed by the progress UI; never forward memory/file contents. */
export function toolStepArguments(name: string, raw: string): string | undefined {
    const keys = name === 'output_file' ? ['filename']
        : name === 'manage_memory' ? ['action', 'store', 'type']
        : name === 'manage_schedule' ? ['action', 'mode', 'channel_id']
        : name === 'web_search' || name === 'search_channel_messages' ? ['query']
        : name === 'fetch_url' ? ['url']
        : name === 'get_weather' ? ['prefecture']
        : name === 'count_phrase_in_channel' ? ['phrase'] : [];
    if (!keys.length) return undefined;
    try {
        const args = JSON.parse(raw || '{}');
        if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
        return JSON.stringify(Object.fromEntries(keys.filter(key => typeof args[key] === 'string')
            .map(key => [key, args[key].slice(0, 200)])));
    } catch { return undefined; }
}
