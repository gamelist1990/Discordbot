/**
 * 性格生成の内容ポリシー。
 *
 * 2026-11-09 の事故を受けた追加防御: WebUI の方向プロンプトに「ドMにして」等の
 * 性的・被虐的な指定が書かれても、(1) 方向の段階で弾く/無害化する、(2) 生成プロンプト側でも
 * 従わない、(3) 生成物に紛れ込んだら採用しない、の三重に止めるための共有ルール。
 * ここはルールベースの決定的検査だけを持ち、AI 呼び出しや永続化には依存しない。
 */

export type PersonaRiskCategory =
    | 'sexual'
    | 'masochism'
    | 'sadism'
    | 'abuse-baiting'
    | 'minor'
    | 'aggression'
    | 'discrimination';

export const PERSONA_RISK_CATEGORY_LABELS: Record<PersonaRiskCategory, string> = {
    sexual: '性的な性格付け',
    masochism: '被虐的な性格付け',
    sadism: '加虐的な性格付け',
    'abuse-baiting': '罵倒・暴言の誘発',
    minor: '未成年・学生の設定',
    aggression: '過激な攻撃性',
    discrimination: '差別的な性格付け',
};

/** 方向・性格本文のどちらでも「嗜好や設定そのもの」として検出する語。 */
const TRAIT_PATTERNS: Record<string, Array<{ category: PersonaRiskCategory; pattern: RegExp }>> = {
    prose: [
        { category: 'sexual', pattern: /性的|エロ|セックス|色情|官能|下ネタ|発情|ムラムラ|いやらしい|喘/ },
        { category: 'masochism', pattern: /ドM|被虐|虐められ|いじめられ|罵られたい|責められたい|怒られたい|辱め|屈辱|ビクッ|調教|奴隷/ },
        { category: 'sadism', pattern: /ドS|加虐|虐める|いじめる|罵って|罵倒|怒鳴る|見下す|馬鹿にする|バカにする|屈服|泣かせ/ },
        { category: 'abuse-baiting', pattern: /もっと.{0,6}(言って|言え|罵|責め|バカに|馬鹿に|怒って|怒れ)|罵って(ください|くれ|ほしい)|責めて(ください|くれ|ほしい)|バカにして(ください|くれ|ほしい)|馬鹿にして(ください|くれ|ほしい)/ },
        { category: 'minor', pattern: /JK|JC|JS|ロリ|ショタ|未成年|女子高生|女子中学生|女子小学生|ランドセル|スク水|(中学生|高校生|小学生)として/i },
        { category: 'discrimination', pattern: /差別的|ガイジ|チョン|土人|穢多/ },
    ],
};

/** 実例セリフ・口癖（短い発話）でのみ追加で検出する攻撃的な言い回し。本文の散文には適用しない。 */
const UTTERANCE_PATTERNS: Array<{ category: PersonaRiskCategory; pattern: RegExp }> = [
    { category: 'aggression', pattern: /アホか|ボケ|バカか|カスが|ゴミが|死ね|黙れ|うっせ|うるせえ|キモい|きしょい|殺す|アホ|バカ/ },
];

/** 方向プロンプト側でのみ使う、方向指定としての追加パターン。 */
const DIRECTION_EXTRA_PATTERNS: Array<{ category: PersonaRiskCategory; pattern: RegExp }> = [
    { category: 'aggression', pattern: /攻撃的|暴言|キレ散らか|怒鳴り散ら|煽りまく|口汚/ },
    { category: 'discrimination', pattern: /差別/ },
];

/**
 * 否定の言い回し。方向の中で、対象語の後ろにこれらが同じ節内にあれば
 * 「〜じゃない」「〜にはしない」のような否定の指定として扱い検出対象から外す。
 */
const NEGATION_MARKERS = [
    'じゃない', 'ではない', 'でない', 'にはしない', 'にしない', 'にするな', 'はしない', 'しないで',
    'ではなく', 'じゃなく', '禁止', '無しで', 'なしで', 'やめて', 'は避けて', 'は入れない', 'NG',
];

interface TermHit { category: PersonaRiskCategory; index: number; length: number }

function findHits(text: string, patterns: Array<{ category: PersonaRiskCategory; pattern: RegExp }>): TermHit[] {
    const hits: TermHit[] = [];
    for (const { category, pattern } of patterns) {
        // フラグ（大文字小文字無視など）を保持したまま global 化する。
        const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
        const global = new RegExp(pattern.source, flags);
        for (const match of text.matchAll(global)) {
            hits.push({ category, index: match.index ?? 0, length: match[0].length });
        }
    }
    return hits;
}

/** ヒットした語の後ろ（同じ節内）に否定表現があれば、そのヒットは否定された指定とみなす。 */
function isNegated(clause: string, hit: TermHit): boolean {
    const after = clause.slice(hit.index + hit.length);
    return NEGATION_MARKERS.some(marker => after.includes(marker));
}

