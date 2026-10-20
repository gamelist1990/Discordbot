# AIの進展停止検出

ツール呼び出しの総回数には上限を設定しない。`ChatGPTClient` は公開の1リクエストごとに `AIProgressGuard` を作り、`AsyncLocalStorage` でResponses、通常/ストリーミングChat Completions、ツール実行へ共有する。別リクエスト・並行リクエストへ状態を持ち越さない。

- 失敗・空結果・既取得の結果が3回続く、または同じ処理結果が3回登場した場合は進展停止と判断する。検索・取得では検索語の言い換えだけで進展扱いにせず、結果本文の変化を確認する。順位・並び順・検索日時・検索元などのメタデータだけの変化は除く。他の操作は引数も結果の比較に含め、違う対象への操作を同じ処理とみなさない。
- 同じツールラウンドで実行済みの別処理が新たな情報を返した場合は、進展を回復できる。新しい結果が得られ続ける調査には総回数制限を適用しない。
- 進展が止まった次のモデル要求では `tool_choice: none` と終了指示を送る。取得済みの情報を保持し、確認できた範囲と不明点を答えさせる。強制ツールシーケンスより終了判断を優先する。
- モデルが `tool_choice: none` を無視しても追加ツールは実行しない。回答を返さずusage/thinkingだけで終了した場合も、確認できなかった旨の最終文を返す。
- Thinking/本文で「検索結果が空なので再検索する」等の同じ再試行文を4回検出したら、生成を打ち切る。チャンク境界をまたいで検出し、通常の詩・短い返事・コードフェンス・明示的な引用は反復だけを理由に止めない。
- 停止シグナルをモデル/接続先フォールバックへ回さない。停止時はUIへ確認不能の最終文を一度返す。ユーザーによる中断は停止文に置き換えず、元の中断として扱う。

`web_search` は `SEARCH_EMPTY`（結果取得0件）、`SEARCH_UNAVAILABLE`（検索元障害を伴う0件）、`SEARCH_ERROR`（HTTP/通信/応答形式の失敗）を区別する。空結果を情報不存在の証拠として扱わない。EndPointからの `warnings` と `searched_at` もモデルへ渡す。

検証:

```bash
bun test tests/ai-progress-guard.test.ts tests/web-search-feedback.test.ts tests/chat-ai-tool-round-limit.test.ts tests/chat-ai-tool-call.test.ts tests/staff-ai-tool-routing.test.ts tests/staff-ai-search-fetch-output.test.ts tests/staff-ai-research.test.ts
bun node_modules/typescript/bin/tsc --noEmit
```

46テストと型チェックを通過。実SDKのローカルSSEストリームで反復Thinkingを再現し、通信が終了して最終文を返すことも確認した。これは進展のない反復を検出する対策であり、内容の真偽を判定するものではない。取得結果の表現を毎回変える等、すべての意味的なループを検出できるとは限らない。
