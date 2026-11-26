import type { Guild, GuildMember } from 'discord.js';
import config from '../../config.js';
import type { BotClient } from '../platform/BotClient.js';
import { database } from '../persistence/Database.js';
import { RolePresetManager } from '../roles/RolePresetManager.js';
import { Logger } from '../../utils/Logger.js';
import { antiCheatManager } from '../anticheat/AntiCheatManager.js';
import { riskKickLedger } from '../anticheat/RiskKicks.js';
import { evaluateBrowserGate } from './browserGate.js';
import {
    describeDragFailure,
    DRAG_CHALLENGE_CONFIG,
    createDragChallenge,
    evaluateDragChallenge
} from './challenge.js';
import {
    hashFingerprint,
    hashFingerprintSignalComponents,
    hashIp,
    hashSubnet,
    normalizeFingerprintSignals
} from './fingerprint.js';
import { IpIntelClient } from './ipIntel.js';
import {
    correlateWebAuthRecord,
    createWebAuthRecord,
    withWebAuthMatchCounts,
    WebAuthRecordStore,
    type WebAuthRecordView
} from './records.js';
import { loadWebAuthKeys, sealPayload, type WebAuthKeys } from './secrets.js';
import { WebAuthTokenStore } from './tokens.js';
import type {
    BrowserGateResult,
    DragChallenge,
    DragChallengeFailReason,
    DragTrajectorySample,
    FingerprintSignals,
    IpIntelResult,
    SealedWebAuthPayload,
    WebAuthMatch,
    WebAuthRecord,
    WebAuthTokenRecord
} from './types.js';

export type WebAuthPageStatus = 'ready' | 'invalid' | 'expired' | 'in-use' | 'error';

export interface WebAuthPageData {
    status: WebAuthPageStatus;
    token: string;
    guildId: string;
    guildName: string;
    userId: string;
    userName: string;
    browser: BrowserGateResult;
    intel: IpIntelResult | null;
    vpnBlocked: boolean;
    message: string | null;
    /** Pending drag check, null when already passed or the page is not ready. */
    challenge: DragChallenge | null;
    challengePassed: boolean;
    /** Remaining drag attempts before the token is invalidated. */
    attemptsLeft: number;
}

export interface WebAuthSubmitInput {
    token: string;
    clientIp: string;
    socketIp: string;
    signals: FingerprintSignals;
    clientHint?: string | null;
}

export type WebAuthSubmitResult =
    | {
        ok: true;
        record: WebAuthRecord;
        matchCount: number;
        flagged: boolean;
        roleGranted: boolean;
        warnings: string[];
    }
    | {
        ok: false;
        status: 'invalid' | 'expired' | 'in-use' | 'browser' | 'vpn' | 'challenge' | 'error';
        message: string;
        browser?: BrowserGateResult;
    };

export type WebAuthChallengeStatus = 'failed' | 'invalid' | 'expired' | 'browser' | 'locked';

export type WebAuthChallengeResult =
    | { ok: true }
    | {
        ok: false;
        status: WebAuthChallengeStatus;
        message: string;
        /** Remaining attempts after this failure (not present on locked). */
        attemptsLeft?: number;
        /** Replacement challenge for the next attempt. */
        challenge?: DragChallenge | null;
        /** Machine reason of the failed validation (no raw samples). */
        reason?: DragChallengeFailReason | null;
    };

export interface WebAuthRoleGrantResult {
    granted: string[];
    errors: string[];
    skipped: string[];
}

export interface GrantableGuildSettings {
    webAuthRoleId?: string | null;
}

const GUILD_SETTINGS_KEY = (guildId: string) => `Guild/${guildId}/settings`;

/** A role already held counts as granted; no configured role does not. */
function roleGrantSucceeded(grant: WebAuthRoleGrantResult): boolean {
    if (grant.errors.length) return false;
    return grant.granted.length > 0 || grant.skipped.some((entry) => entry.endsWith('付与済み'));
}

/**
 * Orchestrates the consented web fingerprint flow: one-time tokens, browser
 * and IP gating, hashing/sealing, role grant and watch correlation.
 */
export class WebAuthService {
    private botClient: BotClient | null = null;
    private keysPromise: Promise<WebAuthKeys> | null = null;
    readonly tokens: WebAuthTokenStore;
    readonly records: WebAuthRecordStore;
    readonly intel: IpIntelClient;

