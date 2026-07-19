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
    suspectedAltOf?: string;
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
