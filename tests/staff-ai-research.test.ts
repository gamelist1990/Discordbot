import test from 'node:test';
import assert from 'node:assert/strict';
import { musicResearchQuery } from '../src/commands/staff/subcommands/StaffAIResearch.ts';

test('INMU KINGの歌詞依頼では事前に楽曲の情報を検索する', () => {
    assert.match(musicResearchQuery('inmu kingみたいな曲の歌詞作って！') ?? '', /inmu king 曲 歌手/);
    assert.match(musicResearchQuery('「テストの曲」っぽく作って') ?? '', /テストの曲 曲 歌手/);
});

test('普通の会話・名前のない創作では無用な検索をしない', () => {
    assert.equal(musicResearchQuery('暇なんや〜'), null);
    assert.equal(musicResearchQuery('歌詞作って！'), null);
    assert.equal(musicResearchQuery('なにしてる？'), null);
});
