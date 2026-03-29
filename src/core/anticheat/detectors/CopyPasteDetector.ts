import { Message } from 'discord.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig, normalizeContent } from '../utils.js';

const DEFAULT_SUSPICIOUS_TERMS = [
    'free nitro',
    'gifted nitro',
    'discord is giving away',
    'steam gift',
    'copy and paste',
    'everyone copy this',
    'claim your reward'
];

export class CopyPasteDetector implements Detector {
    name = 'copyPaste';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const config = detectorConfig.config || {};
        const minLength = Number(config.minLength) || 80;
        const content = message.content || '';
        if (content.length < minLength) {
            return { scoreDelta: 0, reasons: [] };
        }

        const normalized = normalizeContent(content);
        const suspiciousTerms = Array.isArray(config.suspiciousTerms) && config.suspiciousTerms.length > 0
            ? config.suspiciousTerms
            : DEFAULT_SUSPICIOUS_TERMS;

        const matchedTerms = suspiciousTerms.filter((term: string) => normalized.includes(term.toLowerCase()));
        const zeroWidthCount = (content.match(/[\u200B-\u200F\u2060\uFEFF]/g) || []).length;
        const decorativeCount = (content.match(/[▓▒░█▄▀▌▐■□◆◇▲△▼▽]/g) || []).length;
        const repeatedLineCount = content
            .split(/\r?\n/)
            .filter((line) => line.trim().length >= 12)
            .reduce<Record<string, number>>((acc, line) => {
                const key = normalizeContent(line);
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {});

        const repeatedBlock = Object.values(repeatedLineCount).some((count) => count >= 3);
        const reasons: string[] = [];

        if (matchedTerms.length > 0) {
            reasons.push(`コピー・詐欺系フレーズに一致しました (${matchedTerms.length}件)`);
        }
        if (zeroWidthCount >= 2) {
            reasons.push('ゼロ幅文字を含む不審なコピペ文面を検知しました');
        }
        if (decorativeCount >= 6) {
            reasons.push('装飾文字の多いコピペ文面を検知しました');
        }
        if (repeatedBlock) {
            reasons.push('同じ行の繰り返しを含むコピペ文面を検知しました');
        }

        if (reasons.length === 0) {
            return { scoreDelta: 0, reasons: [] };
        }

        return {
            scoreDelta: detectorConfig.score * Math.max(1, reasons.length),
            reasons,
            metadata: {
                matchedTerms,
                zeroWidthCount,
                decorativeCount
            },
            deleteMessage: detectorConfig.deleteMessage !== false
        };
    }
}
