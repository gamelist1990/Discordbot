export function jevResponse(verdict: Record<string, any> = {}) {
    const categories = ['suggestive', 'explicit', 'harassment', 'hate', 'threat', 'violence'];
    const answers: Record<string, any> = {};
    for (const category of categories) {
        const value = verdict[category] ?? 0;
        answers[category] = { type: 'noul', noul: value > 0 ? 1 : 0 };
        answers[category + '_strength'] = { type: 'score', score: value * 3 };
    }
    const result = { model: 'jeff-base', answers, usage: { input_tokens: 128, output_tokens: 0 } };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 128, completion_tokens: 0, total_tokens: 128 } }));
}
