import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStaffToolNames } from '../src/commands/staff/subcommands/StaffAIToolRouting.ts';

test('雑談ではツール定義を送らない', () => {
    for (const prompt of ['やほ〜！', '暇なんや〜😂', '暇なの？', '元気？', 'ありがとう', 'おはよう！']) {
        assert.equal(selectStaffToolNames(prompt).size, 0, prompt);
    }
});

test('知らない楽曲や新しい情報はWeb検索を使える', () => {
    for (const prompt of ['INMU KINGみたいな曲の歌詞を作って', '最新ニュース調べて', 'Gemma 4の評判は？']) {
        assert.ok(selectStaffToolNames(prompt).has('web_search'), prompt);
    }
});

test('疑問符のない説明や質問でも検索と出典本文の取得を使える', () => {
    for (const prompt of ['Qwenの使い方を教えて', '光合成の仕組みを説明して', '量子コンピュータとは', '富士山はどこにある', 'Explain photosynthesis']) {
        const tools = selectStaffToolNames(prompt);
        assert.ok(tools.has('web_search'), prompt);
        assert.ok(tools.has('fetch_url'), prompt);
    }
    assert.equal(selectStaffToolNames('過去の会話を調べて').has('web_search'), false);
});

test('天気と時刻は対応するツールのみを渡す', () => {
    const weather = selectStaffToolNames('今日の天気は');
    assert.ok(weather.has('get_weather'));
    assert.equal(weather.has('get_server_status'), false);
    const time = selectStaffToolNames('今何時？');
    assert.ok(time.has('get_time'));
});

test('Discord固有の操作に必要なツールを選択する', () => {
    assert.ok(selectStaffToolNames('Discordサーバーのオンライン人数を確認').has('get_server_status'));
    assert.ok(selectStaffToolNames('このユーザーのロールを教えて').has('get_user_details'));
    assert.ok(selectStaffToolNames('チャンネルの発言履歴を調べて').has('search_channel_messages'));
    assert.ok(selectStaffToolNames('特定の言葉を何回言ったかカウント').has('count_phrase_in_channel'));
    assert.ok(selectStaffToolNames('AntiCheatの違反履歴を確認').has('get_anticheat_user_profile'));
});

test('メモ操作は単一の統合メモリーツールにルーティングする', () => {
    const names = selectStaffToolNames('昨日のメモを編集して');
    assert.ok(names.has('manage_memory'));
    for (const name of ['list_memos', 'get_memo', 'create_memo', 'update_memo', 'delete_memo', 'search_memos', 'recall_staff_memory']) {
        assert.equal(names.has(name), false);
    }
});

test('短い続きの発言は直前の会話にあるツールを使える', () => {
    assert.ok(selectStaffToolNames('それ詳しく', ['最新ニュースについて調べて']).has('web_search'));
    assert.ok(selectStaffToolNames('じゃあもう一回', ['明日の東京の天気']).has('get_weather'));
});

test('使える機能の質問では全ツールを公開する', () => {
    assert.ok(selectStaffToolNames('Staff AIで使えるツールは何？').has('__all__'));
    assert.ok(selectStaffToolNames('どんな機能が使える？').has('__all__'));
});
