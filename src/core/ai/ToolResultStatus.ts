/** Tool handlers often report failures as tagged strings instead of throwing. */
export function toolResultError(result: unknown): string | undefined {
    if (typeof result !== 'string') return undefined;
    const text = result.trim();
    return /^(?:[A-Z][A-Z_]*_ERROR\b|SEARCH_UNAVAILABLE\b|Error:)/.test(text) ? text.slice(0, 500) : undefined;
}
