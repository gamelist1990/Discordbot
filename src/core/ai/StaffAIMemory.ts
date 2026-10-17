import { database } from '../persistence/Database.js';
import type { AIConversationEntry } from './AIConversationHistory.js';
import { OpenAIChatManager } from './OpenAIChatManager.js';
import { GEMMA_MODEL } from '../../config.js';

export type StaffMemory = {
    id: string; kind: 'daily' | 'user'; guildId: string; userId?: string;
    day?: string; title: string; content: string; publicInterests?: string; evidenceCount: number;
    updatedAt: string; editedByStaff?: boolean;
};
export type StaffMetrics = { requests: number; inputTokens: number; outputTokens: number;
    totalTokens: number; generatedSeconds: number; cacheHitTokens: number; cacheInputTokens: number };
const DATASET = (guildId: string) => `Guild/${guildId}/dataset`;
const KEY = (guildId: string) => `Guild/${guildId}/staff-ai-memory`;
const METRICS = (guildId: string) => `Guild/${guildId}/staff-ai-metrics`;
const ZERO: StaffMetrics = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
    generatedSeconds: 0, cacheHitTokens: 0, cacheInputTokens: 0 };
const running = new Set<string>();
const attempted = new Set<string>();
const dayInJst = (time: number): string => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(time));