    constructor(options: {
        tokens?: WebAuthTokenStore;
        records?: WebAuthRecordStore;
        intel?: IpIntelClient;
    } = {}) {
        this.tokens = options.tokens || new WebAuthTokenStore();
        this.records = options.records || new WebAuthRecordStore();
        this.intel = options.intel || new IpIntelClient();
    }

    setBotClient(botClient: BotClient): void {
        this.botClient = botClient;
    }

    private getKeys(): Promise<WebAuthKeys> {
        if (!this.keysPromise) this.keysPromise = loadWebAuthKeys();
        return this.keysPromise;
    }

    private baseUrl(): string {
        const value = typeof config.BASE_URL === 'string' && config.BASE_URL.trim()
            ? config.BASE_URL.trim()
            : 'http://localhost:3000';
        return value.replace(/\/+$/, '');
    }

    createToken(input: {
        guildId: string;
        userId: string;
        presetId?: string | null;
        roleIds?: string[];
    }): { token: string; url: string; record: WebAuthTokenRecord } {
        const created = this.tokens.create(input);
        return {
            token: created.token,
            record: created.record,
            url: `${this.baseUrl()}/webauth/${created.token}`
        };
    }

    async getPageData(input: {
        token: string;
        userAgent: string;
        clientHint?: string | null;
        clientIp: string;
    }): Promise<WebAuthPageData> {
        const lookup = this.tokens.peek(input.token);
        const browser = evaluateBrowserGate({
            userAgent: input.userAgent,
            clientHint: input.clientHint || null
        });
        if (!lookup.record) {
            return {
                status: lookup.status === 'expired' ? 'expired' : lookup.status === 'in-use' ? 'in-use' : 'invalid',
                token: input.token,
                guildId: '',
                guildName: '',
                userId: '',
                userName: '',
                browser,
                intel: null,
                vpnBlocked: false,
                message: null,
                challenge: null,
                challengePassed: false,
                attemptsLeft: DRAG_CHALLENGE_CONFIG.maxAttempts
            };
        }

        const token = lookup.record;
        const target = await this.resolveTarget(token);
        if (!target) {
            return {
                status: 'error',
                token: input.token,
                guildId: token.guildId,
                guildName: '',
                userId: token.userId,
                userName: '',
                browser,
                intel: null,
                vpnBlocked: false,
                message: 'サーバーまたはメンバー情報を取得できませんでした。',
                challenge: null,
                challengePassed: token.challengePassed,
                attemptsLeft: Math.max(0, DRAG_CHALLENGE_CONFIG.maxAttempts - token.challengeAttempts)
            };
        }

        const intel = await this.intel.lookup(input.clientIp);
        const challenge = token.challengePassed ? null : this.issueChallenge(input.token);
        return {
            status: 'ready',
            token: input.token,
            guildId: token.guildId,
            guildName: target.guild.name,
            userId: token.userId,
            userName: target.member.displayName || target.member.user.username,
            browser,
            intel,
            vpnBlocked: intel.verdict === 'blocked',
            message: null,
            challenge,
            challengePassed: token.challengePassed,
            attemptsLeft: Math.max(0, DRAG_CHALLENGE_CONFIG.maxAttempts - token.challengeAttempts)
        };
    }

    /**
     * Returns the pending drag check for a token, creating one on first use.
     * A page reload reuses the pending geometry (positions stay stable); a
     * failed attempt replaces it (see `verifyChallenge`).
     */
    issueChallenge(token: string): DragChallenge | null {
        const lookup = this.tokens.peek(token);
        if (!lookup.record || lookup.record.challengePassed) return null;
        if (lookup.record.challenge) return lookup.record.challenge;
        const challenge = createDragChallenge();
        this.tokens.setChallenge(token, challenge);
        return challenge;
    }

