// Assemble chat-completion SSE without exposing model reasoning or post content in logs.
export async function readContentStream(response: Response, progress: (chunks: number) => void): Promise<any> {
    // Some compatible proxies ignore stream=true and return a complete JSON response.
    if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json();
    if (!response.body) throw new Error('Incomplete moderation stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const calls = new Map<number, any>();
    let pending = '', eventData: string[] = [], finish: string | null = null;
    let done = false, bytes = 0, chunks = 0;
    const event = () => {
        if (!eventData.length) return;
        const payload = eventData.join('\n');
        eventData = [];
        if (payload.trim() === '[DONE]') { done = true; return; }
        const data = JSON.parse(payload);
        if (data.error) throw new Error('Moderation stream error');
        chunks++;
        if (chunks === 1 || chunks % 100 === 0) progress(chunks);
        const choice = data.choices?.find((item: any) => item.index === 0);
        if (!choice) return;
        if (choice.finish_reason != null) finish = choice.finish_reason;
        for (const delta of choice.delta?.tool_calls ?? []) {
            if (!Number.isInteger(delta.index) || delta.index < 0 || delta.index > 15) throw new Error('Invalid moderation stream');
            const call = calls.get(delta.index) ?? { type: '', function: { name: '', arguments: '' } };
            if (delta.type !== undefined) call.type = delta.type;
            for (const key of ['name', 'arguments']) {
                const value = delta.function?.[key];
                if (value !== undefined) {
                    if (typeof value !== 'string') throw new Error('Invalid moderation stream');
                    call.function[key] += value;
                }
            }
            calls.set(delta.index, call);
        }
    };
    const line = (value: string) => {
        if (value === '') event();
        else if (value.startsWith('data:')) eventData.push(value.slice(5).replace(/^ /, ''));
    };
    try {
        while (!done) {
            const result = await reader.read();
            bytes += result.value?.byteLength ?? 0;
            if (bytes > 1024 * 1024) throw new Error('Moderation stream too large');
            pending += decoder.decode(result.value, { stream: !result.done });
            let newline: number;
            while (!done && (newline = pending.indexOf('\n')) >= 0) {
                line(pending.slice(0, newline).replace(/\r$/, ''));
                pending = pending.slice(newline + 1);
            }
            if (result.done) {
                if (!done) { line(pending.replace(/\r$/, '')); event(); }
                break;
            }
        }
        if (!done || !finish) throw new Error('Incomplete moderation stream');
        return { choices: [{ finish_reason: finish, message: { tool_calls: [...calls.entries()]
            .sort(([a], [b]) => a - b).map(([, call]) => call) } }] };
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
