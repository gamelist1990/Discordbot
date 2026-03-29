import { Message } from 'discord.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import {
    ensureAbsoluteUrl,
    extractUrls,
    getDetectorConfig,
    isDiscordInvite,
    isKnownSafeRedirectHost,
    resolveRedirectChain,
    urlHasReferralPattern
} from '../utils.js';

function inferRiskLevel(finalUrl: string): { level: 'warning' | 'danger'; summary: string } {
    if (isDiscordInvite(finalUrl)) {
        return { level: 'danger', summary: '最終到達先がDiscord招待リンクです' };
    }

    if (urlHasReferralPattern(finalUrl)) {
        return { level: 'danger', summary: '最終到達先に紹介・アフィリエイト系パラメータが含まれています' };
    }

    return { level: 'warning', summary: '未知のリダイレクトドメイン経由のリンクです' };
}

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
                const parsed = new URL(preparedUrl);
                if (isKnownSafeRedirectHost(parsed.hostname, allowDomains) || isDiscordInvite(preparedUrl)) {
                    continue;
                }

                const resolution = await resolveRedirectChain(preparedUrl, { maxDepth, timeoutMs });
                if (!resolution.changed) {
                    continue;
                }

                const risk = inferRiskLevel(resolution.finalUrl);
                return {
                    scoreDelta: detectorConfig.score,
                    reasons: [risk.summary],
                    metadata: {
                        originalUrl: preparedUrl,
                        finalUrl: resolution.finalUrl,
                        chain: resolution.chain
                    },
                    deleteMessage: detectorConfig.deleteMessage !== false,
                    publicNotice: {
                        title: 'リダイレクトリンクをブロックしました',
                        description: '短縮URLや未知の中継ドメインを使ったリンクは、安全確認のため一度停止されます。',
                        level: risk.level,
                        fields: [
                            { name: '元のリンク', value: preparedUrl, inline: false },
                            { name: '到達先', value: resolution.finalUrl, inline: false },
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
