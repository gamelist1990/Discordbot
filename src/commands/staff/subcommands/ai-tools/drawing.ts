import { createHash } from 'node:crypto';
import { AttachmentBuilder, type ChatInputCommandInteraction, type Message } from 'discord.js';
import sharp from 'sharp';
import { config } from '../../../../config.js';
import { recordAIUsage } from '../../../../core/ai/AIUsageMetrics.js';
import type { OpenAITool, ToolHandler } from '../../../../types/openai.js';

/**
 * お絵描きツール（draw_image）: モデルが書いた SVG をサーバー側で PNG に描画して
 * Discord へ投稿し、描画結果を視覚モデルに見せて欠陥チェック（視覚フィードバック）を返す。
 *
 * 設計の根拠（Render-in-the-Loop, arXiv:2604.20730 等）:
 * - 視覚フィードバックは無条件に効くわけではなく、未訓練モデルでは悪化もあり得る。
 *   そのため (1) レビューは構造化チェックリストで具体的な欠陥だけを返し、
 *   (2) レビュー付きの再描画は最大3回まで、(3) 同一SVGの再提交は「変化なし」として弾く。
 * - 文字はパスで描かせず <text> 要素で書かせる（綴りが構造的に保証される）。
 * - diffvg のような勾配ベース最適化は目標画像が無い生成用途では使えないため採用しない。
 */

const MAX_SVG_BYTES = 96 * 1024;
const MAX_CANVAS = 2048;
const MAX_REVIEW_ROUNDS = 3;
const POST_MAX_WIDTH = 1600;
const REVIEW_MAX_WIDTH = 1024;

export const drawImageToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'draw_image',
        description: [
            'SVGでイラスト・ロゴ・タイトルロゴなどを描き、PNG画像としてDiscordに投稿します。投稿後に「描画レビュー」（画像を視覚モデルがチェックした結果）が返ります。',
            '使えるのは SVG の基本要素だけです: rect / circle / ellipse / path（C・Q のベジェ曲線、A の円弧） / line / polyline / polygon / text / linearGradient / radialGradient / g（transform の移動・回転・拡大）。外部画像・スクリプト・外部参照は使えません。',
            'ルール: (1) ルートの <svg> に viewBox を必ず付ける（例 viewBox="0 0 800 600"）。(2) 文字は必ず <text> 要素で書く（字形をパスで描かない）。フォントは font-family="sans-serif" を基本にし、太さは font-weight、大きさは font-size で指定する。日本語もそのまま書けます。(3) 色は fill / stroke に具体的な色（#RRGGBB 等）で指定する。(4) 重要な要素はキャンバスの端ギリギリに置かず、少し内側に収める。',
            '投稿は同じ filename で再呼び出しすると、その場で新しい描画に差し替わります。レビューで欠陥が指摘されたら、SVG を直して同じ filename でもう一度呼んでください（レビューは最大3回まで付きます）。問題がなければ完了として案内してください。',
            '描き方のコツ: 生き物や物のシルエットは、部分ごとに単純な図形へ分解して組み合わせると、それらしく見えます（例: 猫なら 頭=円、耳=三角形、胴=楕円、しっぽ=太めの曲線パス、座り姿勢は底辺を平らに）。抽象的な曲線や丸だけを並べると、何を描いたか分からなくなります。',
            'intent には「何を描くか（題材・入れる文字・雰囲気）」を短く正確に書いてください。レビューの照合に使われます。',
        ].join('\n'),
        parameters: {
            type: 'object',
            properties: {
                svg: { type: 'string', description: '完成した SVG 文書全体（<svg …>…</svg>）。コードフェンスや説明を含めない。' },
                filename: { type: 'string', description: '投稿する PNG のファイル名（英数字と . _ - のみ、末尾は .png）。例: title-logo.png' },
                intent: { type: 'string', description: '何を描くか: 題材、入れる文字、色や雰囲気の指定を短く。レビューの照合に使います。' },
            },
            required: ['svg', 'filename', 'intent'],
            additionalProperties: false,
        },
    },
};

