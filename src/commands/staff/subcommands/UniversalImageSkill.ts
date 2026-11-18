import { readFileSync } from 'node:fs';

export interface UniversalImageSkill {
    id: 'universal-image-creation';
    version: string;
    create: string;
    review: string;
}

/**
 * Local, read-only SKILL.md. This is inserted into the existing image creation
 * conversation, not another agent/tool call. Tool routing is unchanged.
 */
export function loadUniversalImageSkill(): UniversalImageSkill {
    const content = readFileSync(
        new URL('./skills/universal-image/SKILL.md', import.meta.url), 'utf8');
    const version = /^version:\s*([^\r\n]+)/m.exec(content)?.[1] ?? 'unknown';
    const create = /## 制作 \(Create\)\s*\n([\s\S]*?)(?=\n## レビュー \(Review\))/m.exec(content)?.[1]?.trim();
    const review = /## レビュー \(Review\)\s*\n([\s\S]*)$/m.exec(content)?.[1]?.trim();
    if (!create || !review) {
        throw new Error('Universal image skill SKILL.md is incomplete: Create/Review sections required');
    }
    return { id: 'universal-image-creation', version, create, review };
}

export const UNIVERSAL_IMAGE_SKILL = loadUniversalImageSkill();
export const UNIVERSAL_IMAGE_CREATE_PROMPT =
    '[Universal Image Skill: 制作]\n' + UNIVERSAL_IMAGE_SKILL.create;
export const UNIVERSAL_IMAGE_REVIEW_PROMPT =
    '[Universal Image Skill: レビュー]\n' + UNIVERSAL_IMAGE_SKILL.review;

/** Only inject the skill into regular chat when the current turn requests image work. */
export function isUniversalImageWorkRequest(prompt: string, hasAttachedImage = false): boolean {
    const text = prompt.trim();
    if (!text) return false;
    if (/(?:できる|できるの|できますか|方法|やり方)[？?]?\s*$/.test(text)) return false;
    const subject = /(?:画像|写真|スクショ|イラスト|絵|ロゴ|アイコン|バナー|ポスター|サムネ|図解|背景|素材)/;
    const creation = /(?:作成|作って|描いて|描け|生成|制作|デザイン|書いて|描画|画像にして|絵にして)/;
    const editing = /(?:編集|加工|文字入れ|デコ|装飾|補正|仕上げ|明るく|暗く|彩度|コントラスト|切り抜|トリミング|合成|ラベル|フィルター|色味|ぼかし|良い感じに|いい感じに)/;
    return (subject.test(text) && (creation.test(text) || editing.test(text)))
        || (hasAttachedImage && editing.test(text));
}
