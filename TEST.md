## Web UI テスト (Playwright) 追加メモ

このリポジトリで Web のコーディングを行う際は、必ず Playwright を使って主要な UI フローを E2E テストで検証してください。



セットアップ（PowerShell）:
```powershell
npm install
npx playwright install --with-deps
```

起動・テスト実行（ローカル開発）:
```powershell
# webDebug を使ってフロントをビルドしてサーバを起動する例（必要に応じて環境変数をセット）
$env:WEB_DEBUG_BYPASS_AUTH='1'
$env:WEB_DEBUG_NO_PERSIST='1'
$env:WEB_DEBUG_PORT='3001'
npm run webDebug

# 別ターミナルで Playwright テストを実行
npx playwright test
```

重要: webDebug モードには WEB_DEBUG_BYPASS_AUTH があり、/__debug/create-session を叩いてテスト用セッションを作成できます。Playwright のテストではこの endpoint を呼んで Set-Cookie をブラウザコンテキストに注入すると認証済み状態でテストが可能です。

推奨テストシナリオ例:
- Profile Edit Save: ログイン → /profile にアクセスして 302 リダイレクトを確認 → /profile/:username/edit で表示名・bio を編集 → 画像（小さい Base64）をアップロード → 保存 → /profile/:username に変更が反映されることを確認
- Redirect behavior: 未ログイン時の /profile アクセス挙動（ログイン誘導）とログイン時の 302 を検証
- Emoji/Sticker: ギルド絵文字ピッカーから絵文字を追加し表示されること、ステッカーの配置・サイズ変更が保存されること
- Responsive: デスクトップ幅とモバイル幅で主要レイアウトが壊れていないこと（Playwright の viewport を切り替えて検証）

テストのベストプラクティス:
- テストは小さなシナリオに分割する（1 テスト = 1 期待動作）
- setup/teardown で webDebug のテストセッションを作成・破棄する
- 画像の検証はピクセル単位ではなく、DOM に正しい data URL が設定されている/要素の存在を確認する方針にする
- 大きな Base64 は CI 負荷になるため、テスト用は軽量なダミー画像を使う

CI 統合（メモ）:
- CI では npx playwright install --with-deps を実行してブラウザを用意し、npm run webDebug（またはサーバ起動スクリプト）をバックグラウンドで起動してから npx playwright test を実行してください。
- 失敗時はスクリーンショットと trace を保存する設定を有効化するとデバッグが容易になります。

参考ファイル:
- 既に test/playwright/layout.spec.ts が存在します。プロフィール関連の E2E はこのディレクトリに追加してください。

次の作業候補（この TODO に従って作業を進める）:
1. todo.md に Playwright 手順を追加（完了）
2. test/playwright/profile.spec.ts の実装（プロフィール編集/表示/リダイレクトの E2E）
3. CI ワークフローへ Playwright 実行ステップを追加

