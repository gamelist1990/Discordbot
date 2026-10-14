/** Add absent fields only; retain explicit values, arrays and unknown settings. */
export function fillMissingConfig(
    current: Record<string, unknown>,
    defaults: Record<string, unknown>,
): { value: Record<string, unknown>; added: string[] } {
    const value = { ...current };
    const added: string[] = [];
    for (const [key, fallback] of Object.entries(defaults)) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) {
            value[key] = structuredClone(fallback);
            added.push(key);
        } else if (isObject(current[key]) && isObject(fallback)) {
            const nested = fillMissingConfig(current[key], fallback);
            value[key] = nested.value;
            added.push(...nested.added.map(field => `${key}.${field}`));
        }
    }
    return { value, added };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
