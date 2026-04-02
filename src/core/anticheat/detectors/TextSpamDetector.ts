import { Message } from 'discord.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { CacheManager } from '../../../utils/CacheManager.js';
import { getDetectorConfig, normalizeContent } from '../utils.js';

interface MessageRecord {
    content: string;
    timestamp: number;
    messageId: string;
}

/**
 * Detects text spam by analyzing recent messages
 * Checks for:
 * - Duplicate message content
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
        const rapidThreshold = Number(config.rapidMessageCount) || 6;
        const rapidWindowMs = (Number(config.windowSeconds) || 5) * 1000;
        const cacheKey = `anticheat:messages:${context.guildId}:${context.channelId}:${context.userId}`;
        const normalizedContent = normalizeContent(message.content);
        
        // Get user's recent messages from cache
        let recentMessages = CacheManager.get<MessageRecord[]>(cacheKey) || [];
        
        // Add current message
        recentMessages.push({
            content: normalizedContent,
            timestamp: Date.now(),
            messageId: message.id
        });
        
        // Keep only last maxMessages
        if (recentMessages.length > maxMessages) {
            recentMessages = recentMessages.slice(-maxMessages);
        }
        
        // Update cache (TTL: 1 minute)
        CacheManager.set(cacheKey, recentMessages, 60 * 1000);
        
        // Analyze for spam patterns
        const reasons: string[] = [];
        let scoreDelta = 0;
        
        // Check for duplicate messages
        const duplicateCount = recentMessages.filter(
            m => m.content === normalizedContent
        ).length;
        
        if (duplicateCount >= duplicateThreshold) {
            scoreDelta += detectorConfig.score;
            reasons.push(`短時間の重複投稿を検知しました (${duplicateCount}回)`);
        }
        
        // Check for rapid sending
        const now = Date.now();
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
                recentCount,
                totalMessages: recentMessages.length
            },
            deleteMessage: detectorConfig.deleteMessage === true
        };
    }
}