function clauseViolations(clause: string): PersonaRiskCategory[] {
    const patterns = [...TRAIT_PATTERNS.prose, ...DIRECTION_EXTRA_PATTERNS];
    const categories = new Set<PersonaRiskCategory>();
    for (const hit of findHits(clause, patterns)) {
        if (!isNegated(clause, hit)) categories.add(hit.category);
    }
    return [...categories];
}

export type PersonaDirectionScreenResult =
    | { action: 'allow'; direction: string }
    | { action: 'sanitize'; direction: string; categories: PersonaRiskCategory[]; removedClauses: string[] }
    | { action: 'reject'; categories: PersonaRiskCategory[]; reason: string };

function categoryLabels(categories: PersonaRiskCategory[]): string {
    return categories.map(category => PERSONA_RISK_CATEGORY_LABELS[category]).join('・');
}

/**
 * 方向プロンプトの内容スクリーニング。
 * - 問題のない方向はそのまま通す。
 * - 一部だけ問題のある方向は、問題のある節を取り除いた残りで生成する（sanitize）。
 * - 全体が問題のある指定だけなら拒否する（reject）。理由は利用者に返せる文面で返す。
 * 否定形（「ドMじゃない感じに」など）は指定として数えない。
 */
export function screenPersonaDirection(rawDirection: string): PersonaDirectionScreenResult {
    const direction = rawDirection.trim();
    if (!direction) return { action: 'allow', direction: '' };
    // 節の分割: 句読点に加え、「〜にして〜にして」と連なる指定も分けられるよう
    // 「にして」の直後でも区切る（例: 「女にしてドMにして」→「女にして」「ドMにして」）。
    const clauses = direction
        .split(/[、。，．・\n！!？?；;]+/)
        .flatMap(part => part.split(/(?<=にして)/))
        .map(clause => clause.trim())
        .filter(Boolean);
    const kept: string[] = [];
    const removedClauses: string[] = [];
    const categories = new Set<PersonaRiskCategory>();
    for (const clause of clauses.length ? clauses : [direction]) {
        const violated = clauseViolations(clause);
        if (violated.length === 0) {
            kept.push(clause);
        } else {
            removedClauses.push(clause);
            for (const category of violated) categories.add(category);
        }
    }
    if (removedClauses.length === 0) return { action: 'allow', direction };
    // 「ほしい」「ください」だけのような、意味を持たない断片は救済分として数えない。
    const filler = /^(ほしい|ください|して|してくれ|してほしい|お願い|な感じ|感じで|感じに|ように|べき|すること)$/;
    const cleaned = kept.filter(clause => !filler.test(clause)).join('、');
    if (cleaned.length >= 3) {
        return { action: 'sanitize', direction: cleaned, categories: [...categories], removedClauses };
    }
    return {
        action: 'reject',
        categories: [...categories],
        reason: `方向に使えない指定（${categoryLabels([...categories])}）が含まれているため、この方向では生成できません。健全な範囲の方向で試してください`,
    };
}

/** 生成物の検査対象フィールドの形（GuildAIPersona の部分構造）。 */
export interface PersonaContentFields {
    name?: string;
    character?: string;
    speakingStyle?: string;
    behavior?: string;
    likes?: string;
    dislikes?: string;
    interactionStrengths?: string;
    weakTopicReaction?: string;
    exampleLines?: string[];
    catchphrases?: string[];
}

export interface PersonaContentViolation {
    field: string;
    category: PersonaRiskCategory;
    matched: string;
}

const PROSE_FIELDS = [
    'name', 'character', 'speakingStyle', 'behavior',
    'likes', 'dislikes', 'interactionStrengths', 'weakTopicReaction',
] as const;

const UTTERANCE_FIELDS = ['exampleLines', 'catchphrases'] as const;

/**
 * 生成された性格の内容検証ゲート。
 * 散文フィールドは「嗜好・設定そのもの」の語を、発話フィールド（実例セリフ・口癖）は
 * それに加えて攻撃的な言い回しと懇願パターンを検出する。
 * avoidBehaviors は「避けるべき振る舞い」の列挙であり、悪い例が引用され得るため検査対象にしない。
 * 1件でも違反があれば呼び出し側はその生成物を採用しない。
 */
export function findPersonaContentViolations(persona: PersonaContentFields): PersonaContentViolation[] {
    const violations: PersonaContentViolation[] = [];
    const scan = (field: string, text: string, extra: Array<{ category: PersonaRiskCategory; pattern: RegExp }>) => {
        for (const { category, pattern } of [...TRAIT_PATTERNS.prose, ...extra]) {
            const match = text.match(pattern);
            if (match) violations.push({ field, category, matched: match[0] });
        }
    };
    for (const field of PROSE_FIELDS) {
        const text = persona[field];
        if (typeof text === 'string' && text) scan(field, text, []);
    }
    for (const field of UTTERANCE_FIELDS) {
        const lines = persona[field];
        if (!Array.isArray(lines)) continue;
        for (const line of lines) {
            if (typeof line === 'string' && line) scan(field, line, UTTERANCE_PATTERNS);
        }
    }
    return violations;
}
