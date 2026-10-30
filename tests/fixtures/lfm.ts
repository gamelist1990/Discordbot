/** Chat-completion response shaped like the LFM3 moderation reply. */
export function lfmResponse(verdict: Record<string, any> = {}) {
    const categories = ['suggestive', 'explicit', 'harassment', 'hate', 'threat', 'violence'];
    const result: Record<string, any> = Object.fromEntries(categories.map(category => [category, verdict[category] ?? 0]));
    result.explanation = verdict.explanation ?? '判定結果';
    result.customRuleViolations = verdict.customRuleViolations ?? [];
    return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 128, completion_tokens: 40, total_tokens: 168 },
    }));
}
