import test from 'node:test';
import assert from 'node:assert/strict';
import { UNIVERSAL_IMAGE_SKILL, UNIVERSAL_IMAGE_CREATE_PROMPT,
    UNIVERSAL_IMAGE_REVIEW_PROMPT, isUniversalImageWorkRequest, loadUniversalImageSkill,
} from '../src/commands/staff/subcommands/UniversalImageSkill.ts';
import { buildStaffDrawingMessages } from '../src/commands/staff/subcommands/StaffAIDrawingIntent.ts';
import { buildReviewPrompt } from '../src/commands/staff/subcommands/ai-tools/drawing.ts';

test('SKILL.md is the canonical, loadable design and review skill', () => {
    assert.equal(UNIVERSAL_IMAGE_SKILL.id, 'universal-image-creation');
    assert.equal(loadUniversalImageSkill().version, UNIVERSAL_IMAGE_SKILL.version);
    assert.match(UNIVERSAL_IMAGE_CREATE_PROMPT, /目的を読み取る/);
    assert.match(UNIVERSAL_IMAGE_CREATE_PROMPT, /画像を実際に制作する/);
    assert.match(UNIVERSAL_IMAGE_CREATE_PROMPT, /draw_image/);
    assert.match(UNIVERSAL_IMAGE_CREATE_PROMPT, /upload_image/);
    assert.match(UNIVERSAL_IMAGE_REVIEW_PROMPT, /用途への適合/);
    assert.match(UNIVERSAL_IMAGE_REVIEW_PROMPT, /元画像がある場合/);
});

test('every staff image generation and photo edit receives the same universal skill', () => {
    for (const prompt of [
        '桜の風景を描いて', 'シンプルな猫のアイコンを作って',
        'サイバーパンクの派手なポスターを生成して',
        'Minecraftのサムネを作って', '青い会社ロゴを作成して',
        '写真に文字入れして', 'デザイン図解を描いて',
    ]) {
        const system = String(buildStaffDrawingMessages({userContent:prompt})[0].content);
        assert.match(system, /Universal Image Skill: 制作/, prompt);
        assert.match(system, /ユーザーの指定/, prompt);
        assert.match(system, /スタイルを選択する/, prompt);
    }
    const photo = String(buildStaffDrawingMessages({
        userContent:'元写真をそのままに彩度を少し上げて', imageEdit:true,
    })[0].content);
    assert.match(photo, /Universal Image Skill: 制作/);
    assert.match(photo, /元画像編集/);
    assert.match(photo, /photo_saturation/);
    assert.ok(!String(buildStaffDrawingMessages({userContent:'かわいい犬を描いて'})[0].content)
        .includes('必ず大見出しを入れること'));
});

test('universal image skill applies to image jobs in channel chat but not ordinary conversation', () => {
    for (const text of ['猫のイラストを描いて', 'ロゴを作って',
        '写真を編集して', 'サムネの画像をデザインして']) {
        assert.equal(isUniversalImageWorkRequest(text), true, text);
    }
    for (const text of ['彩度をちょっと上げて','右下にラベルを追加して']) {
        assert.equal(isUniversalImageWorkRequest(text,true),true,text);
    }
    for (const text of ['こんばんは','猫って何？','画像について説明して',
        '画像編集できる？','この写真に写ってるのは何？']) {
        assert.equal(isUniversalImageWorkRequest(text,true),false,text);
    }
});

test('visual review follows actual request instead of favoring one style', () => {
    for (const request of ['ネオンで派手なロゴ', '線の少ないミニマルアイコン',
        '水彩の柔らかい猫', '食べ物写真の文字入れ']) {
        const review = buildReviewPrompt('ロゴ', [], false, request);
        assert.ok(review.includes(request));
        assert.match(review, /派手さ・不規則さ・最小限/);
        assert.match(review, /文字のない画像には文字の追加を要求しない/);
    }
});
