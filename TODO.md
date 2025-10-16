# ランキングシステム実装 TODO

目的: ギルド内アクティビティに基づくランク（XP）システムを追加し、スタッフがプリセットを作成・管理、ランクパネルをチャンネルに配置・定期更新できるようにする。

## 機能要件

1. 基本機能
   - ユーザーのXPは主にテキストチャットメッセージ数（発言数）とVC接続時間に基づいて増加する。
   - ギルドごとにランクプリセット（Rank Preset）を作成できる。プリセットは複数のランク帯（例: Bronze/1-999, Silver/1000-4999, Gold/5000+）を含む。
   - 各ランク帯に到達した際の報酬（ロール付与、通知 チャンネル通知、カスタムアクション）を設定可能。
   - `staff rank` コマンドでプリセットの管理（作成/編集/削除）と、チャネル内にランクパネル（Embed）を作成できる。
   - ランクパネルは定期的に更新され、消されている場合はDB側でクリアする。

2. Discord コマンド
   - `/rank` : 自身の現在のXP、次のランクまでの必要XP、現在のランク、総メンバー内順位（オプション）をEmbedで表示。
   - `staff rank` : スタッフ用サブコマンド群
     - `staff rank preset create <name>` などプリセット管理サブコマンド
     - `staff rank panel create <preset> <channel>` : 指定プリセットのランクパネルを指定チャンネルに生成
     - `staff rank panel remove <panelId>` : パネル削除/停止
     - `staff rank settings notify-channel <channel>` : ランクアップ通知チャンネル設定

3. パネル更新
   - パネルは `RankManager` が管理し、定期的（config で指定可能。例: 5分）に更新される。
   - パネルがDiscord上で削除されていた場合はDBから該当パネルエントリを削除し、ログを残す。

4. データ管理
   - データ格納場所: `Data/Guild/<guildId>/rankings.json` または `Guild/<guildId>/rankings/*` の形で保存。
   - 保存する主な情報:
     - rankPresets: プリセット定義（name, ranks[], rewards[]）
     - users: { userId: { xp: number, lastUpdated: ISO, vcAccumMs?: number } }
     - panels: { panelId: { channelId, messageId, presetName, lastUpdate } }
     - settings: notifyChannelId, updateIntervalMs

5. Web UI
   - `web/controllers/RankController.ts` を追加し、`web/modules/rankmanager` でプリセット編集、報酬設定、通知チャンネル、パネル管理が可能。

6. イベント/バッチ
   - メッセージ作成イベントでXPを小幅に増やす（例: 発言ごとに 5 XP、スパム対策のためのクールダウンを導入）。
   - VC参加/離脱イベントで接続時間を計測し、一定単位（例: 1分ごとに 10 XP）で加算。
   - 定期ジョブで未反映のVC時間を集計し、users データに反映。

7. 報酬処理
   - ランクに到達したユーザーに対し、プリセットで指定したアクション（ロール付与、個別メッセージ、Webhook通知など）を実行。
   - 報酬実行前にBotが必要な権限を持っているかチェック。

8. 権限と設定
   - `staff` レベル以上のユーザーのみプリセット/パネル設定が可能（既存の PermissionLevel.STAFF を利用）。

9. テスト
   - `RankManager` のユニットテスト（XP算出、ランク判定、パネル生成ロジック）を用意。

## データモデル（例）

{
  "rankPresets": [
    {
      "name": "default",
      "ranks": [
        { "name": "Bronze", "minXp": 0, "maxXp": 999 },
        { "name": "Silver", "minXp": 1000, "maxXp": 4999 },
        { "name": "Gold", "minXp": 5000, "maxXp": 999999 }
      ],
      "rewards": [ { "rankName": "Silver", "giveRoleId": "...", "notify": true } ]
    }
  ],
  "users": {
    "123456789012345678": { "xp": 2345, "lastUpdated": "2025-10-16T00:00:00.000Z", "vcAccumMs": 3600000 }
  },
  "panels": {
    "panel-1": { "channelId": "...", "messageId": "...", "preset": "default", "lastUpdate": "..." }
  },
  "settings": { "notifyChannelId": "...", "updateIntervalMs": 300000 }
}

