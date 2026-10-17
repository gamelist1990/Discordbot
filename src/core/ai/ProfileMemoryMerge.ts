function isEmptyFact(value: string): boolean {
    return /^(?:(?:[-*・]\s*)?(?:興味・話題|得意分野・活動|観測できる話し方|公開可能な趣味)[:：]\s*)?[（(]?(?:特になし|なし|不明|情報なし|この期間の発言では判断できる材料なし)[）)]?[。.]?$/.test(value.trim());
}

/** Automatic profile updates may add facts, but never replace existing facts. */
export function appendProfileFacts(previous: string | undefined, additions: string | undefined, maxLength: number): string {
    let content = previous?.trim() || '';
    if (isEmptyFact(content)) content = '';
    const signature = (line: string): string => line.normalize('NFKC')
        .replace(/^\s*[-*・]\s*/, '').replace(/\s+/g, '').replace(/[。.]$/, '').toLowerCase();
    const known = new Set(content.split(/\r?\n/).map(signature));
    for (const line of (additions || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
        if (isEmptyFact(line) || known.has(signature(line))) continue;
        const updated = content ? `${content}\n${line}` : line;
        // Preserve old facts verbatim, including when the profile is full.
        if (updated.length > maxLength) continue;
        content = updated;
        known.add(signature(line));
    }
    return content;
}

export function mergeProfileMemory<T extends { content: string; publicInterests?: string; evidenceCount: number }>(
    previous: T | undefined,
    incoming: T,
): T {
    return {
        ...incoming,
        content: appendProfileFacts(previous?.content, incoming.content, 6000),
        publicInterests: appendProfileFacts(previous?.publicInterests, incoming.publicInterests, 1000),
        evidenceCount: Math.max(previous?.evidenceCount || 0, incoming.evidenceCount),
    };
}
