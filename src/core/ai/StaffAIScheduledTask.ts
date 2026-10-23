import { NEMOTRON_MODEL } from '../../config.js';
import { OpenAIChatManager } from './OpenAIChatManager.js';
import { AI_RESEARCH_POLICY } from './AIResearchPolicy.js';
import { buildStaffAITimeContext } from './StaffAITimeContext.js';
import type { StaffAISchedule } from './StaffAIScheduler.js';
import { selectStaffToolNames } from '../../commands/staff/subcommands/StaffAIToolRouting.js';
import { webSearchDefinition, webSearchHandler } from '../ChatAIChannel/tools/webSearchBing.js';
import { fetchPublicUrlDefinition, fetchPublicUrlHandler } from '../../commands/staff/subcommands/ai-tools/fetchPublicUrl.js';
import { weatherToolDefinition, weatherToolHandler } from '../../commands/staff/subcommands/ai-tools/weather.js';
import { timeToolDefinition, timeToolHandler } from '../../commands/staff/subcommands/ai-tools/time.js';
import { bashCalculationDefinition, bashCalculationHandler } from '../../commands/staff/subcommands/ai-tools/calculate.js';

type TaskManager = Pick<OpenAIChatManager, 'registerTool' | 'generateText'>;

/** No slash interaction is retained. Scheduled tasks get only independent, read-only tools. */
export async function executeStaffScheduledTask(schedule: StaffAISchedule, now = Date.now(),
    manager: TaskManager = new OpenAIChatManager()): Promise<string> {
    if (schedule.mode !== 'task' || !schedule.task?.trim()) throw new Error('実行する依頼文がありません');
    const signal = AbortSignal.timeout(180_000);
    for (const [definition, handler] of [
        [webSearchDefinition, webSearchHandler],
        [fetchPublicUrlDefinition, fetchPublicUrlHandler],
        [weatherToolDefinition, weatherToolHandler],
        [timeToolDefinition, timeToolHandler],
        [bashCalculationDefinition, bashCalculationHandler],
    ] as const) {
        manager.registerTool(definition, async args => {
            signal.throwIfAborted();
            // Bound tool waits as well as model requests; tools here have no write side effects.
            let onAbort!: () => void;
            const aborted = new Promise<never>((_, reject) => {
                onAbort = () => reject(signal.reason);
                signal.addEventListener('abort', onAbort, { once: true });
            });
            try { return await Promise.race([Promise.resolve().then(() => handler(args)), aborted]); }
            finally { signal.removeEventListener('abort', onAbort); }
        });
    }
    const selected = selectStaffToolNames(schedule.task);
    const firstTool = selected.has('calculate_bash') ? 'calculate_bash'
        : selected.has('get_weather') ? 'get_weather'
        : /https?:\/\//i.test(schedule.task) ? 'fetch_url'
        : selected.has('web_search') ? 'web_search' : undefined;
    const result = await manager.generateText([
        { role: 'system', content: [
            'あなたはDiscord Staff AIの予約処理を実行しています。日本語で依頼の実行結果を返してください。',
            '予約の時間になったので、今ここで依頼を実行する。「後で実行する」「予約しました」と返さない。',
            'Web検索・公開URLの本文取得・天気・現在時刻・calculate_bashによる数値計算のツールと文章作成・要約を利用できる。数値計算は計算ツールで検算し、高精度計算はbc -lを使う。',
            'サーバー管理・メモ更新・別の予約作成・非公開Discord履歴の取得は利用できない。できない動作は成功したと偽らず説明する。',
            '実行結果は予約に保存された通知先チャンネルに投稿される。不要な個人情報や追加メンションを含めない。',
            AI_RESEARCH_POLICY,
        ].join('') },
        { role: 'system', content: `${buildStaffAITimeContext(now)}\n予約時刻: ${schedule.runAt}。今日・最新などは実行日時を基準にする。` },
        { role: 'user', content: schedule.task },
    ], { model: NEMOTRON_MODEL, strictModel: true, maxTokens: 3072, signal,
        requestLabel: `staff-ai-schedule:${schedule.id}`,
        ...(firstTool ? { forceToolSequence: [firstTool] } : {}),
    });
    if (!result.trim()) throw new Error('予約したAI処理の結果が空です');
    return result.trim();
}
