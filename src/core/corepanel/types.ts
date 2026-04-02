export type DebateOpponentType = 'ai' | 'king' | 'ai_vs_ai';
export type DebateParticipantType = 'user' | 'ai';
export type DebateStance = 'support' | 'oppose';
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
export type DebateSessionStatus = 'waiting_opponent' | 'active' | 'judging' | 'completed' | 'closed';
export type TranscriptAuthor = 'system' | 'assistant' | 'user' | 'creator' | 'opponent';
export type DebateWinner = 'creator' | 'opponent' | 'draw';

export interface PersonalityArchetypeDefinition {
    label: string;
    roleName: string;
    summary: string;
}

export type CoreFeaturePanelKind = 'combined' | 'personality' | 'debate';

export interface CoreFeaturePanelConfig {
    panelKind: CoreFeaturePanelKind;
    guildId: string;
    channelId: string;
    messageId: string | null;
    spectatorRoleId: string | null;
    requestCategoryName?: string | null;
    requestLabels?: string[];
    requestDoneChannelId?: string | null;
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

export interface DebateSession {
    sessionId: string;
    guildId: string;
    channelId: string;
    categoryId: string;
    hostUserId: string;
    hostUserName: string;
    hostDisplayName: string;
    creatorId: string | null;
    creatorUserName: string | null;
    creatorDisplayName: string | null;
    opponentId: string | null;
    opponentUserName: string | null;
    opponentDisplayName: string | null;
    creatorAiName: string | null;
    opponentAiName: string | null;
    opponentType: DebateOpponentType;
    creatorParticipantType: DebateParticipantType;
    opponentParticipantType: DebateParticipantType;
    spectatorRoleId: string | null;
    topic: string;
    creatorStance: DebateStance;
    opponentStance: DebateStance;
    status: DebateSessionStatus;
    currentTurn: 'creator' | 'opponent';
    turnLimit: number;
    creatorTurns: number;
    opponentTurns: number;
    transcript: TranscriptEntry[];
    winner: DebateWinner | null;
    judgementReason: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface DebateProfile {
    userId: string;
    guildId: string;
    score: number;
    aiVsAiCooldownUntil: string | null;
    wins: number;
    losses: number;
    draws: number;
    aiWins: number;
    kingWins: number;
    totalBattles: number;
    kingAwardedAt: string | null;
    recentResults: Array<{
        sessionId: string;
        topic: string;
        opponentType: DebateOpponentType;
        result: 'win' | 'loss' | 'draw';
        scoreDelta: number;
        at: string;
    }>;
}

export interface PersonalityEvaluationResponse {
    reply: string;
    complete: boolean;
    personality_key: PersonalityKey | null;
    reason: string;
    confidence: number | null;
    traits: string[];
}

export interface DebateReplyResponse {
    reply: string;
}

export interface DebateJudgeResponse {
    winner: DebateWinner;
    reason: string;
    creator_score: number;
    opponent_score: number;
}