const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
    [/<script[\s>]/i, '<script> は使えません'],
    [/<foreignObject[\s>]/i, '<foreignObject> は使えません'],
    [/<(iframe|embed|object|link|audio|video)[\s>]/i, '外部コンテンツを埋め込む要素は使えません'],
    [/<image[\s>]/i, '<image> による画像の埋め込みは使えません（図形とテキストだけで描いてください）'],
    [/<!DOCTYPE|<!ENTITY/i, 'DOCTYPE / ENTITY は使えません'],
    [/\son[a-z]+\s*=/i, 'イベントハンドラ属性（on*）は使えません'],
    [/javascript\s*:/i, 'javascript: URL は使えません'],
    [/(href|xlink:href)\s*=\s*["']https?:/i, '外部参照（http の href）は使えません'],
    [/url\(\s*["']?https?:/i, '外部参照（http の url()）は使えません'],
    [/@import/i, '@import は使えません'],
];

/** モデルの SVG を検証する。通過すれば描画可能な SVG 文字列、駄目なら理由を返す。 */
export function sanitizeSvg(input: unknown): { svg: string } | { error: string } {
    if (typeof input !== 'string') return { error: 'svg には SVG 文書の文字列を指定してください。' };
    const svg = input.trim().replace(/^<\?xml[^>]*\?>\s*/i, '');
    if (Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES) return { error: `SVG が大きすぎます（上限 ${MAX_SVG_BYTES / 1024}KiB）。要素を減らして簡潔にしてください。` };
    for (const [pattern, message] of FORBIDDEN_PATTERNS) {
        if (pattern.test(svg)) return { error: message + '。SVG の基本図形とテキストだけで描いてください。' };
    }
    if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return { error: 'SVG 文書全体（<svg …>…</svg>）を指定してください。' };
    const rootTag = /^<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
    const viewBox = /viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(rootTag);
    const widthAttr = /\bwidth\s*=\s*["'](\d+(?:\.\d+)?)["']/i.exec(rootTag);
    const heightAttr = /\bheight\s*=\s*["'](\d+(?:\.\d+)?)["']/i.exec(rootTag);
    const w = viewBox ? Number(viewBox[1]) : widthAttr ? Number(widthAttr[1]) : 0;
    const h = viewBox ? Number(viewBox[2]) : heightAttr ? Number(heightAttr[1]) : 0;
    if (!(w > 0) || !(h > 0)) return { error: 'キャンバスサイズが分かりません。<svg> に viewBox="0 0 800 600" のような viewBox を指定してください。' };
    if (w > MAX_CANVAS || h > MAX_CANVAS) return { error: `キャンバスが大きすぎます（各辺 ${MAX_CANVAS} まで）。viewBox を小さくしてください。` };
    return { svg };
}

function decodeEntities(text: string): string {
    return text
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

/** SVG 内の <text> の文字列を抽出する（レビューの綴り照合用）。 */
export function extractSvgTexts(svg: string): string[] {
    const texts: string[] = [];
    for (const match of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)) {
        const plain = decodeEntities(match[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        if (plain) texts.push(plain);
    }
    return texts;
}

/** 描画レビューのプロンプト（構造化チェックリスト。具体的な欠陥だけを返させる）。 */
export function buildReviewPrompt(intent: string, texts: string[]): string {
    return [
        `あなたは SVG イラストの描画レビュアーです。添付画像は、AI が次の意図で描いた SVG を描画したものです。`,
        `意図: ${intent}`,
        `SVG に入っている文字: ${texts.length ? texts.map(t => `「${t}」`).join('、') : '（文字なし）'}`,
        '次の観点で、具体的な欠陥だけを短く列挙してください。問題が無ければ「問題なし」とだけ答えてください。感想や褒め言葉は不要です。',
        '0. まず文字を読まずに画像だけを見て、題材が何に見えるか判断してください。意図の題材に見えない・何だか分からない場合は、それ自体を最重要の欠陥として最初に指摘してください',
        '1. 意図した題材・要素が描かれていて、それと分かるか（無い要素・別物になっている要素はないか）',
        '2. 文字: 上記の文字列が正確な綴りで読めるか。はみ出し・見切れ・図形との重なり・背景とのコントラスト不足はないか',
        '3. 要素同士の意図しない重なり、キャンバス端からのはみ出し・見切れはないか',
        '4. 大きな空白や著しい偏りなど、構図の明らかな崩れはないか',
        '5. 意図と違う色や、不自然な色の組み合わせはないか',
        '指摘は「どの要素が・どうなっているか・どう直すか（例: タイトルを少し左へ、など相対的な直し方）」の形で、1件1行、最大5件まで。',
    ].join('\n');
}

/** SVG を PNG に描画する。targetWidth に近い解像度で描き、大きければ縮小する。 */
export async function renderSvgToPng(svg: string): Promise<{ png: Buffer; width: number; height: number }> {
    const viewBox = /viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(svg);
    const baseWidth = viewBox ? Number(viewBox[1]) : 800;
    const scale = Math.min(4, Math.max(0.5, 1024 / Math.max(1, baseWidth)));
    let pipeline = sharp(Buffer.from(svg, 'utf8'), { density: Math.round(72 * scale) });
    const meta = await pipeline.metadata();
    let png = await pipeline.png().toBuffer();
    let width = meta.width ?? 0;
    let height = meta.height ?? 0;
    if (width > POST_MAX_WIDTH) {
        png = await sharp(png).resize({ width: POST_MAX_WIDTH }).png().toBuffer();
        const resized = await sharp(png).metadata();
        width = resized.width ?? POST_MAX_WIDTH;
        height = resized.height ?? height;
    }
    return { png, width, height };
}

/** 描画がほぼ空白（何も描けていない）かどうかを alpha の有無で判定する。 */
export async function isBlankRender(png: Buffer): Promise<boolean> {
    const stats = await sharp(png).stats();
    const alpha = stats.channels[3];
    return alpha ? alpha.max === 0 : false;
}

/** 描画結果を視覚モデルに見せて欠陥チェックを受ける。失敗時はその旨の文字列を返す。 */
async function reviewRender(png: Buffer, intent: string, texts: string[], guildId?: string): Promise<string> {
    try {
        const reviewPng = await sharp(png).resize({ width: REVIEW_MAX_WIDTH, withoutEnlargement: true }).png().toBuffer();
        const response = await fetch(`${config.pexAi.endpoint.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(config.pexAi.apiKey ? { authorization: `Bearer ${config.pexAi.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: config.pexAi.visionModel || config.pexAi.model,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: buildReviewPrompt(intent, texts) },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${reviewPng.toString('base64')}`, detail: 'auto' } },
                    ],
                }],
                temperature: 0.2,
                max_tokens: 1200,
                chat_template_kwargs: { enable_thinking: true },
            }),
        });
        if (!response.ok) return `（描画レビューを取得できませんでした: HTTP ${response.status}）`;
        const data = await response.json() as any;
        void recordAIUsage({
            purpose: 'vision', model: config.pexAi.visionModel || config.pexAi.model, guildId,
            inputTokens: data?.usage?.prompt_tokens, outputTokens: data?.usage?.completion_tokens,
            cachedTokens: data?.usage?.prompt_tokens_details?.cached_tokens ?? null,
        }).catch(() => undefined);
        const text = data?.choices?.[0]?.message?.content;
        return typeof text === 'string' && text.trim() ? text.trim().slice(0, 1500) : '（描画レビューの応答が空でした）';
    } catch (error) {
        return `（描画レビューを取得できませんでした: ${error instanceof Error ? error.message : 'unknown'}）`;
    }
}

interface DrawState { hash: string; message: Message | null; renders: number; uncertain: boolean }
const drawStates = new WeakMap<object, Map<string, DrawState>>();

export const drawImageToolHandler: ToolHandler = async (args, context) => {
    const filename = typeof args?.filename === 'string' ? args.filename.trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/i.test(filename) || filename.includes('..')) {
        return 'DRAW_ERROR: filename は英数字・. _ - のみの .png ファイル名にしてください（例: title-logo.png）。';
    }
    const intent = typeof args?.intent === 'string' ? args.intent.trim().slice(0, 300) : '';
    if (!intent) return 'DRAW_ERROR: intent（何を描くか）を指定してください。';
    const checked = sanitizeSvg(args?.svg);
    if ('error' in checked) return `DRAW_ERROR: ${checked.error}`;
    const interaction = context as ChatInputCommandInteraction | undefined;
    if (!interaction?.guildId || !interaction.channelId || !interaction.followUp) {
        return 'DRAW_ERROR: Discordの/staff ai応答先が確認できません。';
    }
    let perInteraction = drawStates.get(interaction);
    if (!perInteraction) { perInteraction = new Map(); drawStates.set(interaction, perInteraction); }
    const state: DrawState = perInteraction.get(filename) ?? { hash: '', message: null, renders: 0, uncertain: false };
    perInteraction.set(filename, state);
    const hash = createHash('sha256').update(checked.svg).digest('hex');
    if (state.hash === hash) {
        return 'DRAW_ERROR: 前回と同一の SVG です（描画は変化しません）。レビューの指摘に沿って内容を変更してから再描画してください。';
    }
    if (!state.message && state.uncertain) {
        return 'DRAW_ERROR: 先の投稿状態が不明なため、同名ファイルの自動再投稿はしません。Discord上の投稿状態を確認してください。';
    }
    let rendered: { png: Buffer; width: number; height: number };
    try {
        rendered = await renderSvgToPng(checked.svg);
    } catch (error) {
        return `DRAW_ERROR: SVG の描画に失敗しました: ${error instanceof Error ? error.message.slice(0, 160) : 'unknown'}。SVG の文法（タグの閉じ忘れ等）を確認してください。`;
    }
    if (await isBlankRender(rendered.png).catch(() => false)) {
        return 'DRAW_ERROR: 描画結果が空白でした（何も描けていません）。図形の座標・色（fill の透明度など）を確認してください。';
    }
    state.renders += 1;
    const payload = {
        content: `🎨 ${filename}（${state.renders}回目の描画）`,
        files: [new AttachmentBuilder(rendered.png, { name: filename })],
        allowedMentions: { parse: [] as [] },
    };
    try {
        const reply = state.message
            ? await state.message.edit({ ...payload, attachments: [] })
            : await interaction.followUp(payload);
        state.message = reply;
        state.hash = hash;
        const attachment = reply.attachments?.find(entry => entry.name === filename)
            ?? (reply.attachments?.size === 1 ? reply.attachments.first() : undefined);
        const lines = [`IMAGE_POSTED: ${JSON.stringify({ filename, url: attachment?.url ?? '', width: rendered.width, height: rendered.height, render: state.renders })}`];
        if (state.renders <= MAX_REVIEW_ROUNDS) {
            const review = await reviewRender(rendered.png, intent, extractSvgTexts(checked.svg), interaction.guildId);
            lines.push(`VISUAL_REVIEW: ${review}`);
            if (/問題なし/.test(review)) {
                lines.push('レビューで大きな問題は指摘されませんでした。完了として、この画像を案内してください。');
            } else {
                lines.push('指摘を直す場合は、指摘された点だけを直した SVG で、同じ filename のまま draw_image をもう一度呼んでください（投稿画像はその場で差し替わります）。前より悪くしないよう、関係ない部分は変えないでください。');
            }
        } else {
            lines.push(`VISUAL_REVIEW: （レビュー回数の上限 ${MAX_REVIEW_ROUNDS} 回に達したため未実施）`);
            lines.push('これを完成として案内してください。');
        }
        return lines.join('\n');
    } catch (error) {
        if (!state.message) state.uncertain = true;
        return `DRAW_ERROR: Discordへの投稿が失敗しました: ${error instanceof Error ? error.message.slice(0, 160) : 'unknown'}`;
    }
};
