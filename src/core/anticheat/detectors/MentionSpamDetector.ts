import type { Message } from 'discord.js';
import { CacheManager } from '../../../utils/CacheManager.js';
import type { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig, getEffectiveContent } from '../utils.js';
import { extractMentions, MentionWindow, positiveSetting } from '../MentionWindow.js';

export class MentionSpamDetector implements Detector {
    name = 'mentionSpam';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detector = getDetectorConfig(context, this.name);
        const config = detector.config || {};
        const windowSeconds = positiveSetting(config.windowSeconds, 30, 3600);
        const sameUserMentionThreshold = positiveSetting(config.sameUserMentionThreshold, 5);
        const roleMentionThreshold = positiveSetting(config.roleMentionThreshold, 5);
        const totalMentionThreshold = positiveSetting(config.totalMentionThreshold, 10);
        const uniqueUserMentionThreshold = positiveSetting(config.uniqueUserMentionThreshold, 8);
        const mentions = extractMentions(getEffectiveContent(message));
        const key = `anticheat:mention-window:v2:${context.guildId}:${context.userId}`;
        const window = CacheManager.get<MentionWindow>(key) || new MentionWindow();
        const changed = window.update(message.id, mentions, context.receivedAt ?? Date.now(), windowSeconds * 1000);
        CacheManager.set(key, window, (windowSeconds + 1) * 1000);
        if (!changed) return { scoreDelta: 0, reasons: [] };

        let repeatedUserMentions = 0, repeatedRoleMentions = 0;
        // Only current targets can cause a new violation.
        for (const id of mentions.userIds) repeatedUserMentions = Math.max(repeatedUserMentions, window.users.get(id) || 0);
        for (const id of mentions.roleIds) repeatedRoleMentions = Math.max(repeatedRoleMentions, window.roles.get(id) || 0);
        const windowRoleMentions = window.roleCount;
        const uniqueUserMentions = window.users.size;
        const windowTotalMentions = window.userCount + window.roleCount;
        const reasons: string[] = [];
        let multiplier = 0;
        const check = (count: number, threshold: number, reason: string) => {
            if (count < threshold) return;
            reasons.push(`${reason}を検知しました (${count}回/${windowSeconds}秒)`);
            multiplier += Math.max(1, Math.ceil(count / threshold) - 1);
        };
        check(repeatedUserMentions, sameUserMentionThreshold, '同一ユーザーへのメンションスパム');
        // Rotation spam: many distinct targets, each mentioned only once or twice,
        // stays under the per-target and total thresholds but is still a burst.
        if (mentions.userIds.length && uniqueUserMentions >= uniqueUserMentionThreshold) {
            reasons.push(`多数の異なるユーザーへのメンションを検知しました (${uniqueUserMentions}人/${windowSeconds}秒)`);
            multiplier += Math.max(1, Math.ceil(uniqueUserMentions / uniqueUserMentionThreshold) - 1);
        }
        if (mentions.roleIds.length) check(windowRoleMentions, roleMentionThreshold, 'ロールメンションスパム');
        check(windowTotalMentions, totalMentionThreshold, '大量メンション');
        return {
            scoreDelta: detector.score * multiplier,
            reasons,
            ...(reasons.length ? { deleteMessage: detector.deleteMessage !== false } : {}),
            metadata: {
                userMentionCount: mentions.userIds.length, roleMentionCount: mentions.roleIds.length,
                repeatedUserMentions, repeatedRoleMentions, windowRoleMentions, windowTotalMentions, uniqueUserMentions,
                windowSeconds, sameUserMentionThreshold, roleMentionThreshold, totalMentionThreshold, uniqueUserMentionThreshold
            }
        };
    }
}
