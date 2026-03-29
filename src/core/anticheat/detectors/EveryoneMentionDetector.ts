import { Message, PermissionFlagsBits } from 'discord.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig } from '../utils.js';

export class EveryoneMentionDetector implements Detector {
    name = 'everyoneMention';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        if (message.member?.permissions.has(PermissionFlagsBits.MentionEveryone)) {
            return { scoreDelta: 0, reasons: [] };
        }

        const detectorConfig = getDetectorConfig(context, this.name);
        const roleBypassMention = message.mentions.roles.some((role) => {
            const normalized = role.name.toLowerCase();
            return normalized === 'everyone' || normalized === 'here';
        });

        if (!message.mentions.everyone && !/@(?:everyone|here)/i.test(message.content) && !roleBypassMention) {
            return { scoreDelta: 0, reasons: [] };
        }

        return {
            scoreDelta: detectorConfig.score,
            reasons: ['@everyone / @here 系の大量通知を検知しました'],
            metadata: {
                mentionsEveryone: message.mentions.everyone,
                roleBypassMention
            },
            deleteMessage: detectorConfig.deleteMessage !== false
        };
    }
}
