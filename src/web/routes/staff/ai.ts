import { Router } from 'express';
import { PermissionFlagsBits, type Message } from 'discord.js';
import type { SettingsSession } from '../../types/index.js';
import { verifyAuth, isGuildAccessible, getSessionGuildPermissionLevel } from '../../middleware/auth.js';
import { clearAIExperienceMemories, staffMemoryList, staffMetrics, editStaffMemory, clearStaffMemory, staffMemoryChannelImports, queueStaffChannelMemoryImport } from '../../../core/ai/StaffAIMemory.js';
import type { BotClient } from '../../../core/platform/BotClient.js';
import {
    clearGuildAIPersonalityLearning,
    getGuildAIPersonality,
    resetGuildAIPersonality,
    saveGuildAIPersonality,
    type GuildAIPersonalitySettings,
} from '../../../core/ai/GuildAIPersonality.js';

export function createStaffAIRoutes(sessions: Map<string, SettingsSession>, botClient: BotClient): Router {
    const router = Router();
    router.use(verifyAuth(sessions));
    router.use('/:guildId', (req, res, next) => {
        if (!/^\d{17,20}$/.test(String(req.params.guildId))
            || !isGuildAccessible((req as any).session, String(req.params.guildId))
            || getSessionGuildPermissionLevel((req as any).session, String(req.params.guildId)) < 1) {
            res.status(403).json({ error: 'このサーバーのStaff権限がありません' });
            return;
        }
        next();
    });
    router.get('/:guildId', async (req, res) => {
        try {
            const guildId = String(req.params.guildId);
            const [metrics, memories, personality] = await Promise.all([
                staffMetrics(guildId), staffMemoryList(guildId), getGuildAIPersonality(guildId),
            ]);
            res.json({ metrics, memories, personality });
        } catch {
            res.status(500).json({ error: 'Staff AI情報の取得に失敗しました' });
        }
    });
    router.get('/:guildId/channels', async (req, res) => {
        const guildId = String(req.params.guildId);
        const guild = botClient.client.guilds.cache.get(guildId);
        if (!guild) { res.status(404).json({ error: 'サーバーが見つかりません' }); return; }
        const channels = guild.channels.cache
            .filter(channel => [0, 5].includes(channel.type) && 'messages' in channel)
            .map(channel => ({ id: channel.id, name: channel.name, type: channel.type, position: 'position' in channel ? channel.position : 0 }))
            .sort((a, b) => a.position - b.position);
        res.json({ channels: Array.from(channels) });
    });
    router.get('/:guildId/memories/channel-imports', async (req, res) => {
        try {
            res.json({ imports: await staffMemoryChannelImports(String(req.params.guildId)) });
        } catch {
            res.status(500).json({ error: 'チャンネル取り込み状況を取得できませんでした' });
        }
    });
    router.post('/:guildId/memories/import-channel', async (req, res) => {
        const guildId = String(req.params.guildId);
        const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId : '';
        if (!/^\d{17,20}$/.test(channelId)) {
            res.status(400).json({ error: 'チャンネルを選択してください' }); return;
        }
        const guild = botClient.client.guilds.cache.get(guildId);
        if (!guild) { res.status(404).json({ error: 'サーバーが見つかりません' }); return; }
        try {
            const channel = await guild.channels.fetch(channelId);
            if (!channel || !('guildId' in channel) || channel.guildId !== guildId
                || ![0, 5].includes(channel.type) || !('messages' in channel)) {
                res.status(400).json({ error: '対象チャンネルが見つからないか、テキストチャンネルではありません' }); return;
            }
            const botMember = await guild.members.fetchMe();
            const permissions = channel.permissionsFor(botMember);
            if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
                res.status(403).json({ error: 'Botにチャンネル閲覧とメッセージ履歴の権限がありません' }); return;
            }
            const name = channel.name;
            const job = await queueStaffChannelMemoryImport(guildId, channelId, name, async signal => {
                const historyChannel = channel as typeof channel & { messages: { fetch: (options: { limit: number; before?: string }) => Promise<import('discord.js').Collection<string, Message>> } };
                const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000;
                const collected: Message[] = [];
                let before: string | undefined;
                const maxMessages = 5000;
                while (collected.length < maxMessages) {
                    if (signal.aborted) throw signal.reason ?? new Error('Memory import was preempted.');
                    const page = await historyChannel.messages.fetch({ limit: Math.min(100, maxMessages - collected.length), ...(before ? { before } : {}) });
                    if (page.size === 0) break;
                    const batch = Array.from(page.values());
                    collected.push(...batch.filter(message => message.createdTimestamp >= cutoff));
                    const oldest = page.last();
                    if (!oldest || oldest.createdTimestamp < cutoff || batch.length < 100) break;
                    before = oldest.id;
                }
                return collected.filter(message => !message.author.bot && !message.webhookId && message.content.trim())
                    .map(message => ({
                        userId: message.author.id,
                        userName: message.member?.displayName || message.author.globalName || message.author.username,
                        timestamp: message.createdTimestamp,
                        content: message.content.trim().slice(0, 2000),
                    })).sort((a, b) => a.timestamp - b.timestamp);
            });
            res.status(job.status === 'queued' ? 202 : 200).json({ job });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : 'チャンネル履歴を取り込めませんでした' });
        }
    });
    router.put('/:guildId/personality', async (req, res) => {
        try {
            const body = req.body as Partial<GuildAIPersonalitySettings> | undefined;
            if (!body || typeof body !== 'object') {
                res.status(400).json({ error: 'AIの話し方設定がありません' }); return;
            }
            const settings: GuildAIPersonalitySettings = {
                learningEnabled: body.learningEnabled as boolean,
                tone: body.tone as GuildAIPersonalitySettings['tone'],
                humor: body.humor as GuildAIPersonalitySettings['humor'],
                emoji: body.emoji as GuildAIPersonalitySettings['emoji'],
                verbosity: body.verbosity as GuildAIPersonalitySettings['verbosity'],
                customInstructions: body.customInstructions as string,
            };
            const personality = await saveGuildAIPersonality(String(req.params.guildId), settings);
            res.json({ personality });
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : 'AIの話し方設定を保存できませんでした' });
        }
    });
    router.post('/:guildId/personality/reset', async (req, res) => {
        try {
            const guildId = String(req.params.guildId);
            const [personality] = await Promise.all([
                resetGuildAIPersonality(guildId),
                clearAIExperienceMemories(guildId),
            ]);
            res.json({ personality });
        } catch {
            res.status(500).json({ error: 'AIの話し方設定を初期化できませんでした' });
        }
    });
    router.put('/:guildId/memories/:id', async (req, res) => {
        try {
            const content = req.body?.content;
            if (typeof content !== 'string' || !content.trim() || content.length > 6000) {
                res.status(400).json({ error: '本文は1〜6000文字です' }); return;
            }
            const memory = await editStaffMemory(String(req.params.guildId), String(req.params.id), content);
            res.json({ memory });
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : '更新失敗' });
        }
    });
    router.delete('/:guildId/memories/:id', async (req, res) => {
        const removed = await clearStaffMemory(String(req.params.guildId), String(req.params.id));
        res.json({ removed });
    });
    router.delete('/:guildId/memories', async (req, res) => {
        // This is destructive and may expose users to surprise data loss: explicitly confirmed in UI.
        const guildId = String(req.params.guildId);
        const [removed] = await Promise.all([
            clearStaffMemory(guildId),
            clearGuildAIPersonalityLearning(guildId),
        ]);
        res.json({ removed });
    });
    return router;
}