## 必要なファイル/モジュール

- `src/core/RankManager.ts` (メインロジック、DB操作、パネル更新、イベント購読)
- `src/commands/staff/subcommands/rank.ts` (staff rank サブコマンドハンドラ)
- `src/commands/any/rank.ts` (/rank コマンド)
- `web/controllers/RankController.ts` (Web API エンドポイント)
- `web/modules/rankmanager` (フロント側 UI)
- テストファイル: `test/rankManager.test.ts`

## 実装手順（高レベル）

1. データモデルとDBスキーマ設計（このTODOに記載）
2. `RankManager` の作成: DB 読み書き、パネル更新タイマー、XP計算API、報酬処理
3. Discord イベントフック: メッセージとVCイベントを RankManager に接続
4. Discord コマンド: `/rank` と `staff rank` を追加
5. Web UI と API: `RankController` とフロントエンドの雛形を追加
6. テストとCI: 単体テストとビルドチェックを追加

## 進め方

- まずは `RankManager` のコア部分を作成し、DB の読み書き、XP の蓄積、単純な `/rank` 表示を実装します。
- 次にパネル・プリセット管理、Web UI を段階的に追加します。

## マイグレーション / 既存データ

- 既存のData構造は保持し、新しい `Guild/<guildId>/rankings.json` を追加する方式を推奨。

## 参考/メモ

- 既存の `Database` シングルトンを利用してデータ保存
- パネル更新はRateLimitに注意（API呼び出し頻度）


## Web UI: `staff/rankmanager` - Google Style レイアウト詳細

目的: スタッフが直感的にランクプリセット/報酬/通知/パネルを管理できる管理画面を提供する。

デザイン方針 (Google Material-ish / Google Style):
- シンプルで読みやすいタイポグラフィ（Roboto 系フォント推奨）
- カードベースのレイアウト。主要操作は上部ツールバーとカード内アクションに集約。
- 一貫した色使い: ギルドのアクセントカラーをテーマに反映可能。
- 明確なモーダルとトースト通知で操作結果をフィードバック。

ページ構成:

1) ダッシュボード（`/staff/rankmanager`）
    - ヘッダー: プロジェクト名 + ギルド選択ドロップダウン + 保存ボタン
    - サマリーカード: 総ユーザー数 / アクティブユーザー（24h）/ 総XP
    - プリセット一覧: 各プリセットはカードで表示、編集/削除/複製ボタンを配置
    - パネル一覧: 現在稼働中のパネルを一覧表示。メッセージプレビュー + 「更新」「停止」「表示先を開く」ボタン

2) プリセット編集ページ（モーダル可）
    - フィールド: プリセット名, 説明
    - ランク定義リスト: 各ランク行で「ランク名 / minXp / maxXp / スタイル（色） / 表示アイコン」を編集可能
    - 報酬タブ: ランク到達時のアクションを定義（ロール付与のドロップダウン、通知フラグ、Webhook URL フィールド、カスタムスクリプト（将来））
    - 保存・キャンセル・プレビュー（Embed の見た目を即時プレビュー）

3) パネル作成ウィザード
    - ステップ1: 対象プリセット選択
    - ステップ2: チャンネル選択（ボットが書き込み権限を持っていないチャンネルは選択不可）
    - ステップ3: 更新間隔（分単位）と表示項目（上位 N 件、個人順位表示の有無）
    - ステップ4: 確認 -> 作成

4) 設定ページ
    - 通知チャンネル設定、デフォルト更新間隔、XPレート（発言あたり・VC毎分）などの初期値を設定

UI コンポーネント要件:
- テーブル（検索・ソート・ページネーション）: ユーザーランキング一覧やプリセット内のランク一覧
- トグル/スイッチ: 通知ON/OFF
- モーダル: プリセット編集・パネル作成
- カラーピッカー: ランクの色選択
- トースト通知: 保存成功/失敗、権限不足などを表示

