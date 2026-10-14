# 最適化Qwenへの接続

このBotの通常会話、メンションAI、性格診断・議論、テキスト安全性判定は
`config.pexAi.model` を共通で使用します。既定値は
`qwen3.5-4b-ja-en-vulkan` です。

## 別環境へ反映する場合

Git管理外の `config.json` に以前のモデル指定が残っていると、その指定が
既定値より優先されます。既存の認証情報は保持したまま、次の項目を変更して
Botを再起動してください。

```json
{
  "pexAi": {
    "endpoint": "http://api.pexserver.com:9000/v1",
    "model": "qwen3.5-4b-ja-en-vulkan",
    "fallbackModel": "",
    "steps": [{ "model": "qwen3.5-4b-ja-en-vulkan", "level": 3 }],
    "visionModel": "",
    "level": 3
  },
  "openai": {
    "apiEndpoint": "http://api.pexserver.com:9000/v1",
    "defaultModel": "qwen3.5-4b-ja-en-vulkan",
    "proxyEndpoints": []
  }
}
```

これは変更項目の例です。ファイル全体を置き換えず、既存の `apiKey`、
Discordトークン、その他の設定を保持してください。
汎用ChatGPTClientにも同じプロキシの認証情報を `openai.apiKey` に設定します。
`level` は利用中の設定に合わせてください。

## テキスト専用モデルの動作

この最適化版には画像認識用プロジェクターを接続していません。
`visionModel` が空の場合、メンションAIとAI会話は画像を推論APIへ送信せず、
画像内容を文章で説明してもらうよう促します。
画像の安全性判定は未対応エラーとして扱い、判定済み・安全とは扱いません。

このPCのEndPointでは公開モデルを最適化Qwenの1つだけに整理しています。
Gemmaや比較用Qwenのモデルファイルは保持していますが、公開定義には含めません。
EndPointの設定・エンジンはこのDiscordbotリポジトリには含まれません。

## 検証

- BotのOpenAIChatManagerから公開APIのモデル一覧とResponsesストリームを確認。
- メンションAI・テキスト安全性判定の関連テストは20/21通過。
- 残る1件は、変更していない安全性プロンプトに古い文言を要求する既存テスト。
- 変更したTypeScriptファイルの構文コンパイルを確認。
- Discordへのテスト投稿は行っていません。
