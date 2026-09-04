import { Message } from 'discord.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig } from '../utils.js';
import {
    analyzeGifFlash,
    downloadAttachment,
    getMediaAttachments,
    isGifAttachment
} from './MediaSafetyUtils.js';

export class GifFlashDetector implements Detector {
    name = 'gifFlash';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const config = detectorConfig.config || {};
        const timeoutMs = Math.max(500, Number(config.timeoutMs) || 3000);
        const gifAttachments = getMediaAttachments(message).filter(isGifAttachment);

        for (const attachment of gifAttachments) {
            // No file-size cutoff, including for guilds with the legacy maxFileSizeMb setting.
            const buffer = await downloadAttachment(attachment, Number.POSITIVE_INFINITY, timeoutMs);
            if (!buffer) {
                continue;
            }

            try {
                const analysis = await analyzeGifFlash(buffer, {
                    maxSampleFrames: Number(config.maxSampleFrames) || 12,
                    luminanceDeltaThreshold: Number(config.luminanceDeltaThreshold) || 80,
                    pixelDeltaThreshold: Number(config.pixelDeltaThreshold) || 70,
                    minimumTransitions: Number(config.minimumTransitions) || 2,
                    minimumFlashScore: Number(config.minimumFlashScore) || 0.55
                });

                if (!analysis.hazardous) {
                    continue;
                }

                return {
                    scoreDelta: detectorConfig.score,
                    reasons: ['強い明暗変化を繰り返す点滅GIFを検知しました'],
                    metadata: {
                        attachmentId: attachment.id,
                        attachmentName: attachment.name,
                        ...analysis
                    },
                    deleteMessage: detectorConfig.deleteMessage !== false,
                    publicNotice: {
                        title: '⚠️ 点滅GIFを削除しました',
                        description: '強い点滅による健康被害や嫌がらせを防ぐため、画像を非表示にしました。',
                        level: 'danger'
                    }
                };
            } catch {
                continue;
            }
        }

        return { scoreDelta: 0, reasons: [] };
    }
}
