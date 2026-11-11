/**
 * Speaker-only perspective on a Discord conversation.
 * Each original message keeps its author; short fragments by the same speaker
 * remain attached to that speaker even if other people interject between them.
 */
export interface DotSpeakerLine {
    id: string;
    authorId: string;
    authorName: string;
    content: string;
    isBot: boolean;
}

export function compactDotConversationNoise(text: string): string {
    return text.replace(/\s+/g, ' ')
        .replace(/(.{2,18}?)\1{4,}/gu, (_all, phrase: string) => phrase + '（連呼省略）')
        .slice(0, 300)
        .trim();
}

export function formatDotSpeakerEvidence(lines: readonly DotSpeakerLine[], botId?: string): string {
    const speakers = new Map<string, { name: string; statements: string[] }>();
    for (const line of lines) {
        if (line.isBot || line.authorId === botId) continue;
        const content = compactDotConversationNoise(line.content).slice(0, 150);
        if (!content || /^[wｗ笑\s!！?？]+$/.test(content)) continue;
        let speaker = speakers.get(line.authorId);
        if (!speaker) {
            speaker = { name: line.authorName.slice(0, 52), statements: [] };
            speakers.set(line.authorId, speaker);
        }
        speaker.statements.push(content);
        if (speaker.statements.length > 24) speaker.statements.shift();
    }
    const sections: string[] = [];
    for (const [id, speaker] of [...speakers].slice(-8)) {
        sections.push('- ' + speaker.name + ' (userId=' + id + '): '
            + speaker.statements.map(statement => '「' + statement + '」').join(' / '));
    }
    if (sections.length === 0) return '';
    return [
        '【発言者別の原文・所有者の確認用】',
        ...sections,
        '※各「」は行頭の人が投稿した。誰が「ゲットした」「持っている」と言ったかを厳密に区別する。',
        '※相手の話題と本人の所持品を混同しない。不明な所有者は断定しない。',
    ].join('\n').slice(0, 4200);
}
