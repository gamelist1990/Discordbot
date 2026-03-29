import { Message } from 'discord.js';
import { CacheManager } from '../../../utils/CacheManager.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig, normalizeContent } from '../utils.js';

interface DuplicateRecord {
    content: string;
    timestamp: number;
}

export class DuplicateMessageDetector implements Detector {
    name = 'duplicateMessage';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const config = detectorConfig.config || {};
        const windowSeconds = Number(config.windowSeconds) || 180;
        const deleteFrom = Number(config.deleteFrom) || 2;
        const scoreFrom = Number(config.scoreFrom) || 4;
        const cacheKey = `anticheat:duplicate:${context.guildId}:${context.userId}`;
        const normalized = normalizeContent(message.content);

        if (!normalized) {
            return { scoreDelta: 0, reasons: [] };
        }

        const now = Date.now();
        const existing = (CacheManager.get<DuplicateRecord[]>(cacheKey) || [])
            .filter((entry) => now - entry.timestamp <= windowSeconds * 1000);
        const next = [...existing, { content: normalized, timestamp: now }];
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
