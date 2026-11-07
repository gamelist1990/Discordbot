import { Message } from 'discord.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { CacheManager } from '../../../utils/CacheManager.js';
import { createSimilaritySignature, getDetectorConfig, normalizeContent } from '../utils.js';

interface MessageRecord {
    content: string;
    signature: string;
    timestamp: number;
    messageId: string;
}

/**
 * Detects text spam by analyzing recent messages
 * Checks for:
 * - Duplicate message content
 * - Similar duplicate content (random trailing strings / invite code variations)
 * - Rapid message sending
 */
export class TextSpamDetector implements Detector {
    name = 'textSpam';

    /**
     * Detect spam patterns in a message
     */
    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detectorConfig = getDetectorConfig(context, this.name);
        const config = detectorConfig.config || {};
        const maxMessages = Number(config.maxMessages) || 12;
        const duplicateThreshold = Number(config.duplicateThreshold) || 3;
        const repeatedLineThreshold = Number(config.repeatedLineThreshold) || 3;
        const rapidThreshold = Number(config.rapidMessageCount) || 6;
        const rapidWindowMs = (Number(config.windowSeconds) || 5) * 1000;
        const cacheKey = `anticheat:messages:${context.guildId}:${context.channelId}:${context.userId}`;
        const normalizedContent = normalizeContent(message.content);
        const signature = createSimilaritySignature(normalizedContent);
        const now = context.receivedAt ?? Date.now();

        // Get user's recent messages from cache
        let recentMessages = (CacheManager.get<MessageRecord[]>(cacheKey) || [])
            .filter((record) => now - record.timestamp <= Math.max(rapidWindowMs, 60_000));
        const previous = recentMessages.find((record) => record.messageId === message.id);

        if (previous?.content === normalizedContent) {
            return { scoreDelta: 0, reasons: [] };
        }

        // Replace edits instead of counting the same Discord message as a new post.
        recentMessages = recentMessages.filter((record) => record.messageId !== message.id);
        recentMessages.push({
            content: normalizedContent,
            signature,
            timestamp: previous?.timestamp ?? now,
            messageId: message.id
        });

        // Keep only last maxMessages
        if (recentMessages.length > maxMessages) {
            recentMessages = recentMessages.slice(-maxMessages);
        }

        // Update cache (TTL: 1 minute)
        CacheManager.set(cacheKey, recentMessages, 60 * 1000);

        // Count identical lines inside this single message. Lines are compared
        // by signature, so rotating mentions or random tails per line still
        // count as repeats; mention runs collapse to one placeholder.
        const lineCounts = new Map<string, number>();
        for (const rawLine of message.content.split(/\r?\n/)) {
            const lineSignature = createSimilaritySignature(normalizeContent(rawLine))
                .replace(/(<@>)(?: \1)+/g, '$1');
            if (lineSignature.length < 6) continue;
            lineCounts.set(lineSignature, (lineCounts.get(lineSignature) || 0) + 1);
        }
        const repeatedLineCount = lineCounts.size ? Math.max(...lineCounts.values()) : 0;

        // Analyze for spam patterns
        const reasons: string[] = [];
        let scoreDelta = 0;

        // Check for duplicate messages
        const duplicateCount = recentMessages.filter(
            m => m.content === normalizedContent
        ).length;

        // Check for similar duplicates that only differ in random filler
        // (random trailing tokens or invite-code tails).
        const similarCount = recentMessages.filter(
            m => (m.signature ?? createSimilaritySignature(m.content)) === signature
        ).length;

        if (repeatedLineCount >= repeatedLineThreshold) {
            scoreDelta += detectorConfig.score;
            reasons.push(`同一行の繰り返しを検知しました (${repeatedLineCount}行)`);
        }

        if (duplicateCount >= duplicateThreshold) {
            scoreDelta += detectorConfig.score;
            reasons.push(`短時間の重複投稿を検知しました (${duplicateCount}回)`);
        } else if (similarCount >= duplicateThreshold) {
            scoreDelta += detectorConfig.score;
            reasons.push(`類似した重複投稿を検知しました (${similarCount}回)`);
        }

        // Check for rapid sending
        const recentCount = recentMessages.filter(
            m => now - m.timestamp < rapidWindowMs
        ).length;

        if (recentCount >= rapidThreshold) {
            scoreDelta += detectorConfig.score;
            reasons.push(`短時間に大量投稿しました (${recentCount}件/${rapidWindowMs / 1000}秒)`);
        }

        if (reasons.length === 0) {
            return {
                scoreDelta: 0,
                reasons: [],
                metadata: {
                    duplicateCount,
                    similarDuplicateCount: similarCount,
                    repeatedLineCount,
                    recentCount,
                    totalMessages: recentMessages.length
                }
            };
        }

        return {
            scoreDelta,
            reasons,
            metadata: {
                duplicateCount,
                similarDuplicateCount: similarCount,
                repeatedLineCount,
                recentCount,
                totalMessages: recentMessages.length
            },
            deleteMessage: detectorConfig.deleteMessage === true
        };
    }
}
