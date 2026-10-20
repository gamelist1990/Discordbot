# AIファイル出力の重複とプロトコル表示

`output_file` は同一のDiscord interaction内でファイル名と内容のハッシュを確認する。同じ内容の呼び出しは実行中のPromise・送信結果を共有し、Discordへの投稿を重複させない。同名ファイルの内容変更はファイル名ごとに直列化し、最初の添付投稿を編集する。別interactionでは独立して出力できる。

送信結果が不明になった場合は、同じファイルを無条件に再送しない。Discordから返されたMessageを特定できる場合だけ添付を編集する。ファイルのUTF-8本文は加工せず、ツール引数として受け取った内容をそのまま添付する。

送信済みファイルがある最終回答は添付URLで案内する。コードブロックを再び別の添付に変換しない。最終回答が空でも送信済みURLを使って完了でき、ファイルを作り直すための生成へ戻らない。

Responses SSEの `id` / `call_id` / `output_index` の別名を統合し、added/delta/done/completedで同じ呼び出しが繰り返されても1件として扱う。本文deltaとdoneの別名も対応づけ、全文の二重表示を防ぐ。進捗表示もcall_id単位で更新し、output_fileを「ファイル出力」と表示する。

モデルが本文へ漏らした `<tool_call>` / `<function=...>` / `<parameter=...>` 等はチャンク境界をまたいで非表示にする。そのXMLからツールを実行することはない。実行対象は登録済みツールへの構造化されたfunction callのみ。ツール本文にはHTML中の閉じタグが含まれ得るため、漏出マーカー以降はそのモデル応答の末尾まで表示せず、後続のモデル応答ではフィルタを新しく作る。実ファイルの本文にはこのフィルタを適用しない。

検証:

```bash
bun test tests/staff-ai-file-idempotency.test.ts tests/tool-protocol-stream.test.ts tests/chat-ai-tool-call.test.ts tests/ai-progress-guard.test.ts tests/staff-ai-search-fetch-output.test.ts tests/chat-ai-tool-round-limit.test.ts tests/web-search-feedback.test.ts
bun node_modules/typescript/bin/tsc --noEmit
```

44テスト・型チェックを通過。重複/同時要求、同名の内容更新、送信状態不明、本文保全、最終リンク、進捗重複、チャンクを1〜32文字で分割したXML漏出、および実SDKの模擬SSEを検証した。EndPointの実モデルへも送信処理なしの生成確認を行い、構造化output_fileが1件、本文のXML漏出なしとなることを確認した。

広げたANSI表示テストのうち1件は、現行フッターと古い期待文字列の不一致で失敗する。同じ失敗は変更前のStaffAIStreamStateでも再現し、この変更には含めていない。
