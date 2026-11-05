import { Message } from 'discord.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig, scoreBuckets } from '../utils.js';
import { extractMentions, positiveSetting } from '../MentionWindow.js';

export class MentionLimitDetector implements Detector {
    name = 'mentionLimit';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const config = detectorConfig.config || {};
        const maxUserMentions = positiveSetting(config.maxUserMentions, 200);
        const maxRoleMentions = positiveSetting(config.maxRoleMentions, 200);
        const mentions = extractMentions(message.content || '');
        const userMentionCount = mentions.userIds.length;
        const roleMentionCount = mentions.roleIds.length;

        const userBuckets = scoreBuckets(userMentionCount, maxUserMentions);
        const roleBuckets = scoreBuckets(roleMentionCount, maxRoleMentions);

        if (userBuckets === 0 && roleBuckets === 0) {
            return { scoreDelta: 0, reasons: [] };
        }

        const reasons: string[] = [];
        if (userBuckets > 0) {
            reasons.push(`ユーザー言及数が上限を超えました (${userMentionCount}/${maxUserMentions})`);
        }
        if (roleBuckets > 0) {
            reasons.push(`ロール言及数が上限を超えました (${roleMentionCount}/${maxRoleMentions})`);
        }

        return {
            scoreDelta: detectorConfig.score * (userBuckets + roleBuckets),
            reasons,
            metadata: {
                userMentionCount,
                roleMentionCount,
                maxUserMentions,
                maxRoleMentions
            },
            deleteMessage: detectorConfig.deleteMessage !== false
        };
    }
}
