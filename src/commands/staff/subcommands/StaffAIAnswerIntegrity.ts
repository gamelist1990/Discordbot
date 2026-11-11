/**
 * Guard the /staff ai answer from echoes of Discord channel-history metadata.
 * A text-only model output must not masquerade as a fresh uploaded picture.
 */
export function protectStaffAnswerFromHistoryLeak(answer: string, verifiedDrawing: boolean): string {
    if (verifiedDrawing) return answer;
    const imageClaim = /(?:^|\n)\s*(?:🎨\s*)?[A-Za-z0-9][A-Za-z0-9._-]*\.png\s*[（(](?:\d+回目?の描画|\d+回の描画で完了)[）)]/im.test(answer);
    const copiedAttachment = /\[添付:\s*(?:画像|ファイル):\s*[^\]\n]{1,200}\]/.test(answer);
    if (imageClaim && copiedAttachment) {
        // The tool did not confirm a Discord upload. Never repeat fabricated
        // "attached" metadata as if it were an actual attachment.
        return '⚠️ 過去の画像投稿の情報が回答に混入しました。今回、新しい画像の生成・添付は確認できていません。画像を作る場合は、作りたい絵を「描いて」と指定してください。';
    }
    // Provenance brackets belong to prompt context only, never to the answer.
    return answer
        .replace(/(?:^|\n)\s*\[添付:\s*[^\]\n]*\]/g, '')
        .replace(/(?:^|\n)\s*\[この投稿の返信先:\s*[^\]\n]*\](?:[^\n]*)?/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
