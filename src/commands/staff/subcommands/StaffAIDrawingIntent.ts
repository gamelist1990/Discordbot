/** Current user instruction only; never classify quoted history or reply metadata. */
export function isStaffDrawingRequest(prompt: string): boolean {
    const text = prompt.trim();
    if (!text) return false;
    // Referencing an existing image or asking a question must not send a drawing tool.
    if (/描ける[？?]|描いた[よ！!。]|描かれた|描いてある|生成された|生成できる[？?]/.test(text)) return false;
    if (/(?:描いて|描け|描画して|作図して|イラスト(?:を|が)?(?:作って|描いて|生成して)|絵(?:を|が)?(?:作って|生成して)|ロゴ(?:を|が)?(?:作って|作成して|生成して|描いて)|画像(?:を|が)?(?:作って|作成して|生成して)|SVG(?:を|で)?(?:作って|描いて|生成して)|PNG(?:を|で)?(?:作って|描いて|生成して))/.test(text)) return true;
    return /(?:draw|generate)\s+(?:an?\s+)?(?:image|illustration|svg|logo|picture)/i.test(text);
}
