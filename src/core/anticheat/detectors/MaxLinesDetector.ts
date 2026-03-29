import { Message } from 'discord.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig, scoreBuckets } from '../utils.js';

export class MaxLinesDetector implements Detector {
    name = 'maxLines';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const config = detectorConfig.config || {};
        const maxLines = Number(config.maxLines) || 10;
        const lineCount = message.content.split(/\r?\n/).length;
        const buckets = scoreBuckets(lineCount, maxLines);

        if (buckets === 0) {
            return { scoreDelta: 0, reasons: [] };
        }

        return {
            scoreDelta: detectorConfig.score * buckets,
            reasons: [`最大行数を超えるメッセージを検知しました (${lineCount}/${maxLines})`],
            metadata: {
                lineCount,
                maxLines
            },
            deleteMessage: detectorConfig.deleteMessage !== false
        };
    }
}