export async function staffMemoryList(guildId: string): Promise<StaffMemory[]> {
    return await database.get<StaffMemory[]>(guildId, KEY(guildId), []) || [];
}
export async function staffMetrics(guildId: string): Promise<StaffMetrics> {
    return await database.get<StaffMetrics>(guildId, METRICS(guildId), ZERO) || { ...ZERO };
}
export async function recordStaffUsage(guildId: string, input: number, output: number,
    seconds: number, cached?: number): Promise<void> {
    const prev = await staffMetrics(guildId);
    await database.set(guildId, METRICS(guildId), {
        requests: prev.requests + 1,
        inputTokens: prev.inputTokens + input, outputTokens: prev.outputTokens + output,
        totalTokens: prev.totalTokens + input + output,
        generatedSeconds: prev.generatedSeconds + Math.max(0, seconds),
        cacheHitTokens: prev.cacheHitTokens + Math.max(0, cached ?? 0),
        // Do not report 0% until the inference API provides an actual cache count.
        cacheInputTokens: prev.cacheInputTokens + (cached === undefined ? 0 : input),
    } satisfies StaffMetrics);
}
export async function editStaffMemory(guildId: string, id: string, content: string): Promise<StaffMemory> {
    if (!content.trim() || content.length > 6000) throw new Error('メモリー本文は1〜6000文字で指定してください');
    const list = await staffMemoryList(guildId);
    const item = list.find(record => record.id === id);
    if (!item) throw new Error('メモリーが見つかりません');
    item.content = content.trim(); item.updatedAt = new Date().toISOString(); item.editedByStaff = true;
    await database.set(guildId, KEY(guildId), list);
    return item;
}
export async function clearStaffMemory(guildId: string, id?: string): Promise<number> {
    const list = await staffMemoryList(guildId);
    const rest = id ? list.filter(record => record.id !== id) : [];
    await database.set(guildId, KEY(guildId), rest);
    return list.length - rest.length;
}
export async function staffMemoryContext(guildId: string, userId: string, query: string): Promise<string> {
    const list = await staffMemoryList(guildId);
    const daily = list.filter(record => record.kind === 'daily').slice(-3);
    const profile = list.find(record => record.kind === 'user' && record.userId === userId);
    const matching = /覚え|メモリ|思い出|昨日|今日|以前/i.test(query);
    if (!profile && !matching) return '';
    return [...(profile ? [profile] : []), ...(matching ? daily : [])]
        .map(record => `[${record.title} / 更新 ${record.updatedAt}] ${record.content.slice(0, 900)}`).join('\n');
}
async function summarize(input: string, instruction: string): Promise<string> {
    let result = '';
    await new OpenAIChatManager().streamResponseText([
        { role: 'system', content: instruction + '\n推測や診断は禁止。私的情報・健康・思想・属性は記録しない。会話で確認できた事実のみを簡潔な日本語でまとめる。引用された他人の発言を本人の属性と混同しない。' },
        { role: 'user', content: input.slice(0, 13000) },
    ], delta => {
        if (delta.type === 'text') result += delta.text;
    }, { model: GEMMA_MODEL, strictModel: true, maxTokens: 520 });
    return result.trim();
}
/** Run in background after interactions, at most once per guild+day. */
export function queueStaffDailyMemory(guildId: string): void {
    const yesterday = dayInJst(Date.now() - 86400000);
    const job = `${guildId}:${yesterday}`;
    if (running.has(job) || attempted.has(job)) return;
    running.add(job);
    void (async () => {
        try {
            const memories = await staffMemoryList(guildId);
            if (memories.some(m => m.id === `daily:${yesterday}`)) return;
            const dataset = await database.get<AIConversationEntry[]>(guildId, DATASET(guildId), []) || [];
            const entries = dataset.filter(m => !m.incomplete &&
                dayInJst(m.timestamp) === yesterday && m.prompt?.trim());
            if (!entries.length) return;
            const summary = await summarize(entries.map(m =>
                `${m.userName || m.userId}: ${m.prompt.slice(0, 650)}\nAI: ${(m.response || '').slice(0, 350)}`).join('\n'),
            'Discordサーバーの昨日の出来事を、話題・取り組み・決まったことを中心に箇条書きで要約。');
            if (!summary) return;
            const next = await staffMemoryList(guildId);
            if (!next.some(m => m.id === `daily:${yesterday}`)) {
                next.push({ id: `daily:${yesterday}`, kind: 'daily', guildId, day: yesterday,
                    title: `${yesterday} の出来事`, content: summary.slice(0, 6000),
                    evidenceCount: entries.length, updatedAt: new Date().toISOString() });
            }
            // Profiles: reflect only this user's own prompts, never AI-generated text.
            for (const [userId, own] of Object.entries(Object.groupBy(entries, e => e.userId))) {
                if (!own || own.length < 2) continue;
                const id = `user:${userId}`;
                const old = next.find(m => m.id === id);
                if (old?.editedByStaff) continue;
                const facts = await summarize(
                    `既存の確認済みプロフィール: ${old?.content || 'なし'}\n最近の本人発言:\n` +
                    own.map(m => m.prompt.slice(0, 550)).join('\n'),
                    '会話しているユーザー本人の興味・得意分野・活動だけを更新。断定できない属性は含めない。本人の発言と明確に分かる情報だけ記録。',
                );
                if (!facts) continue;
                // Only this tightly scoped public-interest summary is permitted in
                // third-party lookups. The full profile remains private.
                const publicInterests = await summarize(
                    own.map(m => m.prompt.slice(0, 400)).join('\n'),
                    '本人が明示的に話した趣味、好きなゲームや曲、一般的な興味、公開している制作活動や得意分野のみ。連絡先・本名・住所・健康・恋愛・思想・家族・秘密・推測は絶対に記録しない。確証がなければ「不明」と返す。'
                );
                const record: StaffMemory = { id, kind: 'user', guildId, userId,
                    title: `${own.at(-1)?.userName || userId} のプロフィール`,
                    content: facts.slice(0, 4000), publicInterests: publicInterests.slice(0, 1000), evidenceCount: own.length,
                    updatedAt: new Date().toISOString() };
                const index = next.findIndex(m => m.id === id);
                if (index >= 0) next[index] = record; else next.push(record);
            }
            await database.set(guildId, KEY(guildId), next.slice(-1000));
        } catch (error) {
            console.warn('[StaffAIMemory] background summary failed:', error);
        } finally {
            attempted.add(job);
            running.delete(job);
        }
    })();
}

let schedulerStarted = false;

/** Check past-day summaries even if no one invokes /staff ai after midnight. */
export function startStaffAIMemoryScheduler(guilds: () => string[]): void {
    if (schedulerStarted) return;
    schedulerStarted = true;
    const check = () => {
        for (const guildId of guilds()) queueStaffDailyMemory(guildId);
    };
    setTimeout(check, 5 * 60_000).unref();
    setInterval(check, 60 * 60_000).unref();
}
