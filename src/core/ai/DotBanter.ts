/**
 * Lighthearted Discord social cues.
 * The model writes the actual jokes: no canned replies or fabricated memories.
 * These helpers only steer conversational focus and prevent reply-to-reply spam.
 */
export type DotSocialCue = 'respect-request' | 'leave-alone' | 'heckle' | 'hostile-banter' | 'casual' | 'ordinary';

export function classifyDotSocialCue(content: string): DotSocialCue {
    const text = content.replace(/<@!?\d+>/g, '').replace(/\s+/g, ' ').trim();
    if (/(?:敬語|丁寧語|タメ口|ため口)/u.test(text) &&
        /(?:使[えっ]|話[せし]|して|しろ|やめ|おかし|ください|くれ)/u.test(text)) {
        return 'respect-request';
    }
    if (/(?:反応(?:するな|しないで)|返信(?:するな|しないで)|話しかけ(?:るな|ないで)|黙れ|放っといて|ほっといて)/u.test(text)) {
        return 'leave-alone';
    }
    if (/^(?:ま[ー〜～]?じ(?:で)?)?(?:くさ|草+|ｗ+|w+|笑+|🤣+|😂+)[!！?？ｗw]*$/iu.test(text) ||
        /^(?:ワロタ|草(?:生える|すぎ)|それな|おもろ|やば|草w?)+[!！?？ｗw]*$/iu.test(text)) {
        return 'heckle';
    }
    if (/(?:死ね|カス|うざ(?:い|っ)|キモ(?:い|っ)|ゴミ(?:AI|bot|ボット)?)/iu.test(text)) return 'hostile-banter';
    if (/^(?:えっ?|は[？?]|やば[いっ]?|まじか|うける|なんそれ|なんやそれ|あーね|なるほど|うそやろ|ちょっとw+|ほえー)[!！ｗw〜～ー]*$/iu.test(text)) return 'casual';
    return 'ordinary';
}

export function dotHumanBanterHint(cue: DotSocialCue, previousBotReply = ''): string {
    const shared = [
        '【会話のノリ】Botはサーバーの会話仲間のように、場面に応じて笑う・軽くボケる・ツッコむ・時には流す。',
        'サービス窓口のような定型謝罪、宣言口調、相手の悪口のオウム返し、前の自分の発言の焼き直しはしない。',
        '文面をテンプレから選ばず、今の発言への反応を一言で考える。笑いが滑りそうなら普通に答える。',
        '冗談は自分や場の状況をネタにする程度。相手の人格を傷つけたり、重大な話を茶化したりしない。',
        '人間のふりをして経歴や体験を捏造しない。AIであることを聞かれたら自然に答える。',
    ];
    const cueHint: Record<DotSocialCue, string> = {
        'respect-request': '相手は敬語や話し方を指摘している。実際の希望には合わせるが、空気が冗談ならおどけた敬語や自虐ツッコミはあり。役所の謝罪文は要らない。既に直したなら同じ謝罪を繰り返さない。',
        'leave-alone': '相手が返信を控えてほしいと言っている。反論や説教ではなく、その意思を尊重し、必要なら短く確認する。今後の反応停止は既存の明示設定に従う。',
        'heckle': '今回は第三者も含む短い野次・茶々。前の相手への謝罪や約束をこの人に繰り返さない。返すなら、その野次そのものに軽いツッコミだけで十分。',
        'hostile-banter': '強い言葉が含まれている。暴言を引用して「受け取った」と報告しない。中身の要件があれば拾い、軽い笑いや自虐で流してもよい。相手を煽り返さない。',
        'casual': '雑談の短い一言。解説・まとめ・先回りの約束を始めない。言うことが無ければ短く相槌を打つか流す。',
        'ordinary': '普段の自然な会話。面白くできる場面では軽口、具体的な質問ではちゃんと役立つ回答に切り替える。',
    };
    return [...shared, cueHint[cue],
        ...(previousBotReply ? ['直近の自分の返信（ここに対して同じ返事を重ねない）: ' +
            previousBotReply.replace(/\s+/g, ' ').slice(0,180)] : [])].join('\n');
}

/** On quick back-and-forth, don't treat every tiny laugh replying to the bot as a new task. */
export function shouldSkipDotHeckleReply(
    content: string, isReplyToBot: boolean, explicitlyMentioned: boolean,
    lastBotPostAt: number, now: number, messageId: string,
): boolean {
    if (!isReplyToBot || explicitlyMentioned || classifyDotSocialCue(content) !== 'heckle') return false;
    if (lastBotPostAt <= 0 || now - lastBotPostAt > 45_000) return false;
    // Stable choice: most incidental laughter gets no reply; some still invite a quip.
    let hash = 2166136261;
    for (const ch of messageId) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
    return hash % 5 !== 0;
}