アクセシビリティ:
- キーボード操作に対応
- カラーモード: 明・暗切替をサポート

API エンドポイント（サーバー側: `web/controllers/RankController.ts`）

- GET /api/staff/rankmanager/presets?guildId=:guildId
   - 説明: プリセット一覧取得
- POST /api/staff/rankmanager/presets
   - 説明: 新規プリセット作成（body にプリセット定義）
- PUT /api/staff/rankmanager/presets/:presetName
   - 説明: プリセット更新
- DELETE /api/staff/rankmanager/presets/:presetName
   - 説明: プリセット削除
- GET /api/staff/rankmanager/panels?guildId=:guildId
   - 説明: パネル一覧取得
- POST /api/staff/rankmanager/panels
   - 説明: パネル作成（body に channelId, presetName, options）
- DELETE /api/staff/rankmanager/panels/:panelId
   - 説明: パネル削除/停止
- PUT /api/staff/rankmanager/settings
   - 説明: ギルド設定（notifyChannelId, updateIntervalMs, xpRates など）保存

セキュリティ/バリデーション:
- すべての API はスタッフ権限確認を行う（セッション/トークンで guildId と権限を検証）
- 入力バリデーション: minXp < maxXp、重複したランク範囲が無いこと、チャンネルIDとロールIDの形式チェック

運用メモ:
- UI で「パネルの強制再作成」ボタンを置くと、消失時の迅速な復旧に便利

## XPレート調整と高度設定（Webで編集可能）

目的: ギルド管理者がチャット/VCでのXP付与ルールを細かく調整できるようにし、コミュニティの性質に合わせた成長ポリシーを設定できるようにする。

主要設定項目（`settings.xpRates` として保存）:
- `messageXp`: 1回の発言で付与される基本XP（例: 5）
- `messageCooldownSec`: 同一ユーザーに対する発言ベースのクールダウン（秒）。クールダウン内の追加発言は無効化または減衰。例: 60秒
- `vcXpPerMinute`: VCに接続していた1分あたりのXP（例: 10）
- `vcIntervalSec`: VC時間計測の粒度（秒）。
- `dailyXpCap`: ユーザーが1日で獲得できる最大XP（0で無制限）
- `excludeChannels`: チャンネルIDの配列（ここではXP付与しない）
- `excludeRoles`: ロールIDの配列（そのロールを持つユーザーにはXPを付与しない）
- `globalMultiplier`: イベントやプロモーション期間用の倍率（例: 1.5）
- `decay`: XPの減衰ルール（無効/週次で%減少など。オプション）
- `customFormulaEnabled` + `customFormula`: 高度ユーザー向けに式を定義できる（例: "xp = base * log(messages+1) + vcMinutes*2"）

UI 上の操作要素:
- スライダー / 数値入力: `messageXp`, `vcXpPerMinute`, `dailyXpCap`
- 数値 + スピンボタン: `messageCooldownSec`, `vcIntervalSec`
- マルチセレクト: `excludeChannels`, `excludeRoles`
- トグル: `customFormulaEnabled`, `decay.enabled`
- テキストエリア（式エディタ）: `customFormula`（式のバリデーションとサンドボックス評価を実装）
- プリセットのインポート/エクスポート: ギルド間で設定をコピー可能

サーバー側のバリデーション（必須）:
- `messageXp`, `vcXpPerMinute` >= 0
- `messageCooldownSec`, `vcIntervalSec` は合理的な上限を設ける（例: 1 <= sec <= 86400）
- `dailyXpCap` は正の整数または0
- `customFormula` は危険な操作（ファイル/ネットワーク等）を行えないサンドボックスで評価

API 拡張（設定関連）
- GET /api/staff/rankmanager/settings?guildId=:guildId
   - 説明: 現在の設定を取得（xpRates を含む）
