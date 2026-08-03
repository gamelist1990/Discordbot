import { database } from '../persistence/Database.js';

export interface GameRankTier {
    key: string;
    label: string;
    minRating: number;
    color: string;
}

export interface GameRankingProfile {
    userId: string;
    rating: number;
    wins: number;
    losses: number;
    draws: number;
    games: number;
    streak: number;
    bestStreak: number;
    lastPlayedAt: string | null;
}

export interface GameRankingBoard {
    gameKey: string;
    guildId: string;
    tiers: GameRankTier[];
    players: Record<string, GameRankingProfile>;
    updatedAt: string;
}

export interface GameResultInput {
    guildId: string;
    gameKey: string;
    playerA: string;
    playerB: string;
    result: 'playerA' | 'playerB' | 'draw';
    ranked?: boolean;
    initialRating?: number;
    kFactor?: number;
    tiers?: GameRankTier[];
}

export interface GameResultOutput {
    playerA: GameRankingProfile;
    playerB: GameRankingProfile;
    playerADelta: number;
    playerBDelta: number;
}

const DEFAULT_TIERS: GameRankTier[] = [
    { key: 'bronze', label: 'Bronze', minRating: 0, color: '#b77946' },
    { key: 'silver', label: 'Silver', minRating: 1100, color: '#a8b2bd' },
    { key: 'gold', label: 'Gold', minRating: 1300, color: '#e5b82e' },
    { key: 'platinum', label: 'Platinum', minRating: 1500, color: '#70cbd0' },
    { key: 'diamond', label: 'Diamond', minRating: 1750, color: '#7289da' },
    { key: 'master', label: 'Master', minRating: 2000, color: '#a66cff' }
];

export const OTHELLO_RANK_TIERS: GameRankTier[] = [
    { key: 'd', label: 'D', minRating: 0, color: '#8d99a6' },
    { key: 'c', label: 'C', minRating: 1100, color: '#4caf72' },
    { key: 'b', label: 'B', minRating: 1300, color: '#3f8cff' },
    { key: 'a', label: 'A', minRating: 1500, color: '#a66cff' },
    { key: 's', label: 'S', minRating: 1750, color: '#f2b632' }
];

function getDefaultTiers(gameKey: string): GameRankTier[] {
    return gameKey === 'othello' ? OTHELLO_RANK_TIERS : DEFAULT_TIERS;
}

function rankingKey(guildId: string, gameKey: string): string {
    return `Guild/${guildId}/game-rankings/${gameKey}`;
}

function createProfile(userId: string, initialRating: number): GameRankingProfile {
    return {
        userId,
        rating: initialRating,
        wins: 0,
        losses: 0,
        draws: 0,
        games: 0,
        streak: 0,
        bestStreak: 0,
        lastPlayedAt: null
    };
}

export class GameRankingManager {
    private readonly writeQueues = new Map<string, Promise<void>>();

    async getBoard(
        guildId: string,
        gameKey: string,
        tiers?: GameRankTier[]
    ): Promise<GameRankingBoard> {
        const resolvedTiers = tiers || getDefaultTiers(gameKey);
        const stored = await database.get<GameRankingBoard | null>(
            guildId,
            rankingKey(guildId, gameKey),
            null
        );

        if (stored) {
            return {
                ...stored,
                tiers: gameKey === 'othello'
                    ? OTHELLO_RANK_TIERS
                    : Array.isArray(stored.tiers) && stored.tiers.length > 0
                        ? stored.tiers
                        : resolvedTiers,
                players: stored.players || {}
            };
        }

        return {
            gameKey,
            guildId,
            tiers: resolvedTiers,
            players: {},
            updatedAt: new Date().toISOString()
        };
    }

    async getProfile(
        guildId: string,
        gameKey: string,
        userId: string,
        initialRating = 1200
    ): Promise<GameRankingProfile> {
        const board = await this.getBoard(guildId, gameKey);
        return board.players[userId] || createProfile(userId, initialRating);
    }

