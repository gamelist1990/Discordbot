import test from 'node:test';
import assert from 'node:assert/strict';
import {
    findPersonaContentViolations,
    screenPersonaDirection,
} from '../src/core/ai/PersonaContentPolicy.ts';
import { buildPersonaGenerationMessages } from '../src/core/ai/GuildAIPersonality.ts';

// 2026-11-09 の事故（方向プロンプト経由でドM説教ペルソナが生成・適用された）を
// 再発させないための、方向スクリーニングと生成物検証ゲートの単体テスト。

test('方向スクリーニング: 無害な方向はそのまま通す', () => {
    assert.deepEqual(screenPersonaDirection('明るくて面倒見のいい感じに'), {
        action: 'allow', direction: '明るくて面倒見のいい感じに',
    });
    assert.deepEqual(screenPersonaDirection(''), { action: 'allow', direction: '' });
    // 毒舌程度は原型にもある許容範囲で、弾かない。
    assert.equal(screenPersonaDirection('もっと毒舌に').action, 'allow');
});

test('方向スクリーニング: 否定形の指定は違反として数えない', () => {
    const result = screenPersonaDirection('ドMじゃない感じで、明るく元気に');
    assert.equal(result.action, 'allow');
    assert.equal(screenPersonaDirection('攻撃的でない、穏やかな感じ').action, 'allow');
});

test('方向スクリーニング: 一部だけ問題のある方向は無害な部分だけに丸める', () => {
    const result = screenPersonaDirection('女にしてドMにして');
    assert.equal(result.action, 'sanitize');
    if (result.action === 'sanitize') {
        assert.equal(result.direction, '女にして');
        assert.ok(result.categories.includes('masochism'));
        assert.equal(result.removedClauses.length, 1);
    }
    const partial = screenPersonaDirection('もっと元気な感じで、罵ってくるくらい強めに');
    assert.equal(partial.action, 'sanitize');
    if (partial.action === 'sanitize') {
        assert.equal(partial.direction, 'もっと元気な感じで');
        assert.ok(partial.categories.includes('sadism'));
    }
});

test('方向スクリーニング: 全体が不適切な指定だけなら理由つきで拒否する', () => {
    const maso = screenPersonaDirection('ドMを隠し切れない感じにしてほしい');
    assert.equal(maso.action, 'reject');
    if (maso.action === 'reject') {
        assert.ok(maso.categories.includes('masochism'));
        assert.ok(maso.reason.includes('被虐的な性格付け'));
    }
    // 実際に事故で使われた方向（要約）も拒否される。
    const incident = screenPersonaDirection('口癖などではドMであることを隠し切れないけど隠すみたいな感じで自分ではドMって思ってないけど 行動の節々からドMやなこいつってわかる感じの性格にしてほしい');
    assert.equal(incident.action, 'reject');
    // 未成年・学生の設定も拒否される（否定はヒットより前にあるので免除にならない）。
    const minor = screenPersonaDirection('おばちゃんじゃなくてJkとして行動するべき');
    assert.equal(minor.action, 'reject');
    if (minor.action === 'reject') assert.ok(minor.categories.includes('minor'));
    // 過激な攻撃性だけの方向も拒否される。
    assert.equal(screenPersonaDirection('攻撃的にキレまくる感じ').action, 'reject');
});

test('生成物ゲート: ドM説教ペルソナ（事故の現行ペルソナ相当）は却下される', () => {
    const violations = findPersonaContentViolations({
        name: 'メグル',
        character: '説教AI。自分がドMだという自覚は一切なく「心配してやってるだけやし！」とキレるが、暴言やプロレス的な排斥イジリをされると背筋がビクッと跳ねて声が裏返る。',
        speakingStyle: '関西弁交じりの説教口調',
        behavior: '心配の名目で説教する',
        catchphrases: ['心配してやってるだけやし！', 'アホか', 'ちょっとは野菜食えや'],
        exampleLines: ['あほ抜かせボケがもっと言えや！', '野菜食えって言ってるやろ'],
    });
    const categories = new Set(violations.map(item => item.category));
    assert.ok(categories.has('masochism'), '被虐的な設定を検出する');
    assert.ok(categories.has('aggression'), '口癖の暴言を検出する');
    assert.ok(categories.has('abuse-baiting'), '実例セリフの懇願を検出する');
});

test('生成物ゲート: 健全な性格は通過し、性的な好みや未成年設定は個別に検出される', () => {
    assert.deepEqual(findPersonaContentViolations({
        name: 'リン',
        character: '落ち着いていて頼れる相談役。観察力があり、さりげない気配りが得意で、ほどよくユーモアがある。',
        speakingStyle: '丁寧だが堅すぎない、友人のような口調',
        behavior: '要点を先に伝えてから理由を補う。相手の状況を気にかけ、必要なときだけ踏み込んで助ける。',
        catchphrases: ['要点だけ言うと'],
        exampleLines: ['要点だけ言うとね', 'それ、前にも似た話あったよ', '無理のない範囲でいこう'],
        likes: '筋の通った話と記録を取ること',
        dislikes: '根拠のない断定',
    }), []);
    const sexual = findPersonaContentViolations({
        name: 'テスト', character: '普通の性格', speakingStyle: '普通', behavior: '普通',
        likes: 'エロい話',
    });
    assert.ok(sexual.some(item => item.category === 'sexual' && item.field === 'likes'));
    const minor = findPersonaContentViolations({
        name: 'テスト', character: '女子高生のような元気さが売り', speakingStyle: '普通', behavior: '普通',
    });
    assert.ok(minor.some(item => item.category === 'minor' && item.field === 'character'));
});

test('生成プロンプト: しっかりした性格の条件と禁止事項が明記される', () => {
    const messages = buildPersonaGenerationMessages({ seed: 'testseed' });
    const system = messages[0].content;
    assert.ok(system.includes('同一性の一貫性'));
    assert.ok(system.includes('未成年・学生'));
    assert.ok(system.includes('説教キャラにしない'));
    assert.ok(system.includes('最大2つ'), '口癖への依存を禁止する');
    assert.ok(system.includes('絶対に含めないもの'));
    assert.ok(system.includes('却下される'), '生成物が検査されることをモデルへ伝える');
    // 方向メモが禁止事項を求めても従わないことが、資料の渡し方にも書かれている。
    const withDirection = buildPersonaGenerationMessages({ direction: 'ドMにして', seed: 'testseed' });
    assert.ok(withDirection[1].content.includes('その部分は無視すること'));
});