    /**
     * Validates one posted drag attempt against the stored challenge. Passing
     * flips the token's `challengePassed` flag (the only thing the submit
     * endpoint trusts); failing issues a fresh arrangement or, after
     * `maxAttempts`, burns the token.
     */
    async verifyChallenge(input: {
        token: string;
        itemId: unknown;
        drop: { x: number; y: number } | null | undefined;
        samples: DragTrajectorySample[] | null | undefined;
        userAgent: string;
        clientHint?: string | null;
    }): Promise<WebAuthChallengeResult> {
        const browser = evaluateBrowserGate({
            userAgent: String(input.userAgent || ''),
            clientHint: input.clientHint || null
        });
        if (!browser.allowed) {
            return {
                ok: false,
                status: 'browser',
                message: 'Chrome または Edge でのみ認証できます。'
            };
        }

        const lookup = this.tokens.peek(input.token);
        if (!lookup.record) {
            return {
                ok: false,
                status: lookup.status === 'expired' ? 'expired' : 'invalid',
                message: lookup.status === 'expired'
                    ? 'この認証リンクは期限切れです。Discordのパネルからもう一度発行してください。'
                    : 'この認証リンクは無効です。Discordのパネルからもう一度発行してください。'
            };
        }
        if (lookup.record.challengePassed) return { ok: true };

        const challenge = this.issueChallenge(input.token);
        if (!challenge) {
            return {
                ok: false,
                status: 'invalid',
                message: 'この認証リンクは無効です。Discordのパネルからもう一度発行してください。'
            };
        }

        const verdict = evaluateDragChallenge({
            challenge,
            itemId: input.itemId,
            drop: input.drop ?? null,
            samples: input.samples ?? null
        });
        if (verdict.ok) {
            this.tokens.markChallengePassed(input.token);
            return { ok: true };
        }

        const failure = this.tokens.registerChallengeFailure(input.token, DRAG_CHALLENGE_CONFIG.maxAttempts);
        if (!failure) {
            return {
                ok: false,
                status: 'invalid',
                message: 'この認証リンクは無効です。Discordのパネルからもう一度発行してください。'
            };
        }
        if (failure.locked) {
            return {
                ok: false,
                status: 'locked',
                message: `試行回数が上限（${DRAG_CHALLENGE_CONFIG.maxAttempts}回）に達しました。認証リンクは無効になりました。Discordのパネルから新しいリンクを発行してください。`
            };
        }

        const next = createDragChallenge();
        this.tokens.setChallenge(input.token, next);
        return {
            ok: false,
            status: 'failed',
            message: describeDragFailure(verdict.reason),
            attemptsLeft: Math.max(0, DRAG_CHALLENGE_CONFIG.maxAttempts - failure.attempts),
            challenge: next,
            reason: verdict.reason
        };
    }

