import type { OpenAIChatManager } from '../../ai/OpenAIChatManager.js';
import type { ChatAISandboxPaths } from '../types.js';
import type { ChatAIToolRegistrar } from './types.js';
import { registerFetchUrlTool } from './fetchUrl.js';
import { registerSandboxBashTool } from './sandboxBash.js';
import { registerWeatherLookupTool } from './weatherLookup.js';
import { registerVisionDescribeTool } from './visionDescribe.js';
import { registerWebSearchBingTool } from './webSearchBing.js';

const toolRegistrars: ChatAIToolRegistrar[] = [
    registerFetchUrlTool,
    registerWebSearchBingTool,
    registerWeatherLookupTool,
    registerVisionDescribeTool,
    registerSandboxBashTool,
];

export function registerChatAIChannelTools(
    manager: OpenAIChatManager,
    sandboxPaths: ChatAISandboxPaths,
): void {
    for (const registerTool of toolRegistrars) {
        registerTool(manager, { sandboxPaths });
    }
}
