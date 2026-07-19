import type { OpenAIChatManager } from '../../ai/OpenAIChatManager.js';
import type { ChatAISandboxPaths } from '../types.js';
import type { ChatAIToolRegistrar } from './types.js';
import { registerFetchUrlTool } from './fetchUrl.js';
import { registerSandboxBashTool } from './sandboxBash.js';
import { registerWeatherLookupTool } from './weatherLookup.js';
import { registerWebSearchBingTool } from './webSearchBing.js';
import { registerUserMemoryEditTool } from './userMemoryEdit.js';
import { registerChannelUserTimeoutTool } from './channelUserTimeout.js';

const toolRegistrars: ChatAIToolRegistrar[] = [
    registerFetchUrlTool,
    registerWebSearchBingTool,
    registerWeatherLookupTool,
    registerSandboxBashTool,
    registerUserMemoryEditTool,
    registerChannelUserTimeoutTool,
];

export function registerChatAIChannelTools(
    manager: OpenAIChatManager,
    sandboxPaths: ChatAISandboxPaths,
    memoryFile: string,
    timeoutFile: string,
): void {
    for (const registerTool of toolRegistrars) {
        registerTool(manager, { sandboxPaths, memoryFile, timeoutFile });
    }
}