    async submit(input: WebAuthSubmitInput): Promise<WebAuthSubmitResult> {
        const claim = this.tokens.claim(input.token);
        if (!claim.record) {
            return {
                ok: false,
                status: claim.status === 'expired' ? 'expired' : claim.status === 'in-use' ? 'in-use' : 'invalid',
                message: claim.status === 'expired'
                    ? 'この認証リンクは期限切れです。Discordのパネルからもう一度発行してください。'
                    : claim.status === 'in-use'
                        ? 'この認証リンクは処理中です。少し待ってから再試行してください。'
                        : 'この認証リンクは無効です。Discordのパネルからもう一度発行してください。'
            };
        }
        const token = claim.record;

        // The drag check is server-side state. A client flag is never trusted,
        // so a script that skips the page cannot reach the record/role steps.
        if (!token.challengePassed) {
            this.tokens.release(input.token);
            return {
                ok: false,
                status: 'challenge',
                message: '操作チェック（ドラッグ）が完了していません。ページを再読み込みしてやり直してください。'
            };
        }

        const browser = evaluateBrowserGate({
            userAgent: String(input.signals?.userAgent || ''),
            brands: input.signals?.uaCh?.brands || null,
            clientHint: input.clientHint || null
        });
        if (!browser.allowed) {
            this.tokens.release(input.token);
            return {
                ok: false,
                status: 'browser',
                message: 'Chrome または Edge でのみ認証できます。他のブラウザでは認証できません。',
                browser
            };
        }

        const intel = await this.intel.lookup(input.clientIp);
        if (intel.verdict === 'blocked') {
            this.tokens.release(input.token);
            return {
                ok: false,
                status: 'vpn',
                message: 'VPN・プロキシ経由では認証できません。'
            };
        }

        const target = await this.resolveTarget(token);
        if (!target) {
            this.tokens.release(input.token);
            return {
                ok: false,
                status: 'error',
                message: 'サーバーまたはメンバー情報を取得できませんでした。'
            };
        }

        try {
            const keys = await this.getKeys();
            const normalized = normalizeFingerprintSignals(input.signals);
            const ipHash = hashIp(keys.hmacSecret, input.clientIp);
            const fpHash = hashFingerprint(keys.hmacSecret, normalized);
            const signalHashes = hashFingerprintSignalComponents(keys.hmacSecret, normalized);
            const subnetHash = hashSubnet(keys.hmacSecret, input.clientIp);
            const createdAt = new Date().toISOString();
            const sealedPayload: SealedWebAuthPayload = {
                version: 1,
                guildId: token.guildId,
                userId: token.userId,
                createdAt,
                ip: input.clientIp,
                socketIp: input.socketIp,
                browser: {
                    name: browser.browser,
                    reason: browser.reason,
                    userAgent: normalized.userAgent,
                    brands: normalized.uaCh.brands
                },
                intel,
                signals: normalized
            };
            const sealed = sealPayload(JSON.stringify(sealedPayload), keys.encryptionKey);

            const grant = await this.grantVerifiedRoles(token.guildId, token.userId, token.roleIds, token.presetId);
            const warnings: string[] = [];
            if (grant.errors.length) {
                warnings.push(`ロール付与に失敗: ${grant.errors.join(' / ')}`);
            }
            const roleGranted = roleGrantSucceeded(grant);
            if (!roleGranted) {
                warnings.push(`ロール付与なし: ${grant.skipped.join(' / ') || '対象ロールなし'}`);
            }

            const record = createWebAuthRecord({
                guildId: token.guildId,
                userId: token.userId,
                source: 'web',
                browser: { name: browser.browser, reason: browser.reason },
                intel: {
                    verdict: intel.verdict,
                    flags: intel.flags,
                    source: intel.source
                },
                ipHash,
                fpHash,
                signalHashes,
                asn: intel.asn ?? null,
                subnetHash,
                sealed,
                presetId: token.presetId,
                roleGranted,
                createdAt
            });
            const stored = await this.records.add(token.guildId, record);
            let flagged = false;
            let matchCount = 0;
            try {
                const correlation = correlateWebAuthRecord(stored, record);
                matchCount = correlation.matchCount;
                const annotated = await this.annotateRisks(token.guildId, correlation.matches);
                const risky = annotated.filter((match) => match.risks.length > 0);

                if (risky.length) {
                    flagged = await antiCheatManager.flagWatchUserFromWebAuth(
                        token.guildId,
                        token.userId,
                        { matchCount: correlation.matchCount, matches: risky }
                    );
                    await antiCheatManager.sendWebAuthCorrelationLog(token.guildId, token.userId, risky);
                }
            } catch (error) {
                // The record and role are already committed; correlation is a
                // best-effort follow-up and must not burn the token.
                warnings.push('相関チェックに失敗しました（記録は保存済み）');
                Logger.warn(`[WebAuth] correlation failed for ${token.userId} in ${token.guildId}: ${String(error)}`);
            }

            // Alt-account graph propagation: the new record joins the graph and
            // is auto-flagged when its total edge weight toward bad nodes meets
            // the threshold. Best effort; the verification already succeeded.
            try {
                await antiCheatManager.evaluateAltGraphForUser(
                    token.guildId,
                    token.userId,
                    'webauth',
                    { webAuthRecords: stored }
                );
            } catch (error) {
                Logger.warn(`[WebAuth] graph evaluation failed for ${token.userId} in ${token.guildId}: ${String(error)}`);
            }

            this.tokens.consume(input.token);
            Logger.info(`[WebAuth] verified ${token.userId} in guild ${token.guildId} (matches=${matchCount}, flagged=${flagged})`);
            return {
                ok: true,
                record,
                matchCount,
                flagged,
                roleGranted,
                warnings
            };
        } catch (error) {
            this.tokens.release(input.token);
            Logger.error('[WebAuth] submit failed:', error instanceof Error ? error.message : String(error));
            return {
                ok: false,
                status: 'error',
                message: '認証情報を保存できませんでした。時間をおいて再試行してください。'
            };
        }
    }

    /** Staff override for VPN false positives / non-Chromium members. */
    async forceVerify(input: {
        guildId: string;
        userId: string;
        note?: string | null;
        actorId?: string | null;
    }): Promise<{ record: WebAuthRecord; grant: WebAuthRoleGrantResult } | { error: string }> {
        const target = await this.resolveTarget({ guildId: input.guildId, userId: input.userId });
        if (!target) return { error: 'メンバーが見つかりません。' };

        const grant = await this.grantVerifiedRoles(input.guildId, input.userId, [], null);
        const record = createWebAuthRecord({
            guildId: input.guildId,
            userId: input.userId,
            source: 'staff',
            browser: { name: null, reason: 'staff' },
            intel: { verdict: 'staff', flags: [], source: 'staff' },
            ipHash: null,
            fpHash: null,
            sealed: null,
            note: input.note ?? null,
            roleGranted: roleGrantSucceeded(grant)
        });
        await this.records.add(input.guildId, record);
        Logger.info(`[WebAuth] staff force-verified ${input.userId} in guild ${input.guildId}${input.actorId ? ` by ${input.actorId}` : ''}`);
        return { record, grant };
    }

