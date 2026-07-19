import type { OpenAIChatManager } from '../../ai/OpenAIChatManager.js';
import type { ChatAISandboxPaths } from '../types.js';

export interface ChatAIToolRegisterContext {
    sandboxPaths: ChatAISandboxPaths;
    memoryFile: string;
    timeoutFile: string;
}

export interface ChatAIGeneratedImage {
    source: 'youtube' | 'editor';
    data: Buffer;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    filename: string;
    description: string;
    path?: string;
}

export interface ChatAIToolContext {
    client?: import('discord.js').Client | null;
    guildId?: string;
    channelId?: string;
    images?: Array<{ index: number; author?: string; dataUrl: string }>;
    sandbox?: ChatAISandboxPaths;
    sandboxPaths?: ChatAISandboxPaths;
    generatedImages?: ChatAIGeneratedImage[];
    uploadedImageIndices?: Set<number>;
    [key: string]: unknown;
}

export type ChatAIToolRegistrar = (
    manager: OpenAIChatManager,
    context: ChatAIToolRegisterContext,
) => void;
