import { ChatGPTClient } from '../ChatGPTClient.js';
import { CORE_FEATURE_MODEL_FALLBACKS } from './constants.js';
import { clamp, extractJsonObject, pickAiPersonaName } from './helpers.js';

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

function looksLikeQuestion(value: string): boolean {
    return /[？?]$/.test(value) || /(教えてください|聞かせてください|説明してください|ありますか|どんな|どう)/.test(value);
}

export async function requestCoreFeatureNaturalFollowUp(
    latestUserAnswer: string,
    transcriptSummary: string,
    provisionalReason: string,
    provisionalTraits: string[]
): Promise<string> {
    const userPrompt = [
        `直前のユーザー回答: ${latestUserAnswer || 'なし'}`,
        `現時点の仮説メモ: ${provisionalReason || 'まだ仮説は弱い'}`,
        `現時点の傾向タグ: ${provisionalTraits.length > 0 ? provisionalTraits.join(', ') : '未確定'}`,
        `ここまでの面談ログ:\n${transcriptSummary}`
    ].join('\n');
    const systemPrompts = [
        [
            'あなたは Discord 上で1対1面談を行う AI です。',
            '実際の面接官のように、相手の会話内容から次に聞くべきことを自分で判断してください。',
            '相手の直前の発言とこれまでのログを受けて、自然な日本語で次の質問を1つだけ返してください。',
            '1〜2文まで。長い前置きは禁止です。',
            '相手の発言を長く引用しないでください。',
            '「今の話だと〜という点が印象に残りました」のような定型句は禁止です。',
            '自然な相づちや短い受け止めはOKですが、その後は会話がつながる質問を1つだけしてください。',
            '決め打ちの質問表を順番に消化するのではなく、この会話でまだ見えていない判断材料を取りにいってください。'
        ].join('\n'),
        [
            'あなたは Discord 上で1対1面談を行う AI です。',
            '次の質問を自然な日本語で1つだけ返してください。',
            '最後は必ず質問文で終えてください。',
            '抽象的な聞き返しや長い引用は禁止です。',
            '定型句は禁止です。短くてもいいので、この会話に食い込んだ具体的な質問にしてください。'
        ].join('\n')
    ];

    for (const systemPrompt of systemPrompts) {
        try {
            const raw = await requestCoreFeatureModelText([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ], 220, 0.6);

            const cleaned = raw
                .trim()
                .replace(/^```(?:text)?/i, '')
                .replace(/```$/i, '')
                .trim()
                .replace(/^["'「]+/, '')
                .replace(/["'」]+$/, '')
                .trim();

            if (cleaned && looksLikeQuestion(cleaned) && !/印象に残りました/.test(cleaned)) {
                return cleaned;
            }
        } catch {
            continue;
        }
    }

    return 'その場面の流れが分かるように、具体例を一つ教えてください。';
}

export async function requestCoreFeatureConfidenceCalibration(
    personalityLabel: string,
    reason: string,
    traits: string[],
    userTurns: number,
    transcriptSummary: string,
    heuristicConfidence: number
): Promise<number | null> {
    const systemPrompt = [
        'あなたは面談ログから分類の確信度だけを校正する AI です。',
        '0 から 100 の整数で confidence を返してください。',
        '回答数が少ない、抽象的、具体例が乏しい、矛盾がある場合は低くしてください。',
        '4〜6ターンの具体的な面談で、分類理由と傾向タグが噛み合っている場合のみ高めにしてください。',
        '出力は JSON のみで、キーは confidence です。'
    ].join('\n');

    const userPrompt = [
        `分類ラベル: ${personalityLabel}`,
        `判定理由: ${reason || 'なし'}`,
        `傾向タグ: ${traits.length > 0 ? traits.join(', ') : 'なし'}`,
        `ユーザー回答数: ${userTurns}`,
        `ヒューリスティック信頼度: ${heuristicConfidence}`,
        `面談ログ要約:\n${transcriptSummary}`
    ].join('\n\n');

    try {
        const raw = await requestCoreFeatureModelText([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 150, 0.1);

        const parsed = extractJsonObject<{ confidence?: unknown }>(raw);
        return typeof parsed?.confidence === 'number'
            ? clamp(Math.round(parsed.confidence), 0, 100)
            : null;
    } catch {
        return null;
    }
}
