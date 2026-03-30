import { ChatGPTClient } from '../ChatGPTClient.js';
import { CORE_FEATURE_MODEL_FALLBACKS } from './constants.js';
import { extractJsonObject, pickAiPersonaName } from './helpers.js';

export async function requestCoreFeatureModelText(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    maxTokens: number,
    temperature: number
): Promise<string> {
    const client = new ChatGPTClient();
    const response = await client.sendMessage(messages, {
        model: [...CORE_FEATURE_MODEL_FALLBACKS],
        maxTokens,
        temperature
    });

    const content = response.choices[0]?.message?.content;
    return typeof content === 'string' ? content : '';
}

function sanitizePersonaName(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value
        .normalize('NFKC')
        .trim()
        .replace(/[^\p{Script=Hiragana}\p{Script=Katakana}ー]/gu, '');

    if (normalized.length < 2 || normalized.length > 8) {
        return null;
    }

    return normalized;
}

export async function requestCoreFeaturePersonaNames(
    context: string,
    count: number,
    usedNames: string[] = []
): Promise<string[]> {
    const requestedCount = Math.max(1, Math.min(count, 3));
    const normalizedUsed = usedNames.map((entry) => entry.trim()).filter(Boolean);

    const systemPrompt = [
        'あなたは Discord コミュニティ機能で振る舞う AI です。',
        'これから自分で名乗るための短い日本語名を、自分の意思で決めてください。',
        `必要な名前の数は ${requestedCount} 個です。`,
        '2文字から8文字までの、ひらがなまたはカタカナだけの人名風の名前にしてください。',
        '記号、数字、英字、役職語、説明文は禁止です。',
        '出力は JSON のみで、キーは names にしてください。'
    ].join('\n');

    const userPrompt = [
        `文脈: ${context}`,
        `避ける名前: ${normalizedUsed.length > 0 ? normalizedUsed.join(', ') : 'なし'}`,
        'AI がその場で自分の呼び名を決める前提で、自然で呼びやすい名前を返してください。'
    ].join('\n');

    try {
        const raw = await requestCoreFeatureModelText([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 220, 0.9);

        const parsed = extractJsonObject<{ names?: unknown; name?: unknown }>(raw);
        const candidates = Array.isArray(parsed?.names)
            ? parsed?.names
            : parsed && 'name' in parsed
                ? [parsed.name]
                : raw.split(/[\s,、\n]+/g);

        const picked: string[] = [];
        for (const candidate of candidates) {
            const sanitized = sanitizePersonaName(candidate);
            if (!sanitized || normalizedUsed.includes(sanitized) || picked.includes(sanitized)) {
                continue;
            }

            picked.push(sanitized);
            if (picked.length >= requestedCount) {
                return picked;
            }
        }
    } catch {
        // Fallback handled below.
    }

    const fallbackNames: string[] = [];
    for (let index = 0; index < requestedCount; index += 1) {
        const fallback = pickAiPersonaName(context, index, [...normalizedUsed, ...fallbackNames]);
        fallbackNames.push(fallback);
    }

    return fallbackNames;
}
