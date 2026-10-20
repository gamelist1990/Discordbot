/** File artifacts are delivered by tools, with a complete body and a verified URL. */
export const AI_FILE_OUTPUT_POLICY = [
    'ファイルの作成・出力・添付を頼まれたら、説明やコードの貼り付けだけで完了せず、利用可能なファイル出力ツールを実際に呼び出してください。',
    'ファイル本文はMarkdownのコードフェンスや前置きを含めず、UTF-8の完成した全文をcontentに入れてください。冒頭・タイトルだけ、途中で切れたHTML、未実装の機能、意図しない省略記号で依頼を完了したことにしてはいけません。',
    'ツールはAPIの構造化されたfunction callで呼び出してください。tool_call・function・parameterなどの制御タグ、XML、呼び出しを模したコードを回答本文に書いても実行にはなりません。',
    '作成成功とDiscordへの添付成功を区別し、送信成功の結果を確認する前に「添付した」「出力した」と主張しないでください。同じ完成ファイルを何度も送信せず、成功後は再試行を終えてください。送信状態が不明なら未確認と伝え、確認なしに再送しないでください。',
    '最終回答は送信成功したファイル名と、ツールが返した実際のURLのMarkdownリンクで簡潔に案内してください。URLを推測・捏造せず、ファイル本文・長いコードブロック・ツール呼び出し内容を再掲しないでください。',
].join('');

export const STAFF_FILE_OUTPUT_FLOW = [
    'この依頼は実際のファイル出力です。output_fileにfilenameとcontentを渡すと、作成とDiscordへの添付を1回で行います。FILE_UPLOADEDの結果にあるURLを最終回答で案内してください。',
    'FILE_UPLOADEDを受け取った同じファイルは再送しないでください。実際に内容の修正が必要な場合だけ、修正した全文を同名でoutput_fileに渡してください。同名の修正は元の添付投稿の更新になります。',
].join('');

export const CHANNEL_FILE_OUTPUT_POLICY = AI_FILE_OUTPUT_POLICY + [
    'このチャンネルではcreate_text_fileでファイルを作成し、その成功後に同じファイル名でupload_filesを呼んでDiscordへ添付してください。TEXT_FILE_CREATEDだけでは送信完了ではありません。',
    '作成済みファイルを添付するためだけに作り直さず、upload_filesの送信成功と実際のURLを確認してから回答してください。対応するテキスト形式で1ファイル256KiB以下にし、作成したコードを実行しないでください。',
].join('');
