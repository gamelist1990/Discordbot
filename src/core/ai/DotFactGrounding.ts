/**
 * Lightweight fact grounding for mathematical claims in fast-paced Discord chat.
 * Do not turn banter into a formal math lecture; make jokes about real facts.
 */
export interface DotFactTurn {
    content: string;
    isBot: boolean;
}

const PI = /円周率|π|(?<![a-z])pi(?![a-z])/iu;
const PI_FOLLOW_UP = /割り切|わりきれ|わりきれる|桁|詳しく|くわしく|教え|おしえ|ほんと|本当|間違|ちがう|正しく|計算|小数|無限|終わり|最後|どういう|何(?:で|故)|なぜ|だから|なんで|それ/u;

export function dotPiFactHint(targetContent: string, turns: readonly DotFactTurn[]): string {
    // Only use a fresh contiguous exchange. Earlier unrelated conversation is not proof
    // that an ambiguous "それ" means pi.
    const recent = turns.slice(-8);
    const targetIsPi = PI.test(targetContent);
    const lastPiIndex = recent.findLastIndex(turn => PI.test(turn.content));
    if (!targetIsPi && lastPiIndex < 0) return '';
    if (!targetIsPi && !PI_FOLLOW_UP.test(targetContent)) return '';
    if (!targetIsPi && lastPiIndex < recent.length - 6) return '';
    const previousWrongAnswer = recent.some(turn =>
        turn.isBot && /3141/u.test(turn.content) && !/間違|誤り|ではない|じゃない/u.test(turn.content));
    return [
        '【現在の数学的事実：生成時に必ず守る】',
        'π（円周率）は無理数で、小数は無限に続き循環しない。よって「最後の4桁」「下4桁」は存在しない。',
        '小数点以下の先頭4桁は1415。小数第4位までの四捨五入なら3.1416。πの先頭4文字（小数点を除く）なら3141だが、最後の4桁ではない。',
        '「下4桁で」はジョークや引っ掛けの可能性がある。真面目くさく講義する必要はなく、「最後ないやろｗ」など軽く返すのは自然。',
        ...(previousWrongAnswer ? ['過去のBotが3141を回答した可能性がある。突っ込まれたら言い逃れやごり押しをせず、間違いを認めてから冗談や正しい説明を短く添える。'] : []),
        'この情報を丸写しする必要はないが、間違った数字を自信満々に断定しない。',
    ].join('\n');
}

export function unsupportedDotPiClaim(reply: string, hint: string): boolean {
    if (!hint || !reply.trim()) return false;
    const text = reply.replace(/[\s　、，]/gu, '');
    if (!/3141/u.test(text)) return false;
    // "3141 was my mistake" or "3141 is the first four digits" is fine.
    if (/(?:3141.{0,18}(?:間違|誤|違|じゃない|ではない|ちゃう)|(?:間違|誤|違|じゃない|ではない).{0,18}3141)/u.test(text)) return false;
    if (/(?:頭|先頭|最初|小数点抜|小数点除|上から).{0,20}3141|3141.{0,25}(?:頭|先頭|最初|小数点抜|小数点除|上から)/u.test(text)) return false;
    // A naked "3141やで" or "円周率の下4桁は3141" must not be posted.
    return true;
}
