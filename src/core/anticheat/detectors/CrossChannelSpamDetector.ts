import { createHash } from 'node:crypto';
import type { Message } from 'discord.js';
import { CacheManager } from '../../../utils/CacheManager.js';
import type { Detector, DetectionContext, DetectionResult } from '../types.js';
import { getDetectorConfig, normalizeContent } from '../utils.js';

interface PostRecord {
    id: string;
    channelId: string;
    fingerprint: string;
    timestamp: number;
}

const numberSetting = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;

export class CrossChannelSpamDetector implements Detector {
    name = 'crossChannelSpam';

    async detect(message: Message, context: DetectionContext): Promise<DetectionResult> {
        const detector = getDetectorConfig(context, this.name);
        const options = detector.config || {};
        const windowSeconds = numberSetting(options.windowSeconds, 120, 1, 3600);
        const rapidWindowSeconds = numberSetting(options.rapidWindowSeconds, 10, 1, 60);
        const duplicateThreshold = numberSetting(options.duplicateThreshold, 2, 2, 100);
        const rapidThreshold = numberSetting(options.rapidMessageCount, 6, 2, 100);
        const minChannels = numberSetting(options.minChannels, 2, 2, 100);
        const now = Date.now();
        const retentionMs = Math.max(windowSeconds, rapidWindowSeconds) * 1000;
        const key = `anticheat:cross-channel:${context.guildId}:${context.userId}`;
        const normalized = normalizeContent(message.content.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g, ''));
        // Empty attachment-only posts count toward the burst limit, not as identical text.
        const fingerprint = normalized ? createHash('sha256').update(normalized).digest('hex') : '';
        const records = (CacheManager.get<PostRecord[]>(key) || []).filter(record => now - record.timestamp <= retentionMs);
        const previous = records.find(record => record.id === message.id);
        if (previous?.fingerprint === fingerprint) return { scoreDelta: 0, reasons: [] };
        const current: PostRecord = {
            id: message.id, channelId: context.channelId, fingerprint,
            timestamp: previous?.timestamp ?? (Number.isFinite(message.createdTimestamp) ? message.createdTimestamp : now)
        };
        const next = [...records.filter(record => record.id !== message.id), current]
            .filter(record => now - record.timestamp <= retentionMs).slice(-500);
        CacheManager.set(key, next, retentionMs + 1000);
        const duplicates = fingerprint ? next.filter(record => record.fingerprint === fingerprint && now - record.timestamp <= windowSeconds * 1000) : [];
        const recent = next.filter(record => now - record.timestamp <= rapidWindowSeconds * 1000);
        const duplicateChannels = new Set(duplicates.map(record => record.channelId));
        const rapidChannels = new Set(recent.map(record => record.channelId));
        const reasons: string[] = [];
        if (duplicates.length >= duplicateThreshold && duplicateChannels.size >= minChannels) {
            reasons.push(`同一メッセージを${duplicateChannels.size}チャンネルに拡散 (${duplicates.length}件/${windowSeconds}秒)`);
        }
        // Edits may reveal duplicate content but must not count as new rapid posts.
        if (!previous && recent.length >= rapidThreshold && rapidChannels.size >= minChannels) {
            reasons.push(`複数チャンネルへの連投 (${recent.length}件/${rapidWindowSeconds}秒・${rapidChannels.size}チャンネル)`);
        }
        if (!reasons.length) return { scoreDelta: 0, reasons: [] };
        return {
            scoreDelta: detector.score, reasons,
            deleteMessage: detector.deleteMessage !== false,
            metadata: {
                duplicateCount: duplicates.length, rapidCount: recent.length,
                duplicateChannelIds: [...duplicateChannels], rapidChannelIds: [...rapidChannels],
                messageIds: [...new Set([...duplicates, ...recent].map(record => record.id))],
                windowSeconds, rapidWindowSeconds
            }
        };
    }
}
