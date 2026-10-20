# Headless Chromeを使うWeb検索

`web_search` はEndPointの `/v1/web/search` へ `read_pages: true, page_count: 3` を渡します。EndPointは検索結果の上位3サイトをHeadless Chromeで開き、JavaScript描画後の本文をMarkdownへ変換します。応答の `markdown` をAIへ渡し、本文取得成功・検索スニペットのみ・本文取得失敗を区別します。ツール待ち時間は検索とChrome描画を含め45秒です。

この環境のEndPointソースは `/home/pexserver/WorkSpace/EndPoint` にあります。`tools/web-reader` のNodeワーカーと `apps/api/src/api/routes/web_search/browser.rs` に本文取得処理を追加しました。EndPointはGit管理されていないため、DiscordBotのリポジトリには含まれていません。

EndPointのセットアップ:

```bash
cd /home/pexserver/WorkSpace/EndPoint
npm ci --prefix tools/web-reader
cargo build -p endpoint-api
```

Node.js 20以降とGoogle Chromeが必要です。Chrome標準パスは自動検出します。必要なら `WEB_SEARCH_CHROME_PATH`、`WEB_SEARCH_NODE`、`WEB_SEARCH_BROWSER_SCRIPT` を指定します。Chromeは再利用し、ページ単位で一時コンテキストを分けます。本文は1サイト6,000文字、同時3ページ、60秒キャッシュです。ブラウザー使用中や取得失敗時も検索一覧と注意事項を返します。

更新後はEndPointとDiscordBotのプロセスを再起動してください。
