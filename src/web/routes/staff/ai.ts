import { Router } from 'express';
import type { SettingsSession } from '../../types/index.js';
import { verifyAuth, isGuildAccessible, getSessionGuildPermissionLevel } from '../../middleware/auth.js';
import { clearAIExperienceMemories, staffMemoryList, staffMetrics, editStaffMemory, clearStaffMemory } from '../../../core/ai/StaffAIMemory.js';
import {
    clearGuildAIPersonalityLearning,
    getGuildAIPersonality,
    resetGuildAIPersonality,
    saveGuildAIPersonality,
    type GuildAIPersonalitySettings,
} from '../../../core/ai/GuildAIPersonality.js';

export function createStaffAIRoutes(sessions: Map<string, SettingsSession>): Router {
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
