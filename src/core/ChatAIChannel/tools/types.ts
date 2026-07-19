import type { OpenAIChatManager } from '../../ai/OpenAIChatManager.js';
import type { ChatAISandboxPaths } from '../types.js';

export interface ChatAIToolRegisterContext {
    sandboxPaths: ChatAISandboxPaths;
}

export type ChatAIToolRegistrar = (
    manager: OpenAIChatManager,
    context: ChatAIToolRegisterContext,
) => void;
