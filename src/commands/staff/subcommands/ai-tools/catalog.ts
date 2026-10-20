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
    ] as const;
    for (const [definition, handler] of tools) manager.registerTool(definition, handler);
    return new Set(tools.map(([definition]) => definition.function.name));
}