- PUT /api/staff/rankmanager/settings
   - 説明: 設定更新。body には完全な settings オブジェクトを渡す。サーバー側で権限検査とバリデーションを行う。

監査ログと変更履歴:
- 設定変更は `Data/Guild/<guildId>/rankings_settings_audit.json` などに記録し、誰がいつどの値を変更したか追跡可能にする。

運用上の注意:
- カスタム式や倍率を無制限に開けるとスパムや運用負荷が生じる可能性があるため、UIにガイドラインと推奨値を明示する。
- 設定変更は即時反映するが、パネル更新頻度との整合性を取るため、設定更新後にRankManagerの再計算をトリガーするボタンを用意することを推奨。

## 外部API（サードパーティ連携）

目的: 外部サービス（分析ツール、イベントシステム、ボット運用スクリプト）からランキングデータや操作を安全に行えるREST APIを提供する。

基本方針:
- API はギルド単位で権限分離を行う。APIキーまたは OAuth2 を利用して認可を行う。
- 最小権限の原則: APIキーごとに許可できる操作を限定（例: read-only / xp-write / admin）。
- すべての変更は監査ログに記録。
- レート制限を厳格に設定し、濫用を防ぐ。

推奨エンドポイント（`web/controllers/ExternalRankAPI.ts`）:

- POST /api/external/:guildId/xp/add
   - 説明: ユーザーにXPを付与する（body: { userId, xp, reason })
   - 権限: `xp-write` 以上
- POST /api/external/:guildId/xp/set
   - 説明: ユーザーのXPを直接設定する（body: { userId, xp, reason })
   - 権限: `admin`
- GET /api/external/:guildId/leaderboard
   - 説明: リーダーボードを取得（クエリ: limit, offset, presetName）
   - 権限: `read-only`（公開可能）
- POST /api/external/:guildId/panels/create
   - 説明: パネルを作成（body: { channelId, presetName, options }）
   - 権限: `admin` または `panel-manage`
- POST /api/external/:guildId/panels/:panelId/update
   - 説明: パネルの即時更新をトリガー
   - 権限: `panel-manage`
- POST /api/external/:guildId/presets/import
   - 説明: プリセットをJSONでインポート
   - 権限: `admin`
- POST /api/external/:guildId/recalculate
   - 説明: RankManager に対して全ユーザーの再計算をトリガー
   - 権限: `admin`

認証（APIキー方式 推奨）:
- APIキーは `web/controllers/ApiKeyController.ts` で発行/無効化/一覧管理可能
- APIキーはハッシュ化して保存（平文での保存は禁止）
- リクエストは `Authorization: Bearer <API_KEY>` ヘッダで送る
- キーごとに `scopes` を保存: e.g. `["read-only","xp-write"]`

セキュリティ対策:
- TLS (HTTPS) を必須にする
- レート制限: ギルドごと/キーごとに秒間/分間レートを適用（デフォルト: 5 req/s, 500 req/day）
- IP ホワイトリスト機能（オプション）
- ペイロードサイズ制限、入力バリデーション
- 監査ログ: すべての重要操作 (xp set, preset import, panel create/delete, recalculate) を `Data/Guild/<guildId>/external_api_audit.json` に記録

運用UI:
- `web/controllers/ApiKeyController.ts` と `web/modules/apikeys` を作成して、スタッフがキーの発行・権限付与・無効化を行えるようにする。

利用例:
- 外部イベントで獲得したXPを付与: 外部サービスが `POST /api/external/12345/xp/add` を呼ぶ
- 外部分析ツールがリーダーボードを定期取得: `GET /api/external/12345/leaderboard?limit=100`

注意点:
- 外部APIは強力なので、`admin` 権限のキーは慎重に管理する。可能ならオフラインのキーやシークレット管理を行う。


---

実行: 上記を `TODO.md` に書き込みました。次はこの機能の「RankManager」コアの実装に取りかかれます。もし続けて実装を開始してよければ、どのタスクから始めるか指示ください。