    async recordResult(input: GameResultInput): Promise<GameResultOutput> {
        this.validateIdentifiers(input.guildId, input.gameKey, input.playerA, input.playerB);
        if (input.playerA === input.playerB) {
            throw new Error('同一プレイヤー同士の対戦結果は記録できません。');
        }

        return this.withBoardLock(input.guildId, input.gameKey, async () => {
        const initialRating = input.initialRating ?? 1200;
        const kFactor = Math.min(128, Math.max(1, input.kFactor ?? 32));
        const board = await this.getBoard(
            input.guildId,
            input.gameKey,
            input.tiers || getDefaultTiers(input.gameKey)
        );
        const playerA = { ...(board.players[input.playerA] || createProfile(input.playerA, initialRating)) };
        const playerB = { ...(board.players[input.playerB] || createProfile(input.playerB, initialRating)) };

        let playerADelta = 0;
        let playerBDelta = 0;

        if (input.ranked !== false) {
            const expectedA = 1 / (1 + Math.pow(10, (playerB.rating - playerA.rating) / 400));
            const expectedB = 1 - expectedA;
            const scoreA = input.result === 'playerA' ? 1 : input.result === 'draw' ? 0.5 : 0;
            const scoreB = 1 - scoreA;
            playerADelta = Math.round(kFactor * (scoreA - expectedA));
            playerBDelta = Math.round(kFactor * (scoreB - expectedB));
            playerA.rating = Math.max(0, playerA.rating + playerADelta);
            playerB.rating = Math.max(0, playerB.rating + playerBDelta);
        }

        const now = new Date().toISOString();
        for (const profile of [playerA, playerB]) {
            profile.games += 1;
            profile.lastPlayedAt = now;
        }

        if (input.result === 'draw') {
            playerA.draws += 1;
            playerB.draws += 1;
            playerA.streak = 0;
            playerB.streak = 0;
        } else {
            const winner = input.result === 'playerA' ? playerA : playerB;
            const loser = input.result === 'playerA' ? playerB : playerA;
            winner.wins += 1;
            winner.streak += 1;
            winner.bestStreak = Math.max(winner.bestStreak, winner.streak);
            loser.losses += 1;
            loser.streak = 0;
        }

        board.players[playerA.userId] = playerA;
        board.players[playerB.userId] = playerB;
        board.updatedAt = now;
        await database.set(input.guildId, rankingKey(input.guildId, input.gameKey), board);

        return { playerA, playerB, playerADelta, playerBDelta };
        });
    }

    async getLeaderboard(
        guildId: string,
        gameKey: string,
        limit = 50,
        offset = 0
    ): Promise<Array<GameRankingProfile & { position: number; tier: GameRankTier }>> {
        const board = await this.getBoard(guildId, gameKey);
        const sorted = Object.values(board.players)
            .sort((left, right) =>
                right.rating - left.rating
                || right.wins - left.wins
                || left.losses - right.losses
            );

        return sorted.slice(offset, offset + limit).map((profile, index) => ({
            ...profile,
            position: offset + index + 1,
            tier: this.getTier(board.tiers, profile.rating)
        }));
    }

    getTier(tiers: GameRankTier[], rating: number): GameRankTier {
        return [...tiers]
            .sort((left, right) => right.minRating - left.minRating)
            .find((tier) => rating >= tier.minRating)
            || tiers[0]
            || DEFAULT_TIERS[0];
    }

    async resetUser(guildId: string, gameKey: string, userId: string): Promise<boolean> {
        this.validateIdentifiers(guildId, gameKey, userId);
        return this.withBoardLock(guildId, gameKey, async () => {
        const board = await this.getBoard(guildId, gameKey);
        if (!board.players[userId]) {
            return false;
        }

        delete board.players[userId];
        board.updatedAt = new Date().toISOString();
        await database.set(guildId, rankingKey(guildId, gameKey), board);
        return true;
        });
    }

    private validateIdentifiers(...values: string[]): void {
        if (values.some((value) => !/^[A-Za-z0-9_-]{1,100}$/.test(value))) {
            throw new Error('ランキング識別子が不正です。');
        }
    }

    private async withBoardLock<T>(
        guildId: string,
        gameKey: string,
        operation: () => Promise<T>
    ): Promise<T> {
        const key = `${guildId}:${gameKey}`;
        const previous = this.writeQueues.get(key) || Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.then(() => current);
        this.writeQueues.set(key, queued);

        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (this.writeQueues.get(key) === queued) {
                this.writeQueues.delete(key);
            }
        }
    }
}

const GLOBAL_KEY = '__gameRankingManager_v1';
if (!(global as any)[GLOBAL_KEY]) {
    (global as any)[GLOBAL_KEY] = new GameRankingManager();
}

export const gameRankingManager: GameRankingManager = (global as any)[GLOBAL_KEY];