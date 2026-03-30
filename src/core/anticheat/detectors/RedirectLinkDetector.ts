import { Message } from 'discord.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import {
    assessRedirectRisk,
    ensureAbsoluteUrl,
    extractUrls,
    getDetectorConfig,
    isDiscordInvite,
    resolveRedirectChain
} from '../utils.js';

export class RedirectLinkDetector implements Detector {
    name = 'redirectLink';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const config = detectorConfig.config || {};
        const allowDomains = Array.isArray(config.allowDomains) ? config.allowDomains : [];
        const maxDepth = Number(config.maxDepth) || 5;
        const timeoutMs = Number(config.timeoutMs) || 2500;
        const urls = extractUrls(message.content).slice(0, 3);

        for (const rawUrl of urls) {
            try {
                const preparedUrl = ensureAbsoluteUrl(rawUrl);
                if (isDiscordInvite(preparedUrl)) {
                    continue;
                }

                const resolution = await resolveRedirectChain(preparedUrl, { maxDepth, timeoutMs });
                if (!resolution.changed) {
                    continue;
                }

                const risk = assessRedirectRisk(resolution, allowDomains);
                if (!risk) {
                    continue;
                }

                return {
                    scoreDelta: detectorConfig.score,
                    reasons: [risk.summary],
                    metadata: {
                        originalUrl: preparedUrl,
                        finalUrl: resolution.finalUrl,
                        chain: resolution.chain,
                        suspectUrl: risk.suspectUrl
                    },
                    deleteMessage: detectorConfig.deleteMessage !== false,
                    publicNotice: {
                        title: '危険な転送リンクをブロックしました',
                        description: 'IPロガーや不審な中継先、隠された招待・紹介リンクを含むため停止しました。',
                        level: risk.level,
                        fields: [
                            { name: '元のリンク', value: preparedUrl, inline: false },
                            { name: '到達先', value: resolution.finalUrl, inline: false },
                            { name: '危険箇所', value: risk.suspectUrl, inline: false },
                            { name: '判定', value: risk.summary, inline: false }
                        ],
                        footer: 'アクセスする場合は自己責任で確認してください。'
                    }
                };
            } catch {
                continue;
            }
        }

        return {
            scoreDelta: 0,
            reasons: []
        };
    }
}
