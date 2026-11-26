import type { Request, Response } from 'express';
import type { BotClient } from '../../../core/platform/BotClient.js';
import { webAuthService } from '../../../core/webauth/WebAuthService.js';
import type { WebAuthRecordView } from '../../../core/webauth/records.js';
import { Logger } from '../../../utils/Logger.js';
import { hasAccessToGuild, hasGuildMutationAccess } from './AntiCheatController.js';

interface MemberIdentity {
    username: string;
    displayName: string;
    avatar: string | null;
}

/** Only these fields may leave the server; sealed data and hashes stay local. */
function safeRecord(record: WebAuthRecordView, identity: MemberIdentity | null): Record<string, unknown> {
    return {
        id: record.id,
        userId: record.userId,
        createdAt: record.createdAt,
        source: record.source,
        verified: record.verified,
        browser: record.browser,
        intel: record.intel,
        presetId: record.presetId,
        note: record.note,
        roleGranted: record.roleGranted,
        matchCount: record.matchCount,
        matchedUserIds: record.matchedUserIds,
        username: identity?.username || '不明',
        displayName: identity?.displayName || '不明',
        avatar: identity?.avatar || null
    };
}

export class WebAuthController {
    constructor(private botClient: BotClient) {
        webAuthService.setBotClient(botClient);
    }

    /** GET /api/staff/anticheat/:guildId/webauth */
    getRecords = async (req: Request, res: Response): Promise<void> => {
        const guildId = String(req.params.guildId);
        const session = (req as any).session;
        if (!session || !hasAccessToGuild(session, guildId)) {
            res.status(403).json({ error: 'Access denied to this guild' });
            return;
        }
        try {
            const records = await webAuthService.listRecords(guildId);
            const identities = await this.resolveIdentities(guildId, records.map((record) => record.userId));
            res.json({
                records: records.map((record) => safeRecord(record, identities.get(record.userId) || null))
            });
        } catch (error) {
            Logger.error('Error getting WebAuth records:', error);
            res.status(500).json({ error: 'Failed to get WebAuth records' });
        }
    };

    /** POST /api/staff/anticheat/:guildId/webauth/force-verify */
    forceVerify = async (req: Request, res: Response): Promise<void> => {
        const guildId = String(req.params.guildId);
        const session = (req as any).session;
        if (!session || !(await hasGuildMutationAccess(this.botClient, session, guildId))) {
            res.status(403).json({ error: 'Access denied to this guild' });
            return;
        }
        const userId = String(req.body?.userId || '');
        const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null;
        if (!/^[1-9]\d{0,19}$/.test(userId)) {
            res.status(400).json({ error: 'ユーザーIDが不正です。' });
            return;
        }

        try {
            const result = await webAuthService.forceVerify({
                guildId,
                userId,
                note,
                actorId: session.userId ? String(session.userId) : null
            });
            if ('error' in result) {
                res.status(404).json({ error: result.error });
                return;
            }
            const identities = await this.resolveIdentities(guildId, [userId]);
            const record = (await webAuthService.listRecords(guildId)).find((entry) => entry.id === result.record.id);
            res.json({
                success: true,
                roleGranted: result.record.roleGranted,
                warnings: [...result.grant.errors, ...result.grant.skipped],
                record: record ? safeRecord(record, identities.get(userId) || null) : safeRecord(
                    { ...result.record, matchCount: 0, matchedUserIds: [] },
                    identities.get(userId) || null
                )
            });
        } catch (error) {
            Logger.error('Error force-verifying WebAuth user:', error);
            res.status(500).json({ error: 'Failed to force-verify user' });
        }
    };

    private async resolveIdentities(guildId: string, userIds: string[]): Promise<Map<string, MemberIdentity>> {
        const result = new Map<string, MemberIdentity>();
        const guild = this.botClient.client.guilds.cache.get(guildId)
            || await this.botClient.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return result;

        const unique = [...new Set(userIds.filter(Boolean))];
        for (const userId of unique) {
            const cached = guild.members.cache.get(userId);
            if (cached) {
                result.set(userId, {
                    username: cached.user.username,
                    displayName: cached.displayName || cached.user.username,
                    avatar: cached.user.avatarURL() || null
                });
            }
        }

        const missing = unique.filter((userId) => !result.has(userId));
        for (let index = 0; index < missing.length; index += 100) {
            const chunk = missing.slice(index, index + 100);
            const fetched = await guild.members.fetch({ user: chunk }).catch(() => null);
            if (!fetched) break;
            for (const member of fetched.values()) {
                result.set(member.id, {
                    username: member.user.username,
                    displayName: member.displayName || member.user.username,
                    avatar: member.user.avatarURL() || null
                });
            }
        }
        return result;
    }
}
