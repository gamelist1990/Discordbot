# Discord Bot AI 構成（2026-10-30）

## モデルと担当

| 用途 | モデル・推論先 |
| --- | --- |
| 通常の PEX AI 生成・staff AI の既定 | `nemotron-bolt` / A8 |
| AI チャンネル・日次要約・性格生成 | `gemini-3.5-flash-lite` / Gemini API（既定） |
| 全コンテンツ検査（テキスト・画像・GIF・MP4） | `lfm3` / HomePC |
| 通常チャンネルのメンション AI | 廃止 |

HomePC EndPoint（ポート 9000）は現在 `gemini-3.5-flash-lite`、`nemotron-bolt`、`lfm3` を公開します。
LFM3-VL-2B は HomePC の user systemd `lfm-vision.service` で稼働し、Tailscale `100.83.127.8:18670` に bind しています（ctx 16384、並列2、`--reasoning on --reasoning-budget 128`）。
旧 Jeff / Jev / Qwopus / Gemma のコンテンツ分類器は削除されています。A8 の Jeff 本体・キャッシュも撤去済みです。EndPoint の `/v1/decide` ルートだけは残しますが、`jev` プロバイダーはありません。
古い生成モデル名 `qwopus-coder` は起動時 `nemotron-bolt` に読み替え、コンテンツ検査の `jeff-base` / `jev` は `lfm3` に読み替えます。

## 設定

以下は `config.json` の一部です。Git 管理外の設定ファイル全体は上書きせず、既存の認証情報や個別設定を保護してください。

```json
{
  "pexAi": {
    "endpoint": "http://api.pexserver.com:9000/v1",
    "model": "nemotron-bolt",
    "channelModel": "gemini-3.5-flash-lite",
    "contentSafetyModel": "lfm3",
    "visionModel": "lfm3"
  }
}
```

通常の生成には `pexAi.model` / `pexAi.channelModel`、コンテンツ検査には `LfmContentClassifier.ts` の `lfm3` を使います。`src/config.ts` に古いモデル名の読み替え処理があります。

## AI の性格

staff AI と AI チャンネルに共通する、親しみやすいロールプレイ定義が `GuildAIPersonality.ts` にあります。
初回利用時に AI 自身が名前・性格・話し方・振る舞いを生成し、ギルド単位で保存します。失敗時は組み込み性格を使用します。
staff AI WebUI に「AIの性格」表示と「性格を再生成」操作があります。人間を装わず、正確性と安全性を優先します。
ユーザー別 AI メモリー機能は廃止済みで、日次要約とカスタムメモは別機能です。

## 検査メディアと運用

投稿の本文・画像・GIF・MP4 はすべて LFM3 で JSON schema 形式の6カテゴリ判定を行います。GIF は Sharp、MP4 は `ffprobe` と `ffmpeg` でフレームを抽出し、複数の画像を1枚のシートに合成します。
詳しくは [content-safety.md](./content-safety.md) を参照してください。

```bash
systemctl --user status lfm-vision.service
curl http://100.83.127.8:18670/v1/models
npx --no-install tsc --noEmit -p tsconfig.json
cd src/web/client && npx --no-install tsc --noEmit -p tsconfig.json
```

Bot 本番更新の前に実画像・GIF・MP4 の経路、誤検知、WebUI の再生成操作、ロールバックを検証してください。GitHub push と本番 Bot のデプロイは別工程です。
旧構成の履歴は `WorkSpace/engineerDocs/discordbot/` を参照してください。


2026-10-31: LFM3 のコンテンツ検査では思考を有効化し、最終JSONを判定します。通常の推論と異なり思考と前後文脈の取り込みで遅延が増えるため、Bot側では処分前の会話再確認・失敗時保全を行います。
