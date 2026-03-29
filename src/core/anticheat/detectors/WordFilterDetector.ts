import { Message } from 'discord.js';
import { Detector, DetectionContext, DetectionResult, WordFilterRule } from '../types.js';
import { getDetectorConfig, normalizeContent } from '../utils.js';

function matchesRule(rule: WordFilterRule, content: string, normalized: string): boolean {
    switch (rule.mode) {
        case 'exact':
            return normalized === normalizeContent(rule.pattern);
        case 'regex':
            try {
                return new RegExp(rule.pattern, 'iu').test(content);
            } catch {
                return false;
            }
        case 'contains':
        default:
            return normalized.includes(rule.pattern.toLowerCase());
    }
}

export class WordFilterDetector implements Detector {
    name = 'wordFilter';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const rules = Array.isArray(detectorConfig.config?.rules)
            ? detectorConfig.config?.rules as WordFilterRule[]
            : [];

        if (rules.length === 0) {
            return { scoreDelta: 0, reasons: [] };
        }

        const content = message.content;
        const normalized = normalizeContent(content);
        const matchedRules = rules.filter((rule) => rule.enabled && rule.pattern && matchesRule(rule, content, normalized));

        if (matchedRules.length === 0) {
            return { scoreDelta: 0, reasons: [] };
        }

        const scoreDelta = matchedRules.reduce((sum, rule) => sum + Math.max(rule.score || detectorConfig.score, 0), 0);
        const deleteMessage = matchedRules.some((rule) => rule.deleteMessage) || detectorConfig.deleteMessage !== false;

        return {
            scoreDelta,
            reasons: matchedRules.map((rule) => `フィルターに一致しました: ${rule.label || rule.pattern}`),
            metadata: {
                matchedRules: matchedRules.map((rule) => ({
                    id: rule.id,
                    label: rule.label,
                    mode: rule.mode,
                    score: rule.score
                }))
            },
            deleteMessage
        };
    }
}
