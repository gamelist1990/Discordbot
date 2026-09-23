import { Message } from 'discord.js';
import { CacheManager } from '../../../utils/CacheManager.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig, normalizeContent } from '../utils.js';

interface DuplicateRecord {
    content: string;
    timestamp: number;
    messageId: string;
}

export class DuplicateMessageDetector implements Detector {
    name = 'duplicateMessage';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const config = detectorConfig.config || {};
        const windowSeconds = Number(config.windowSeconds) || 180;
        const deleteFrom = Number(config.deleteFrom) || 2;
        const scoreFrom = Number(config.scoreFrom) || 4;
        const cacheKey = `anticheat:duplicate:${context.guildId}:${context.channelId}:${context.userId}`;
        const normalized = normalizeContent(message.content);
        const now = Date.now();
        const existing = (CacheManager.get<DuplicateRecord[]>(cacheKey) || [])
            .filter((entry) => now - entry.timestamp <= windowSeconds * 1000);
        const previous = existing.find((entry) => entry.messageId === message.id);
        const withoutCurrent = existing.filter((entry) => entry.messageId !== message.id);

        if (!normalized) {
            CacheManager.set(cacheKey, withoutCurrent, (windowSeconds + 30) * 1000);
            return { scoreDelta: 0, reasons: [] };
        }

        if (previous?.content === normalized) {
            return { scoreDelta: 0, reasons: [] };
        }

        const next = [
            ...withoutCurrent,
            { content: normalized, timestamp: previous?.timestamp ?? now, messageId: message.id }
        ];
        CacheManager.set(cacheKey, next, (windowSeconds + 30) * 1000);

        const duplicateCount = next.filter((entry) => entry.content === normalized).length;
        if (duplicateCount < deleteFrom) {
            return { scoreDelta: 0, reasons: [] };
        }

        const scoreMultiplier = duplicateCount >= scoreFrom
            ? duplicateCount - scoreFrom + 1
            : 0;

        return {
            scoreDelta: detectorConfig.score * scoreMultiplier,
            reasons: [`重複メッセージを ${duplicateCount} 回送信しました`],
            metadata: {
                duplicateCount,
                deleteFrom,
                scoreFrom
            },
            deleteMessage: detectorConfig.deleteMessage !== false
        };
    }
}
