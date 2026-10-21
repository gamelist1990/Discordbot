/** Reads may overlap; mutations and unknown tools are ordered barriers. */
const READ_TOOLS = new Set([
    'web_search', 'fetch_url', 'get_weather', 'get_time', 'get_server_status',
    'get_user_details', 'get_anticheat_user_profile', 'count_phrase_in_channel',
    'collect_channel_history', 'fetch_message_link_context', 'search_channel_messages',
    'fetch_discord_message', 'calculate_bash',
]);

export function isReadOnlyTool(name: string, argumentsJson: string): boolean {
    if (READ_TOOLS.has(name)) return true;
    if (name !== 'manage_memory' && name !== 'manage_schedule') return false;
    try {
        const args = JSON.parse(argumentsJson);
        return name === 'manage_schedule' ? args?.action === 'list'
            : ['recall', 'list', 'search', 'get'].includes(args?.action);
    } catch { return false; }
}

export async function executeToolBatch<T, R>(calls: T[], name: (call: T) => string,
    argumentsJson: (call: T) => string, execute: (call: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(calls.length);
    let index = 0;
    while (index < calls.length) {
        if (!isReadOnlyTool(name(calls[index]), argumentsJson(calls[index]))) {
            results[index] = await execute(calls[index]);
            index++;
            continue;
        }
        const start = index;
        while (index < calls.length && isReadOnlyTool(name(calls[index]), argumentsJson(calls[index]))) index++;
        const end = index;
        let next = start;
        let failed = false;
        let failure: unknown;
        // Wait for in-flight reads before propagating a fatal abort; never start a later mutation.
        await Promise.all(Array.from({length: Math.min(3, end - start)}, async () => {
            while (!failed && next < end) {
                const current = next++;
                try { results[current] = await execute(calls[current]); }
                catch (error) { if (!failed) failure = error; failed = true; }
            }
        }));
        if (failed) throw failure;
    }
    return results;
}
