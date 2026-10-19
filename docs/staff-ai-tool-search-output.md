# /staff ai — 履歴検索・直接取得・ファイル出力

この更新は **Discordの `/staff ai` コマンド専用** です。常駐AIチャンネル（`ChatAIChannelManager`）のツール構成は変更していません。

## Discord履歴検索

`search_channel_messages(query, channel_id?, scan_limit?, limit?, before?)` はDiscord APIを使い、指定チャンネルの履歴を最大100件ずつ遡って、本文をキーワード部分一致で検索します。

- 省略時は現在のチャンネルを検索
- 1回のスキャンは初期500件、最大1,000件
- 見つかったメッセージには発言者・日時・本文抜粋・元メッセージURLを付与
- さらに古い範囲へは `next_before` を次の `before` に指定
- 実際にDiscordから取得できない投稿は推測で補いません

`fetch_discord_message(message_id?, message_url?, channel_id?)` は指定したメッセージを直接取得し、本文・添付リンク・日時・投稿者・元リンクを返します。

どちらも同一Discordサーバーのみで動作し、**依頼したスタッフ本人とBotの双方に ViewChannel および ReadMessageHistory がある場合**に限り使用できます。既存の `collect_channel_history`、`fetch_message_link_context` も安全性を揃え、直近履歴・周辺文脈用途向けに残します。

## URLの直接取得

`fetch_url(url, mode?)` は公開HTTP/HTTPS URLへ直接アクセスします。`mode: readable`（既定）はHTMLの本文・見出しを抽出、`mode: raw` はソースを取得します。本文最大16,000文字、ダウンロード最大512KiB、タイムアウト12秒。ローカルIP等は拒否し、リダイレクト先も再検証します。

## ファイル出力

`output_file(filename, content)` でHTML/Markdown/JSON/CSV/コード等のUTF-8テキストをDiscordへ **1回で添付** します。

- 最大256KiB、対応する安全な拡張子のみ
- ファイル名にディレクトリを含めることは禁止
- `interaction.followUp` で実際にDiscordへ送信し、添付URLを結果に含める
- ファイル出力依頼時はこのツールを強制指定して認識漏れを防止
- 実送信をしていないテストではダミーのツール結果を使い、投稿しません

### 操作例

- `/staff ai prompt:先週このチャンネルで「アップデート」について何を話してた？検索して`
- `/staff ai prompt:このメッセージを取得して https://discord.com/channels/...`
- `/staff ai prompt:https://example.com のページを直接読んで概要を教えて`
- `/staff ai prompt:説明をreport.mdファイルにして添付して`

必要なツールだけをリクエストへ登録し、不要なツールスキーマのオーバーヘッドを避けます。
