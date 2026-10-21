import type { OpenAIChatManager } from '../../../../core/ai/OpenAIChatManager.js';
import { statusToolDefinition, statusToolHandler, weatherToolDefinition, weatherToolHandler,
    timeToolDefinition, timeToolHandler, countPhraseToolDefinition, countPhraseToolHandler,
    userInfoToolDefinition, userInfoToolHandler, antiCheatUserProfileDefinition, antiCheatUserProfileHandler,
    collectHistoryDefinition, collectHistoryHandler, fetchMessageLinkDefinition, fetchMessageLinkHandler } from './index.js';
import { webSearchDefinition, webSearchHandler } from '../../../../core/ChatAIChannel/tools/webSearchBing.js';
import { staffMemoryDefinition, staffMemoryHandler } from './staff_memory.js';
import { staffScheduleDefinition, staffScheduleHandler } from './schedule.js';
import { staffOutputFileDefinition, staffOutputFileHandler } from './fileOutput.js';
import { searchChannelMessagesDefinition, searchChannelMessagesHandler, fetchDiscordMessageDefinition, fetchDiscordMessageHandler } from './channelSearch.js';
import { fetchPublicUrlDefinition, fetchPublicUrlHandler } from './fetchPublicUrl.js';
import { bashCalculationDefinition, bashCalculationHandler } from './calculate.js';

/** Keep schema constraints, but avoid repeating long examples and system rules on every turn. */
const COMPACT_DESCRIPTIONS: Record<string, string> = {
    web_search: '複数検索元の結果と取得できた本文をMarkdownで返す。出典・日付を確認し、スニペットと本文・失敗を区別する。空結果や同じ検索を繰り返さない。',
    manage_memory: 'daily/my_profile/public_interestsはrecall。server_memosは共有メモの検索・一覧・取得・作成・更新・削除。非公開プロフィールは本人だけ。変更は明示依頼時だけ。記録なしを再試行しない。',
    manage_schedule: '本人の一回限りの予約をcreate/list/cancel。reminderは通知、taskは指定時刻に公開情報の調査・計算・文章生成を実行し本人にメンション。先に調査せず自己完結したtaskを保存。channel_idで別チャンネル可。日時は現在時計と日本時間を基準に、曖昧・過去は確認。保存成功後だけ完了と伝える。',
    calculate_bash: '計算専用Bash。小数・巨大整数はbc -lでscaleを指定（角度はラジアン）。許可形式はechoによる整数演算、printfからbc -lへのパイプ、引用付きbcヒアドキュメント。任意コマンド・ファイル・ネット・Python不可。5秒・128MiBまで。',
    fetch_url: '公開URLをNode fetchで取得しHTML本文をMarkdown化。Chrome不要。rawはソース、browserはJS描画が必要な場合だけの任意機能。ローカルIPは禁止。URLは正確に転記。',
};

/** Staff AI always receives the complete catalog, including on short follow-up requests. */
export function registerStaffAITools(manager: Pick<OpenAIChatManager, 'registerTool'>): Set<string> {
    const tools = [
        [statusToolDefinition, statusToolHandler],
        [webSearchDefinition, webSearchHandler],
        [weatherToolDefinition, weatherToolHandler],
        [timeToolDefinition, timeToolHandler],
        [countPhraseToolDefinition, countPhraseToolHandler],
        [userInfoToolDefinition, userInfoToolHandler],
        [antiCheatUserProfileDefinition, antiCheatUserProfileHandler],
        [collectHistoryDefinition, collectHistoryHandler],
        [fetchMessageLinkDefinition, fetchMessageLinkHandler],
        [staffMemoryDefinition, staffMemoryHandler],
        [staffScheduleDefinition, staffScheduleHandler],
        [searchChannelMessagesDefinition, searchChannelMessagesHandler],
        [fetchDiscordMessageDefinition, fetchDiscordMessageHandler],
        [fetchPublicUrlDefinition, fetchPublicUrlHandler],
        [staffOutputFileDefinition, staffOutputFileHandler],
        [bashCalculationDefinition, bashCalculationHandler],
    ] as const;
    for (const [definition, handler] of tools) manager.registerTool({
        ...definition,
        function: {...definition.function, description: COMPACT_DESCRIPTIONS[definition.function.name] ?? definition.function.description},
    }, handler);
    return new Set(tools.map(([definition]) => definition.function.name));
}
