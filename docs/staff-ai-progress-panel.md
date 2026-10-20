# /staff ai の完了後の詳細メニュー

ネイティブEmbedが使え、ツールを3件以上使った回答は、完了後のEmbedを件数・Thinking受信文字数・トークン統計だけにまとめます。生成中は従来どおりThinkingとツールの進捗をリアルタイムに表示します。

回答下のドロップダウンから、操作した人だけに見える詳細パネルを開けます。

- 概要（折りたたむ）
- ツール履歴
- Thinkingとツールの時系列
- 失敗・未完了
- Thinkingの概要

詳細は1ページ6件ずつ表示し、前へ・次へで古い履歴も確認できます。「折りたたむ」で概要へ戻ります。元の回答本文・添付ファイルは変更しません。ツールが2件以下の場合とEmbed権限がない場合は従来の表示を維持します。

履歴は既存のDatabaseに保存し、Bot再起動後も参照できます。保存内容はツール名・安全な引数の要約・結果の要約・実行時間・Thinkingの受信文字数です。Thinking本文、ツール引数のJSON、回答本文は保存しません。詳細は元の回答と同じサーバー・チャンネルからのみ開けます。保存に失敗した場合は元のインライン表示を維持します。

検証: `npx tsx --test tests/staff-ai-progress-panel.test.ts tests/staff-ai-live-tools.test.ts tests/discord-response-formatting.test.ts` と `npx tsc --noEmit`。
