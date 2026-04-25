import { Message } from 'discord.js';
import { CacheManager } from '../../../utils/CacheManager.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig } from '../utils.js';

interface MentionRecord {
    timestamp: number;
    userIds: string[];
    roleIds: string[];
    messageId: string;
}

function extractMentionIds(content: string, pattern: RegExp): string[] {
    const ids: string[] = [];
    for (const match of content.matchAll(pattern)) {
        if (match[1]) {
            ids.push(match[1]);
        }
    }
    return ids;
}

function countById(ids: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const id of ids) {
        counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
}

function maxCount(counts: Map<string, number>): number {
    return Math.max(0, ...counts.values());
}

export class MentionSpamDetector implements Detector {
    name = 'mentionSpam';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const config = detectorConfig.config || {};
        const windowSeconds = Number(config.windowSeconds) || 30;
        const sameUserMentionThreshold = Number(config.sameUserMentionThreshold) || 5;
        const roleMentionThreshold = Number(config.roleMentionThreshold) || 5;
        const totalMentionThreshold = Number(config.totalMentionThreshold) || 10;
        const content = message.content || '';
        const userIds = extractMentionIds(content, /<@!?(\d+)>/g);
        const roleIds = extractMentionIds(content, /<@&(\d+)>/g);

        if (userIds.length === 0 && roleIds.length === 0) {
            return { scoreDelta: 0, reasons: [] };
        }

        const now = Date.now();
        const windowMs = windowSeconds * 1000;
        const cacheKey = `anticheat:mention-spam:${context.guildId}:${context.userId}`;
        const previous = (CacheManager.get<MentionRecord[]>(cacheKey) || [])
            .filter((entry) => now - entry.timestamp <= windowMs);
        const next = [
            ...previous,
            {
                timestamp: now,
                userIds,
                roleIds,
                messageId: message.id
            }
        ];
        CacheManager.set(cacheKey, next, (windowSeconds + 30) * 1000);

        const windowUserCounts = countById(next.flatMap((entry) => entry.userIds));
        const windowRoleMentions = next.reduce((sum, entry) => sum + entry.roleIds.length, 0);
        const windowTotalMentions = next.reduce((sum, entry) => sum + entry.userIds.length + entry.roleIds.length, 0);
        const repeatedUserMentions = maxCount(windowUserCounts);
        const sameMessageRepeatedUserMentions = maxCount(countById(userIds));
        const sameMessageRoleMentions = roleIds.length;
        const sameMessageTotalMentions = userIds.length + roleIds.length;

        const reasons: string[] = [];
        let scoreMultiplier = 0;

        if (sameMessageRepeatedUserMentions >= sameUserMentionThreshold || repeatedUserMentions >= sameUserMentionThreshold) {
            const count = Math.max(sameMessageRepeatedUserMentions, repeatedUserMentions);
            reasons.push(`同一ユーザーへのメンションスパムを検知しました (${count}回/${windowSeconds}秒)`);
            scoreMultiplier += Math.max(1, Math.ceil(count / sameUserMentionThreshold) - 1);
        }

        if (sameMessageRoleMentions >= roleMentionThreshold || windowRoleMentions >= roleMentionThreshold) {
            const count = Math.max(sameMessageRoleMentions, windowRoleMentions);
            reasons.push(`ロールメンションスパムを検知しました (${count}回/${windowSeconds}秒)`);
            scoreMultiplier += Math.max(1, Math.ceil(count / roleMentionThreshold) - 1);
        }

        if (sameMessageTotalMentions >= totalMentionThreshold || windowTotalMentions >= totalMentionThreshold) {
            const count = Math.max(sameMessageTotalMentions, windowTotalMentions);
            reasons.push(`大量メンションを検知しました (${count}回/${windowSeconds}秒)`);
            scoreMultiplier += Math.max(1, Math.ceil(count / totalMentionThreshold) - 1);
        }

        if (reasons.length === 0) {
            return {
                scoreDelta: 0,
                reasons: [],
                metadata: {
                    userMentionCount: userIds.length,
                    roleMentionCount: roleIds.length,
                    windowTotalMentions,
                    repeatedUserMentions
                }
            };
        }

        return {
            scoreDelta: detectorConfig.score * scoreMultiplier,
            reasons,
            metadata: {
                userMentionCount: userIds.length,
                roleMentionCount: roleIds.length,
                windowTotalMentions,
                repeatedUserMentions,
                windowRoleMentions,
                windowSeconds,
                sameUserMentionThreshold,
                roleMentionThreshold,
                totalMentionThreshold
            },
            deleteMessage: detectorConfig.deleteMessage !== false
        };
    }
}
