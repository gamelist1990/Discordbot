# Web管理画面

プライベートチャット、ロールプリセット、Coreパネル、ランキング、Todo、参加・退出ログは `components/Workspace` の共通UIを利用する。
サーバーを切り替えると編集状態を破棄し、古い取得リクエストは中止する。未保存の設定はサーバー・チャンネルの切り替え時に確認する。

チャンネル管理のページ・API・ツール一覧への導線は削除済み。Discord上の既存チャンネルや保存済み設定を削除するマイグレーションはない。

## プロフィール

- 検索はログイン必須。共通サーバーの公開プロフィールだけを最大20件返す。ユーザーごとに検索間隔を制限する。
- 新規プロフィールは非公開。本人だけがセッションのユーザーIDで更新できる。
- 公開設定はAPIでも適用し、非公開プロフィールの統計・所属情報を返さない。公開データから編集用ウィジェットのギルドIDも除外する。
- `profileSafety.ts` は保存時・既存データの読み込み時・画面表示時に利用する許可リスト。文章はReactのテキストとして表示し、HTML/JavaScriptは実行しない。
- URLはhttp/https、色はHEX、装飾は指定項目・範囲に制限。プロフィールのユーザーID・取得日時・バッジは本人の入力で書き換えられない。
- ブラウザーの書き込み要求はOriginを検証する。許可するサイトは `BASE_URL` と、必要な場合の `WEB_BASE_URL`。ローカル開発でViteの別Originを利用する場合は `WEB_BASE_URL` に明示する。
- SPAにはインラインスクリプト・イベント属性の実行を許可しないCSPを付与する。既存のプレビュー専用HTMLは別ハンドラーで処理する。

## 確認

```sh
npx tsx --test tests/profile-security.test.ts
npm run web
```

画面テストは実際のDiscordを変更せず、APIを模擬する。Viteを5181番ポートで起動して実行する。

```sh
node tests/workspace-ui-smoke.mjs
ANTICHEAT_UI_CHANNEL=chrome npx tsx tests/anticheat-ui-smoke.mjs
```

ブラウザーが別の場合は `WORKSPACE_UI_CHANNEL` / `ANTICHEAT_UI_CHANNEL` で指定できる。
