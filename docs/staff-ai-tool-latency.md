# ツール実行後の応答待ちを減らす

Responses APIでは `response.completed` に最終出力・ツール呼び出し・usageが含まれるため、このイベントを処理したらストリームの読み取りを終了します。プロキシがHTTP接続の終了を遅らせても、ツール実行・次のモデル呼び出し・回答の完了を待たせません。途中の引数deltaだけでツールを実行する処理には変更していません。

読み取り系のツールは同じバッチ内で最大3件並列に実行します。結果は元のcall_idと並び順を維持してモデルへ返します。共有メモの変更、予約作成・取消、ファイル出力、未知のツールは実行順を維持し、前後の読み取りがまたがないようにします。ResponsesとChat Completionsの両方で同じ実行方針を使います。ネイティブのparallel_tool_callsは通常のツール選択で有効にし、強制ツール指定中は無効にします。

Discordの進捗はスナップショットごとに時系列を含むため、未送信の古い更新は2件まで保持します。最新のThinkingや回答が古い状態表示8件分の後ろに並ぶ問題を抑えます。完了後の履歴データは省略しません。

`continuation-first-delta` ログの `waitMs` は、ツール後のモデルリクエストから最初のテキスト／Thinking受信までを表します。モデル自体の推論、上流の混雑、レート制限待ちは別途発生します。

現在のローカルllama.cpp実装は `previous_response_id` を明示的に拒否するため、既存の会話入力とfunction_call対応を維持しています。未対応の状態継続APIへ切り替えて高速化したことにはしていません。

仕様参考: [OpenAI Function calling](https://developers.openai.com/api/docs/guides/function-calling)、[Responses API](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create)。

検証は `tests/tool-call-latency.test.ts` にあり、完了イベント後もHTTPを閉じない実SSEサーバー、並列数上限、空いた実行枠の再利用、call_idの対応、変更操作の直列性、中断時の読み取り完了待ち、進捗キューを確認します。
