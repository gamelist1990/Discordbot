export interface ChatAIChannelOptions {
    guildId: string;
    channelId: string;
    enabled: boolean;
    botName: string;
    historyLimit?: number;
    responseDelayMs?: number;
}

export interface ChatAIUserMemory {
    userId: string;
    displayName: string;
    aliases: string[];
    profile: string;
    likes: string[];
    notes: string[];
    trustScore?: number;
    conversationTone?: string;
    cautions?: string[];
    relationshipTone?: 'friendly' | 'neutral' | 'firm';
    relationshipContext?: string;
    boundaryState?: 'clear' | 'awaiting-apology';
    suspectedAltOf?: string;
    updatedAt: string;
}

export interface ChatAIChannelTimeoutEntry {
    userId: string;
    channelId: string;
    guildId: string;
    reason: string;
    createdAt: string;
    expiresAt: string;
}

export interface ChatAIChannelTimeoutFile {
    entries: Record<string, ChatAIChannelTimeoutEntry>;
    updatedAt: string;
}

export interface ChatAIMemoryFile {
    users: Record<string, ChatAIUserMemory>;
    updatedAt: string;
}

export interface ChatAISandboxPaths {
    root: string;
    work: string;
    downloads: string;
    uploads: string;
}
