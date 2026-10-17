import { Router } from 'express';
import type { SettingsSession } from '../../types/index.js';
import { verifyAuth, isGuildAccessible, getSessionGuildPermissionLevel } from '../../middleware/auth.js';
import { staffMemoryList, staffMetrics, editStaffMemory, clearStaffMemory } from '../../../core/ai/StaffAIMemory.js';

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
            const [metrics, memories] = await Promise.all([staffMetrics(guildId), staffMemoryList(guildId)]);
            res.json({ metrics, memories });
        } catch {
            res.status(500).json({ error: 'Staff AI情報の取得に失敗しました' });
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
        const removed = await clearStaffMemory(String(req.params.guildId));
        res.json({ removed });
    });
    return router;
}
