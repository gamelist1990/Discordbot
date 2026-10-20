import { createHash } from 'node:crypto';

export class AIProgressStalledError extends Error {
    constructor() { super('AI request stopped because research was repeating without progress.'); }
}

export const AI_LOOP_STOP_MESSAGE = '同じ検索や再試行の繰り返しを検出したため、調査を停止しました。必要な事実を確認できていないため、現時点では断定できません。';
export const AI_LOOP_FINALIZE_INSTRUCTION = '調査の進展が止まったため、この応答ではツールの使用と再試行を停止してください。これまでに取得できた結果だけで回答をまとめ、確認できなかった点を明示してください。空の検索結果を「情報が存在しない」と言い換えたり、自身の知識で未確認部分を埋めたりしないでください。「もう一度検索する」などの予定を繰り返さず、回答を完了してください。';

function stable(value: unknown): string {
    if (Array.isArray(value)) return JSON.stringify(value.map(entry => stable(entry)));
    if (value && typeof value === 'object') return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
    return JSON.stringify(value) ?? '';
}

/** Request-scoped progress detection; there is deliberately no total tool-call budget. */
export class AIProgressGuard {
    private noProgress = 0;
    private readonly seen = new Map<string, number>();
    private readonly text = new Map<string, { pending: string; sentences: Map<string, number>; inCode: boolean }>();
    public stalled = false;

    public assertToolsAllowed(): void {
        if (this.stalled) throw new AIProgressStalledError();
    }

    public record(name: string, args: unknown, result: unknown): void {
        const value = typeof result === 'string' ? result : stable(result);
        const failed = /^(?:SEARCH_(?:ERROR|EMPTY|UNAVAILABLE)|FETCH_ERROR|Error:|エラー[:：]|検索語句が空)/i.test(value.trim())
            || /^(?:Web検索結果がありませんでした|検索結果が(?:空|ありません)|No (?:search )?results)/i.test(value.trim());
        const research = /search|fetch|lookup/i.test(name);
        // Query/engine/timestamp annotations must not make unchanged evidence look new.
        const lines = value.split('\n').filter(line => !/^\s*(?:検索元|検索日時|キャッシュ|一部検索元のエラー|検索時の注意)[:：]/.test(line))
            .map(line => line.replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (research) lines.sort();
        const evidence = lines.join('\n');
        const fingerprint = createHash('sha256').update(stable([name, research ? null : args, failed ? 'failed' : evidence])).digest('hex');
        const previous = this.seen.get(fingerprint) ?? 0;
        if (this.seen.size >= 512 && !this.seen.has(fingerprint)) this.seen.delete(this.seen.keys().next().value!);
        this.seen.set(fingerprint, previous + 1);
        this.noProgress = failed || previous > 0 ? this.noProgress + 1 : 0;
        // Three consecutive failures/unchanged outcomes, or the same outcome recurring
        // three times across a longer cycle, indicate a stalled investigation.
        this.stalled = this.noProgress >= 3 || previous >= 2;
    }

    public observe(chunk: string, channel: string): void {
        const state = this.text.get(channel) ?? { pending: '', sentences: new Map<string, number>(), inCode: false };
        this.text.set(channel, state);
        state.pending += chunk;
        const pieces = state.pending.split(/[。！？!?\n]|\.(?=\s|$)/);
        state.pending = pieces.pop() ?? '';
        if (state.pending.length > 4000) state.pending = state.pending.slice(-1000);
        for (const piece of pieces) {
            if ((piece.match(/```/g)?.length ?? 0) % 2) { state.inCode = !state.inCode; continue; }
            if (state.inCode || /^[>「"]/.test(piece.trim())) continue;
            const sentence = piece.toLowerCase().replace(/[\s、,「」"'’]/g, '').trim();
            // Only repeated retry narration is suppressed, not deliberate repetition
            // in poems, quoted source text, code, or normal short acknowledgements.
            if (sentence.length < 15 || !/検索|調べ|search|look.?up|retry|tryagain/.test(sentence)
                || !/空|見つから|もう一度|再度|再試行|違う言葉|again|noresults|empty|repeat|retry/.test(sentence)) continue;
            const count = (state.sentences.get(sentence) ?? 0) + 1;
            if (state.sentences.size >= 128 && !state.sentences.has(sentence)) state.sentences.delete(state.sentences.keys().next().value!);
            state.sentences.set(sentence, count);
            if (count >= 4) { this.stalled = true; throw new AIProgressStalledError(); }
        }
    }
}
