import { Message } from 'discord.js';
import { CacheManager } from '../../../utils/CacheManager.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig } from '../utils.js';
import {
    calculateHashDistance,
    createImageFingerprint,
    downloadAttachment,
    getMediaAttachments,
    isImageAttachment
} from './MediaSafetyUtils.js';

interface ImageRecord {
    sha256: string;
    perceptualHash: string;
    timestamp: number;
    messageId: string;
    userId: string;
}

export class DuplicateImageDetector implements Detector {
    name = 'duplicateImage';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const config = detectorConfig.config || {};
        const windowSeconds = Math.max(1, Number(config.windowSeconds) || 300);
        const deleteFrom = Math.max(2, Number(config.deleteFrom) || 2);
        const scoreFrom = Math.max(deleteFrom, Number(config.scoreFrom) || 3);
        const perceptualDistance = Math.max(0, Math.min(16, Number(config.perceptualDistance) || 5));
        const maxBytes = Math.max(256 * 1024, Number(config.maxFileSizeMb || 8) * 1024 * 1024);
        const timeoutMs = Math.max(500, Number(config.timeoutMs) || 3000);
        const scope = config.serverWide === true ? 'guild' : context.userId;
        const cacheKey = `anticheat:duplicate-image:${context.guildId}:${context.channelId}:${scope}`;
        const now = Date.now();
        const existing = (CacheManager.get<ImageRecord[]>(cacheKey) || [])
            .filter((entry) => now - entry.timestamp <= windowSeconds * 1000)
            .slice(-200);
        const nextRecords = [...existing];

        for (const attachment of getMediaAttachments(message).filter(isImageAttachment)) {
            const buffer = await downloadAttachment(attachment, maxBytes, timeoutMs);
            if (!buffer) {
                continue;
            }

            try {
                const fingerprint = await createImageFingerprint(buffer);
                const matchingRecords = existing.filter((entry) => (
                    entry.sha256 === fingerprint.sha256
                    || calculateHashDistance(entry.perceptualHash, fingerprint.perceptualHash) <= perceptualDistance
                ));
                const duplicateCount = matchingRecords.length + 1;

                nextRecords.push({
                    ...fingerprint,
                    timestamp: now,
                    messageId: message.id,
                    userId: context.userId
                });

                if (duplicateCount < deleteFrom) {
                    continue;
                }

                CacheManager.set(cacheKey, nextRecords.slice(-200), (windowSeconds + 30) * 1000);
                const scoreMultiplier = duplicateCount >= scoreFrom
                    ? duplicateCount - scoreFrom + 1
                    : 0;

                return {
                    scoreDelta: detectorConfig.score * scoreMultiplier,
                    reasons: [`同一または酷似した画像を ${duplicateCount} 回投稿しました`],
                    metadata: {
                        attachmentId: attachment.id,
                        attachmentName: attachment.name,
                        duplicateCount,
                        exactDuplicate: matchingRecords.some((entry) => entry.sha256 === fingerprint.sha256),
                        perceptualDistance,
                        windowSeconds
                    },
                    deleteMessage: detectorConfig.deleteMessage !== false
                };
            } catch {
                continue;
            }
        }

        CacheManager.set(cacheKey, nextRecords.slice(-200), (windowSeconds + 30) * 1000);
        return { scoreDelta: 0, reasons: [] };
    }
}