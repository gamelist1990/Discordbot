import { Message } from 'discord.js';
import { Detector, DetectionContext, DetectionResult } from '../types.js';
import { CacheManager } from '../../../utils/CacheManager.js';

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
    
    // Configuration
    private readonly MAX_MESSAGES = 10;
    private readonly DUPLICATE_THRESHOLD = 3; // Same message 3+ times
    private readonly RAPID_THRESHOLD = 5; // 5+ messages in rapid time window
    private readonly RAPID_WINDOW_MS = 5000; // 5 seconds

    /**
     * Detect spam patterns in a message
     */
    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const cacheKey = `anticheat:messages:${context.guildId}:${context.userId}`;
        
        // Get user's recent messages from cache
        let recentMessages = CacheManager.get<MessageRecord[]>(cacheKey) || [];
        
        // Add current message
        recentMessages.push({
            content: message.content,
            timestamp: Date.now(),
            messageId: message.id
        });
        
        // Keep only last MAX_MESSAGES
        if (recentMessages.length > this.MAX_MESSAGES) {
            recentMessages = recentMessages.slice(-this.MAX_MESSAGES);
        }
        
        // Update cache (TTL: 1 minute)
        CacheManager.set(cacheKey, recentMessages, 60 * 1000);
        
        // Analyze for spam patterns
        const reasons: string[] = [];
        let scoreDelta = 0;
        
        // Check for duplicate messages
        const duplicateCount = recentMessages.filter(
            m => m.content === message.content
        ).length;
        
        if (duplicateCount >= this.DUPLICATE_THRESHOLD) {
            scoreDelta += duplicateCount * 2;
            reasons.push(`Duplicate message sent ${duplicateCount} times`);
        }
        
        // Check for rapid sending
        const now = Date.now();
        const recentCount = recentMessages.filter(
            m => now - m.timestamp < this.RAPID_WINDOW_MS
        ).length;
        
        if (recentCount >= this.RAPID_THRESHOLD) {
            scoreDelta += recentCount;
            reasons.push(`Rapid message sending: ${recentCount} messages in ${this.RAPID_WINDOW_MS / 1000}s`);
        }
        
        // Check for all caps (if message is long enough)
        if (message.content.length > 10 && message.content === message.content.toUpperCase()) {
            const capsCount = recentMessages.filter(
                m => m.content.length > 10 && m.content === m.content.toUpperCase()
            ).length;
            
            if (capsCount >= 3) {
                scoreDelta += 1;
                reasons.push('Excessive use of all caps');
            }
        }
        
        return {
            scoreDelta,
            reasons,
            metadata: {
                duplicateCount,
                recentCount,
                totalMessages: recentMessages.length
            }
        };
    }
}
