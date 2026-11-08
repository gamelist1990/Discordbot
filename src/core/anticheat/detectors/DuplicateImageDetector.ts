import { Message } from 'discord.js';
import { CacheManager } from '../../../utils/CacheManager.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig } from '../utils.js';
import {
    calculateHashDistance,
    createImageFingerprint,
    downloadAttachment,
    getMediaAttachments,
    hasPerceptualDetail,
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
        const configuredDistance = Number(config.perceptualDistance);
        const perceptualDistance = Math.max(0, Math.min(16,
            config.perceptualDistance === undefined || config.perceptualDistance === null || !Number.isFinite(configuredDistance)
                ? 5
                : configuredDistance));
        const maxBytes = Math.max(256 * 1024, Number(config.maxFileSizeMb || 8) * 1024 * 1024);
        const timeoutMs = Math.max(500, Number(config.timeoutMs) || 3000);
        const scope = config.serverWide === true ? 'guild' : context.userId;
        const cacheKey = `anticheat:duplicate-image:${context.guildId}:${context.channelId}:${scope}`;
        const now = Date.now();
        const existing = (CacheManager.get<ImageRecord[]>(cacheKey) || [])
            .filter((entry) => now - entry.timestamp <= windowSeconds * 1000)
            .slice(-200);
        const previousMessageRecords = existing.filter((entry) => entry.messageId === message.id);
        const nextRecords = existing.filter((entry) => entry.messageId !== message.id);

        for (const attachment of getMediaAttachments(message).filter(isImageAttachment)) {
            const buffer = await downloadAttachment(attachment, maxBytes, timeoutMs);
            if (!buffer) {
                continue;
            }

            try {
                const fingerprint = await createImageFingerprint(buffer);
                // 投稿回数はメッセージ単位で数える。同一メッセージ内の複数添付は
                // 1回の投稿であり、自分自身とは照合しない（レコードの二重計上防止）。
                // また、単色・グラデーション等の勾配情報がほぼ無い画像は内容と
                // 無関係に知覚ハッシュが潰れるため、知覚マッチは双方に十分な
                // 情報量がある場合に限る（完全一致は sha256 で別途判定する）。
                const fingerprintHasDetail = hasPerceptualDetail(fingerprint.perceptualHash);
                const matchingRecords = nextRecords.filter((entry) => (
                    entry.messageId !== message.id
                    && (entry.sha256 === fingerprint.sha256
                        || (fingerprintHasDetail
                            && hasPerceptualDetail(entry.perceptualHash)
                            && calculateHashDistance(entry.perceptualHash, fingerprint.perceptualHash) <= perceptualDistance))
                ));
                const unchangedRecord = previousMessageRecords.find((entry) => entry.sha256 === fingerprint.sha256);
                if (unchangedRecord) {
                    nextRecords.push(unchangedRecord);
                    continue;
                }
                const duplicateCount = new Set(matchingRecords.map((entry) => entry.messageId)).size + 1;

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