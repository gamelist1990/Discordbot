export type PersonalityKey =
    | 'analyst'
    | 'mediator'
    | 'challenger'
    | 'executor'
    | 'creator'
    | 'supporter'
    | 'chaotic'
    | 'eccentric'
    | 'impulsive'
    | 'fabulist'
    | 'performative'
    | 'provocateur'
    | 'volatile';

export type PersonalitySessionStatus = 'active' | 'completed' | 'closed';
export type TranscriptAuthor = 'system' | 'assistant' | 'user' | 'creator' | 'opponent';

export interface PersonalityArchetypeDefinition {
    label: string;
    roleName: string;
    summary: string;
}

export type CoreFeaturePanelKind = string;

export interface CoreFeaturePanelConfig {
    panelKind: CoreFeaturePanelKind;
    featureKeys?: string[];
    guildId: string;
    channelId: string;
    messageId: string | null;
    spectatorRoleId: string | null;
    requestCategoryName?: string | null;
    requestLabels?: string[];
    requestDoneChannelId?: string | null;
    requestStaffRoleId?: string | null;
    requestTrackingChannelId?: string | null;
    updatedBy: string;
    updatedAt: string;
}

export interface TranscriptEntry {
    id: string;
    authorId: string | null;
    authorType: TranscriptAuthor;
    content: string;
    createdAt: string;
}

export interface PersonalitySession {
    sessionId: string;
    guildId: string;
    channelId: string;
    categoryId: string;
    userId: string;
    userName: string;
    userDisplayName: string;
    interviewerName: string;
    status: PersonalitySessionStatus;
    createdAt: string;
    updatedAt: string;
    cooldownUntil: string;
    assignedKey: PersonalityKey | null;
    assignedRoleId: string | null;
    confidence: number | null;
    reason: string | null;
    traits: string[];
    transcript: TranscriptEntry[];
    roomDeletedAt?: string;
}

export interface PersonalityProfile {
    userId: string;
    guildId: string;
    assignedKey: PersonalityKey | null;
    assignedRoleId: string | null;
    assignedAt: string | null;
    cooldownUntil: string | null;
    lastSessionId: string | null;
    confidence: number | null;
    reason: string | null;
    traits: string[];
    history: PersonalityProfileHistoryEntry[];
}

export interface PersonalityProfileHistoryEntry {
    sessionId: string;
    assignedKey: PersonalityKey;
    confidence: number | null;
    reason: string;
    traits: string[];
    recordedAt: string;
}

export interface PersonalityEvaluationResponse {
    reply: string;
    complete: boolean;
    personality_key: PersonalityKey | null;
    reason: string;
    confidence: number | null;
    traits: string[];
}
