import { Message } from 'discord.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { ensureAbsoluteUrl, extractUrls, getDetectorConfig, hostMatches, isDiscordInvite } from '../utils.js';

function isBlockedPattern(pattern: string, content: string): boolean {
    try {
        return new RegExp(pattern, 'i').test(content);
    } catch {
        return content.toLowerCase().includes(pattern.toLowerCase());
    }
}

export class InviteReferralDetector implements Detector {
    name = 'inviteReferral';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const config = detectorConfig.config || {};
        const urls = extractUrls(message.content);
        const blockedDomains = Array.isArray(config.blockedDomains) ? config.blockedDomains : [];
        const blockedPatterns = Array.isArray(config.blockedPatterns) ? config.blockedPatterns : [];

        const matchedUrls = urls.filter((url) => {
            if (isDiscordInvite(url)) {
                return true;
            }

            try {
                const parsed = new URL(ensureAbsoluteUrl(url));
                return blockedDomains.some((domain: string) => hostMatches(parsed.hostname, domain));
            } catch {
                return false;
            }
        });

        const matchedPatterns = blockedPatterns.filter((pattern: string) => isBlockedPattern(pattern, message.content));

        if (matchedUrls.length === 0 && matchedPatterns.length === 0) {
            return { scoreDelta: 0, reasons: [] };
        }

        const reasons: string[] = [];
        if (matchedUrls.some((url) => isDiscordInvite(url))) {
            reasons.push('Discord招待リンクを検知しました');
        }
        if (matchedUrls.some((url) => !isDiscordInvite(url))) {
            reasons.push('ブロック対象ドメインへのリンクを検知しました');
        }
        if (matchedPatterns.length > 0) {
            reasons.push(`紹介・広告パターンに一致しました (${matchedPatterns.length}件)`);
        }

        return {
            scoreDelta: detectorConfig.score * Math.max(1, matchedUrls.length + matchedPatterns.length),
            reasons,
            metadata: {
                matchedUrls,
                matchedPatterns
            },
            deleteMessage: detectorConfig.deleteMessage !== false
        };
    }
}
