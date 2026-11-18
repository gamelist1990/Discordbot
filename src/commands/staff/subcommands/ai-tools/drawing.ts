import { createHash } from 'node:crypto';
import { AttachmentBuilder, type ChatInputCommandInteraction, type Message } from 'discord.js';
import sharp from 'sharp';
import { UNIVERSAL_IMAGE_REVIEW_PROMPT } from '../UniversalImageSkill.js';
import { composeDrawingSourceSvg, hasDrawingSourceImage } from './drawingSource.js';
import { applySvgFontPresets, SVG_FONT_PRESETS } from './svgTypography.js';
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
const REVIEW_TIMEOUT_MS = 25_000;

/** A drawing is complete only when the visual pass approves it or the bounded retry budget ends. */
export function drawingNeedsRevision(results: Array<{name: string; output: string}>): boolean {
    const output = results.find(item => item.name === 'draw_image')?.output ?? '';
    const count = Number(/\"render\":(\d+)/.exec(output)?.[1] ?? 0);
    return /^IMAGE_POSTED:/m.test(output) && /^REVIEW_VERDICT: REVISE$/m.test(output)
        && count >= 1 && count < MAX_REVIEW_ROUNDS;
}

type DrawingProgressListener = (status: string) => void;
const drawingListeners = new WeakMap<object, DrawingProgressListener>();
const drawingBriefs = new WeakMap<object, string>();
export function setDrawingUserBrief(interaction: object, brief: string): void {
    drawingBriefs.set(interaction, brief.trim().slice(0, 2000));
}

export function setDrawingProgressListener(interaction: object, listener: DrawingProgressListener): void {
    drawingListeners.set(interaction, listener);
}

const POST_MAX_WIDTH = 1600;
const REVIEW_MAX_WIDTH = 1024;

export const drawImageToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'draw_image',
        description: [
            'SVGでイラスト・ロゴ・タイトルロゴなどを描き、PNG画像としてDiscordに投稿します。投稿後に「描画レビュー」（画像を視覚モデルがチェックした結果）が返ります。',
            '使えるのは SVG の基本要素だけです: rect / circle / ellipse / path（C・Q のベジェ曲線、A の円弧） / line / polyline / polygon / text / linearGradient / radialGradient / g（transform の移動・回転・拡大）。外部画像・スクリプト・外部参照は使えません。',
            'ルール: ルートの<svg>にはviewBoxを必ず付ける。日本語の通常文字は<text>にそのまま書く。文字輪郭や影・色はSVGのstroke、fill、gradient、filterで作成できる。重要要素は余白を持たせる。',
            'フォントスタイルは要求に応じてfont_presetを指定できる。未指定ならnoneが標準。画像編集で派手な文字効果は自動では付けず、ユーザーから指定がある場合のみjagged/neon/comic等を利用する。複数スタイルは各textのdata-font-presetで指定可能。',
            '標準フォントでは表現できない新規のロゴ文字デザインは、AIがSVGの<path>や<polygon>を組み合わせて文字の輪郭を描いてもよい。ただし通常の文章は<text>を使い、カスタム文字の正確な文字列は<text>でも別途記載して誤字を検査できるようにする。フォントファイルを生成するのではなく、SVG内でオリジナルのレタリングを作る。',
            '投稿は同じ filename で再呼び出しすると、その場で新しい描画に差し替わります。レビューで欠陥が指摘されたら、SVG を直して同じ filename でもう一度呼んでください（レビューは最大3回まで付きます）。問題がなければ完了として案内してください。',
            '制作では汎用画像制作Skillの目的・構図・題材・文字・視覚レビューに従い、SVGの基本図形から複雑なパス、影、グラデーションまで必要に応じて使い分ける。単純図形に決め打ちしない。',
            '画像編集の標準は元写真を主役にした自然なデザイン。svgは透明な装飾レイヤー。文字や帯は必要最低限、既存UIや被写体を隠さない。photo_fitでcover/contain。photo_brightnessとphoto_saturationは元写真の色調そのものをSharpで補正する（透明SVGの上掛けで代用しない）。少し明るく=1.07〜1.12、少し鮮やかに=1.08〜1.15が目安。',
            '元画像に明るさ・彩度の補正のみを求められた場合は、空の透明svg（viewBox付き）と補正値だけで実行できる。ラベル指定がある場合はその部分だけSVGテキストを配置する。必ず完成画像を投稿する。',
            'intent には「何を描くか（題材・入れる文字・雰囲気）」を短く正確に書いてください。レビューの照合に使われます。',
        ].join('\n'),
        parameters: {
            type: 'object',
            properties: {
                svg: { type: 'string', description: '完成した SVG 文書全体（<svg …>…</svg>）。コードフェンスや説明を含めない。' },
                filename: { type: 'string', description: '投稿する PNG のファイル名（英数字と . _ - のみ、末尾は .png）。例: title-logo.png' },
                intent: { type: 'string', description: '何を描くか: 題材、入れる文字、色や雰囲気の指定を短く。レビューの照合に使います。' },
                photo_fit: { type: 'string', enum: ['cover', 'contain'], description: '元画像の収め方。既定cover、画像全体を残すならcontain。' },
                photo_brightness: { type: 'number', minimum: 0.6, maximum: 1.6, description: '元画像の明るさ倍率。1=変更なし、少し上げるなら1.08。SVGオーバーレイではなく写真の画素に適用。' },
                photo_saturation: { type: 'number', minimum: 0.5, maximum: 1.8, description: '元画像の彩度倍率。1=変更なし、少し上げるなら1.12。写真の画素に適用。' },
                font_preset: { type: 'string', enum: [...SVG_FONT_PRESETS], description: '標準none。派手な文字効果を明示指定された場合はjagged（ガクガク字）/neon/comic/retro/metal/pixel/horror/customなど。各textのdata-font-presetも可能。' },
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
    [/@import|@font-face/i, '外部フォントの読み込みは使えません'],
    [/<style[\s>]/i, 'styleタグは使えません。SVGの属性で装飾を指定してください'],
    [/\b(?:href|xlink:href)\s*=\s*["']\s*(?!#)[^"']+["']/i, '外部参照は使えません'],
    [/url\(\s*["']?(?:file:|data:|ftp:)/i, '外部URLの参照は使えません'],
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
    // AI-written path lettering stores the intended text as an accessibility label.
    for (const match of svg.matchAll(/<g\b[^>]*\baria-label\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        const label = decodeEntities(match[1]).replace(/\s+/g, ' ').trim();
        if (label && !texts.includes(label)) texts.push(label.slice(0, 180));
    }
    return texts;
}

/** 描画レビューのプロンプト（構造化チェックリスト。具体的な欠陥だけを返させる）。 */
/** Unified skill review: evaluates the finished PNG against the actual brief. */
export function buildReviewPrompt(
    intent: string, texts: string[], isPhotoEdit = false, requestBrief?: string,
): string {
    return [
        'あなたは完成した画像を実際に見る品質レビュアーです。説明やSVGだけでなく添付PNGの見た目から判断します。',
        `ユーザーの依頼: ${requestBrief?.trim().slice(0, 1200) || intent}`,
        `画像の意図: ${intent}`,
        `画像に指定された文字: ${texts.length ? texts.map(t => '「' + t + '」').join('、') : '（指定なし）'}`,
        UNIVERSAL_IMAGE_REVIEW_PROMPT,
        ...(isPhotoEdit ? [
            '【元画像の編集】食べ物、建築、人物、商品など元の被写体を隠していないか、写真中の既存HUD、ロゴ、包装の文字を誤って上書きしていないか確認。新しい情報や架空の文字を付け足さない。',
        ] : []),
        'ユーザーが指定した派手さ・不規則さ・最小限のデザインは尊重し、理由なく別の画風を強制しない。',
        '必ずJSONのみで回答: {"score":整数0〜100,"accepted":真偽値,"issues":["具体的な欠陥と修正内容"]}。',
        '85点以上で重大な欠陥がない場合 accepted=true。issuesは修正価値がある具体的な問題のみ最大5件。問題がなければ空配列。',
    ].join('\n');
}

/** SVG を PNG に描画する。targetWidth に近い解像度で描き、大きければ縮小する。 */
export async function renderSvgToPng(svg: string): Promise<{ png: Buffer; width: number; height: number }> {
    const viewBox = /viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(svg);
    const baseWidth = viewBox ? Number(viewBox[1]) : 800;
    // Render standard thumbnail viewBox=1280x720 at its full native size.
    const scale = Math.min(4, Math.max(1, 1280 / Math.max(1, baseWidth)));
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

/** The PNG bytes (not the SVG description) are inspected by a vision-capable model. */
export type DrawingReview = { verdict: 'PASS' | 'REVISE' | 'UNAVAILABLE'; score?: number; feedback: string };

export function parseDrawingReview(content: unknown): DrawingReview {
    const text = typeof content === 'string' ? content.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').trim() : '';
    const json = /\{[\s\S]*\}/.exec(text)?.[0];
    if (json) {
        try {
            const review = JSON.parse(json) as { score?: unknown; accepted?: unknown; issues?: unknown };
            if (typeof review.score === 'number' && Number.isFinite(review.score)
                && typeof review.accepted === 'boolean' && Array.isArray(review.issues)) {
                const score = Math.max(0, Math.min(100, Math.round(review.score)));
                const issues = review.issues.filter((issue): issue is string => typeof issue === 'string' && !!issue.trim())
                    .slice(0, 5).map(issue => issue.slice(0, 180));
                const accepted = review.accepted && score >= 85 && issues.length === 0;
                return { verdict: accepted ? 'PASS' : 'REVISE', score,
                    feedback: accepted ? `品質確認OK（${score}/100）`
                        : `品質 ${score}/100。修正点: ${issues.length ? issues.join(' / ') : '構図・題材の分かりやすさを改善'}` };
            }
        } catch { /* handle older text-only VLM responses below */ }
    }
    if (/^問題なし[。.!！\s]*$/.test(text)) return { verdict: 'PASS', feedback: '問題なし' };
    if (text && !/^\(?描画レビューを取得できませんでした|^\(?描画レビューの応答が空でした/.test(text)) {
        return { verdict: 'REVISE', feedback: text.slice(0, 1200) };
    }
    return { verdict: 'UNAVAILABLE', feedback: '画像を確認できませんでした。投稿済み画像は保持します。' };
}

async function reviewRender(png: Buffer, intent: string, texts: string[], guildId?: string, isPhotoEdit = false, requestBrief?: string): Promise<DrawingReview> {
    try {
        const reviewPng = await sharp(png).resize({ width: REVIEW_MAX_WIDTH, withoutEnlargement: true }).png().toBuffer();
        const response = await fetch(`${config.pexAi.endpoint.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
            headers: {
                'content-type': 'application/json',
                ...(config.pexAi.apiKey ? { authorization: `Bearer ${config.pexAi.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: config.pexAi.visionModel || config.pexAi.model,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: buildReviewPrompt(intent, texts, isPhotoEdit, requestBrief) },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${reviewPng.toString('base64')}`, detail: 'auto' } },
                    ],
                }],
                temperature: 0.2,
                max_tokens: 650,
                chat_template_kwargs: { enable_thinking: false },
            }),
        });
        if (!response.ok) {
            console.warn(`[StaffAI draw_image] Visual review HTTP ${response.status}`);
            return { verdict: 'UNAVAILABLE', feedback: `視覚チェックHTTP ${response.status}。投稿済み画像は保持します。` };
        }
        const data = await response.json() as any;
        void recordAIUsage({
            purpose: 'vision', model: config.pexAi.visionModel || config.pexAi.model, guildId,
            inputTokens: data?.usage?.prompt_tokens, outputTokens: data?.usage?.completion_tokens,
            cachedTokens: data?.usage?.prompt_tokens_details?.cached_tokens ?? null,
        }).catch(() => undefined);
        return parseDrawingReview(data?.choices?.[0]?.message?.content);
    } catch (error) {
        console.warn('[StaffAI draw_image] Visual review unavailable:', error instanceof Error ? error.message : error);
        return { verdict: 'UNAVAILABLE', feedback: '視覚チェックがタイムアウトまたは失敗しました。投稿済み画像は保持します。' };
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
    const preparedSvg = applySvgFontPresets(checked.svg, args?.font_preset);
    const photoBrightness = typeof args?.photo_brightness === 'number' && Number.isFinite(args.photo_brightness)
        ? Math.min(1.6, Math.max(0.6, args.photo_brightness)) : 1;
    const photoSaturation = typeof args?.photo_saturation === 'number' && Number.isFinite(args.photo_saturation)
        ? Math.min(1.8, Math.max(0.5, args.photo_saturation)) : 1;
    const hasPhotoAdjustments = photoBrightness !== 1 || photoSaturation !== 1;
    const hash = createHash('sha256').update(preparedSvg).update(JSON.stringify([args?.photo_fit,photoBrightness,photoSaturation])).digest('hex');
    if (state.hash === hash) {
        return 'DRAW_ERROR: 前回と同一の SVG です（描画は変化しません）。レビューの指摘に沿って内容を変更してから再描画してください。';
    }
    if (!state.message && state.uncertain) {
        return 'DRAW_ERROR: 先の投稿状態が不明なため、同名ファイルの自動再投稿はしません。Discord上の投稿状態を確認してください。';
    }
    let rendered: { png: Buffer; width: number; height: number };
    try {
        if (hasDrawingSourceImage(interaction)) {
            const overlay = await renderSvgToPng(preparedSvg);
            if (await isBlankRender(overlay.png) && !hasPhotoAdjustments) {
                return 'DRAW_ERROR: 装飾レイヤーが空白で元写真の補正も指定されていません。文字・図形を追加するかphoto_brightness/photo_saturationを設定してください。';
            }
            const alpha = (await sharp(overlay.png).stats()).channels[3];
            if (alpha && alpha.mean > 210) {
                return 'DRAW_ERROR: SVGの不透明な装飾が元写真をほぼ隠しています。透明背景にして、写真を活かす装飾を描いてください。';
            }
            // Entire composition is one native SVG: photo <image> + vector effects.
            const compositeSvg = await composeDrawingSourceSvg(interaction, preparedSvg,
                args?.photo_fit === 'contain' ? 'contain' : 'cover',
                { brightness: photoBrightness, saturation: photoSaturation });
            rendered = await renderSvgToPng(compositeSvg);
        } else {
            rendered = await renderSvgToPng(preparedSvg);
            if (await isBlankRender(rendered.png)) return 'DRAW_ERROR: 描画結果が空白でした。';
        }
    } catch (error) {
        return `DRAW_ERROR: SVGまたは元画像の処理に失敗しました: ${error instanceof Error ? error.message.slice(0, 180) : 'unknown'}`;
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
        let attachment = reply.attachments?.find(entry => entry.name === filename)
            ?? (reply.attachments?.size === 1 ? reply.attachments.first() : undefined);
        // A successful Discord response can initially lack attachment metadata.
        // Refresh the existing message before treating the URL as unavailable.
        if (!attachment?.url) {
            try {
                const fetched = await reply.fetch();
                state.message = fetched;
                attachment = fetched.attachments?.find(entry => entry.name === filename)
                    ?? (fetched.attachments?.size === 1 ? fetched.attachments.first() : undefined);
            } catch (error) {
                console.warn('[StaffAI draw_image] Could not refresh posted attachment URL:', error);
            }
        }
        if (!attachment?.url) return 'DRAW_ERROR: Discordへ画像を投稿しましたが、添付URLを確認できませんでした。Discordの投稿を確認してください（自動再送はしません）。';
        const lines = ['IMAGE_POSTED: ' + JSON.stringify({
            filename, url: attachment.url, messageUrl: state.message?.url,
            width: rendered.width, height: rendered.height, render: state.renders,
        })];
        if (state.renders <= MAX_REVIEW_ROUNDS) {
            drawingListeners.get(interaction)?.(`画像を投稿済み · 視覚AIで品質確認中（${state.renders}/${MAX_REVIEW_ROUNDS}回）`);
            const review = await reviewRender(rendered.png, intent, extractSvgTexts(preparedSvg), interaction.guildId, hasDrawingSourceImage(interaction), drawingBriefs.get(interaction));
            lines.push(`REVIEW_VERDICT: ${review.verdict}`);
            lines.push(`VISUAL_REVIEW: ${review.feedback}`);
            if (review.verdict === 'REVISE' && state.renders < MAX_REVIEW_ROUNDS) {
                lines.push('画像を実際に見たレビュアーの指摘を直してください。前と同じ filename、改良済み SVG で draw_image を再実行して投稿画像を差し替えます。最低限の変更ではなく、指摘が解消するように修正してください。');
                drawingListeners.get(interaction)?.(`品質評価を確認 · 修正版を作成します（${state.renders}/${MAX_REVIEW_ROUNDS}回）`);
            } else if (review.verdict === 'PASS') {
                lines.push('視覚チェック合格。完成として案内してください。');
            } else if (review.verdict === 'UNAVAILABLE') {
                lines.push('視覚チェック不能のため、無限に再試行せず投稿済み画像を案内してください。');
            } else {
                lines.push('修正回数上限。現在の画像を案内し、残る品質上の問題があれば正直に伝えてください。');
            }
        } else {
            lines.push('REVIEW_VERDICT: UNAVAILABLE');
            lines.push(`VISUAL_REVIEW: （レビュー回数の上限 ${MAX_REVIEW_ROUNDS} 回に達したため未実施）`);
        }
        return lines.join('\n');
    } catch (error) {
        if (!state.message) state.uncertain = true;
        return `DRAW_ERROR: Discordへの投稿が失敗しました: ${error instanceof Error ? error.message.slice(0, 160) : 'unknown'}`;
    }
};

/** Only verified Discord attachments count as a successful drawing. Never accept the model's claim. */
export function completeStaffDrawingTool(results: Array<{ name: string; output: string }>): string | undefined {
    const result = results.find(item => item.name === 'draw_image');
    if (!result) return undefined;
    const match = /^IMAGE_POSTED:\s*(\{[^\n]+\})/m.exec(result.output);
    if (match) {
        try {
            const posted = JSON.parse(match[1]) as {
                filename?: unknown; url?: unknown; messageUrl?: unknown; render?: unknown;
            };
            if (typeof posted.url === 'string' && /^https:\/\/\S+$/.test(posted.url)
                && typeof posted.filename === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/i.test(posted.filename)) {
                const renderCount = typeof posted.render === 'number' && Number.isInteger(posted.render)
                    && posted.render >= 1 ? '（' + posted.render + '回の描画で完了）' : '';
                // Never drop the real attachment URL when preparing the final reply.
                const lines = ['🎨 ' + posted.filename + renderCount, '🔗 画像URL: ' + posted.url];
                if (typeof posted.messageUrl === 'string'
                    && /^https:\/\/(?:discord\.com|discordapp\.com)\/channels\/\S+$/.test(posted.messageUrl)) {
                    lines.push('📌 投稿リンク: ' + posted.messageUrl);
                }
                return lines.join('\n');
            }
        } catch { /* malformed result is never a success */ }
    }
    const reason = result.output.replace(/^DRAW_ERROR:\s*/i, '').replace(/[\r\n]+/g, ' ').slice(0, 240);
    return `⚠️ 画像は投稿されていません。${reason || '描画ツールの投稿結果を確認できませんでした。'}`;
}
