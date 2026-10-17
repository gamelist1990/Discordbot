# Discord BotのAI分担

2026-10-15。

| 機能 | モデル |
| --- | --- |
| AIChannel・Staff AIの会話とメモリー生成 | `pexAi.channelModel` の生成モデル |
| その他のPEX AI機能 | `pexAi.model` の生成モデル |
| テキストのみのコンテンツ検査 | Jeff decision model (`jeff-base`, `/v1/decide`) |
| 画像・動画を含むコンテンツ検査 | Gemma 4 E4B (`gemma-4-E4B-it`) |
| 旧モデル名 `jev` | Jeff-base (`jeff-base`) へ読み替え |
| 通常チャンネルでのメンションAI | 廃止 |

`MentionAISupportManager` の起動・終了処理、実装、専用テストを削除。
常駐AIチャンネル自体と既存のslashコマンドは維持する。Staff AIもAIChannelと同じ`channelModel`を使い、会話の仕方や設定を共有する。Jeffは`/v1/decide`専用の判定モデルであり、Responses APIや通常の生成には使わない。

## コンテンツ検査

会話モデルのsubmit_verdictツール呼び出しは廃止し、jevへ型付き質問を渡す。
テキストのみの投稿はJeff-baseで判定し、違反らしいスコアが出てもGemmaで再判定しない。画像・GIF・MP4などの視覚入力がある投稿だけGemmaへ送り、Jeff-baseとは併用しない。
6カテゴリについて、Noulで証拠の有無、Scoreで0〜3の強さを1つのshared_stateで評価。
有無の確率が0.5未満ならスコア0。それ以外は `min(有無の確率, 強さ/3)` を0〜1スコアとする。
実入力比較でカテゴリ混同が出たため、カテゴリを限定した英語の質問・候補を使用した。
挨拶と「氷を砕く」は全カテゴリ0、直接の危害予告は脅迫・暴力として検出することを確認。

既存のしきい値、有効/無効、ネタバレ/削除モードを利用する。
説明文は生成させず、結果から決定的に組み立てる。確認した具体的な画像内容を生成するモデルではない。
加点は対象カテゴリの段階評価と上限から算出し、既存のawardScore設定としきい値が適用を決める。
独自ルールの結果が欠落・不正ならエラーにし、違反なしと埋めない。
API失敗や不完全な判定は既存の失敗経路へ渡し、テストで元投稿を保全することを確認。
413時はフレームを分割し、全フレームの最大スコアを集約。画像やキャプションを黙って落とさない。

旧モデルの類似キャッシュを使わないよう、モデルと実際の質問定義・採点設定をcache guardへ含めた。
本文・画像・キャプション・否定・引用の保全処理は維持。

## 設定

`config.json` はGit管理外。既存のトークンとAPIキーを保持して次を設定する。

```json
{
  "pexAi": {
    "endpoint": "http://api.pexserver.com:9000/v1",
    "model": "gemma-4-E4B-it",
    "channelModel": "gemini-3.5-flash-lite",
    "contentSafetyModel": "jeff-base",
    "fallbackModel": "",
    "steps": [{ "model": "gemini-3.5-flash-lite", "level": 3 }],
    "visionModel": "gemma-4-E4B-it"
  }
}
```

認証情報を含むファイル全体をこの例で置き換えない。
`model`と`channelModel`には生成対応モデルを設定する。Jeffはコンテンツ検査専用で、生成モデルとして指定すると`unsupported_endpoint`になる。Staff AIとAIChannelは`channelModel`を共有し、背景のメモリー要約も同じ生成モデルを使う。
古い設定に`model`、`channelModel`、または`steps`の生成先として`jeff-base`/`jev`が残っている場合、起動時にPEX AIの生成既定値（GemmaとGemini）へ補正し、警告を記録する。
コンテンツ検査機能のサーバーごとの有効/無効は変更していない。
このPCに稼働Botは確認できなかったため、Botコードは次回デプロイ・起動で反映。

## 検証

関連37テスト通過。ネタバレ・削除・キャッシュ・画像・加点・不完全判定の保全と、jev型付き結果の検証を含む。
変更したTypeScriptの構文コンパイル通過。全体の型検査ではない。
公開API経由のコンテンツ検査とGeminiのResponsesストリームを確認。Discordへのテスト投稿は行っていない。

ソース: `JevContentClassifier.ts`、`ContentSafetyDetector.ts`、`ChatAIChannelManager.ts`、`config.ts`、`index.ts`。
旧プロンプト・旧ツールプロトコル試験はこの日付のretired資料に保存。

## 古いホスト設定の自動補完

アプリ更新後の起動時に`config.ts`が既存`config.json`を読み、存在しない項目だけを既定値で追加して保存します。`pexAi.contentSafetyModel`が未設定なら`jeff-base`が自動追加されます。既存のモデル、APIキー、未知の項目、空配列や明示値を保持し、二度目以降は変更しません。保存は権限600の一時ファイルから置換します。書込不能なら警告し、実行中の既定値は引き続き適用します。設定ファイル自体の欠落・不正JSONは従来通り起動エラーです。

補完・既存値保持・再実行の2テストを確認済み。

## GIF・MP4の動画検査

GIF・MP4はvideo_urlのbase64データとしてjevへ送ります。サーバーで全時間範囲を16フレーム・最大辺256pxの動画に変換して判定します。Bot側の既存scanImagesで有効/無効を切り替え、maxFileSizeMbとmaxImagesで取得量を制限します。アニメWebPは従来の画像フレーム抽出を維持します。動画の類似判定キャッシュは使わず、同じbytesと本文だけ再利用します。元ファイルはネタバレ代理投稿で保持します。

2026-10-17に推論先をA8へ移しました。テキストのみのコンテンツ検査はJeff-base、画像などの視覚入力がある検査だけGemma 4 E4Bを使用します。公開APIはvideo_urlのGIF/MP4（最大16MiB・120秒）に対応します。
