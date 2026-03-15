export interface IntegrationState {
    messageId: string | null;
    lastOnlineAt: number | null;
}

export interface StatusSnapshot {
    status: 'online' | 'offline';
    checkedAt: number;
    imageBuffer: Buffer;
    lastOnlineAt: number | null;
    failureReason?: string;
}