    async listRecords(guildId: string): Promise<WebAuthRecordView[]> {
        const records = await this.records.list(guildId);
        return withWebAuthMatchCounts(records);
    }

    /**
     * Adds webAuthRoleId (the existing WEB認証ロール) plus the preset roles
     * captured when the panel button was pressed. Roles above the bot or
     * already held are skipped; one failure does not abort the rest.
     */
    async grantVerifiedRoles(
        guildId: string,
        userId: string,
        extraRoleIds: string[],
        presetId: string | null
    ): Promise<WebAuthRoleGrantResult> {
        const result: WebAuthRoleGrantResult = { granted: [], errors: [], skipped: [] };
        const client = this.botClient?.client;
        if (!client) {
            result.errors.push('Botクライアント未初期化');
            return result;
        }
        const guild = client.guilds.cache.get(guildId)
            || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            result.errors.push('サーバーが見つかりません');
            return result;
        }
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            result.errors.push('メンバーが見つかりません');
            return result;
        }

        const settings = await database.get<GrantableGuildSettings>(guildId, GUILD_SETTINGS_KEY(guildId), null);
        const roleIds = [...new Set([
            ...(settings?.webAuthRoleId ? [settings.webAuthRoleId] : []),
            ...extraRoleIds.filter((roleId) => typeof roleId === 'string' && roleId)
        ])];
        if (!roleIds.length) {
            result.skipped.push('WEB認証ロール未設定');
            return result;
        }

        const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
        for (const roleId of roleIds) {
            const role = guild.roles.cache.get(roleId)
                || await guild.roles.fetch(roleId).catch(() => null);
            if (!role || role.id === guild.id) {
                result.skipped.push(`${roleId}: ロールが見つかりません`);
                continue;
            }
            if (member.roles.cache.has(roleId)) {
                result.skipped.push(`${role.name}: 付与済み`);
                continue;
            }
            if (!me || role.position >= me.roles.highest.position) {
                result.errors.push(`${role.name}: Botのロール階層不足`);
                continue;
            }
            try {
                await member.roles.add(role, 'Web認証');
                result.granted.push(role.name);
                await RolePresetManager.logRoleChange({
                    timestamp: new Date().toISOString(),
                    guildId,
                    userId,
                    executorId: this.botClient?.client?.user?.id || '',
                    presetId: presetId || 'webauth',
                    action: 'add',
                    roleId: role.id,
                    roleName: role.name,
                    success: true
                });
            } catch (error) {
                result.errors.push(`${role.name}: 付与失敗`);
            }
        }
        return result;
    }

    private async resolveTarget(token: {
        guildId: string;
        userId: string;
    }): Promise<{ guild: Guild; member: GuildMember } | null> {
        const client = this.botClient?.client;
        if (!client) return null;
        const guild = client.guilds.cache.get(token.guildId)
            || await client.guilds.fetch(token.guildId).catch(() => null);
        if (!guild) return null;
        const member = await guild.members.fetch(token.userId).catch(() => null);
        if (!member) return null;
        if (member.user?.bot) return null;
        return { guild, member };
    }

    private async annotateRisks(guildId: string, matches: WebAuthMatch[]): Promise<WebAuthMatch[]> {
        if (!matches.length) return [];
        const [ledger, watchUsers] = await Promise.all([
            riskKickLedger.list(guildId).catch(() => []),
            antiCheatManager.getWatchUsers(guildId).catch(() => [])
        ]);
        const kicked = new Map<string, 'raid' | 'watch-danger'>(
            ledger.map((entry) => [entry.userId, entry.source] as const)
        );
        const watched = new Set(watchUsers.map((entry) => entry.userId));
        return matches.map((match) => {
            const risks: WebAuthMatch['risks'] = [];
            const kickSource = kicked.get(match.userId);
            if (kickSource === 'raid') risks.push('raid-kick');
            if (kickSource === 'watch-danger') risks.push('watch-danger-kick');
            if (watched.has(match.userId)) risks.push('watch-flagged');
            return { ...match, risks: [...new Set(risks)] };
        });
    }
}

export const webAuthService = new WebAuthService();
