import { Router } from 'express';
import { loadMemos } from '../../../commands/staff/subcommands/ai-tools/memo.js';
import type { SettingsSession } from '../../types/index.js';
import { verifyAuth, isGuildAccessible, getSessionGuildPermissionLevel } from '../../middleware/auth.js';
import { resetStaffAIHistory, clearAIExperienceMemories, staffMemoryList, staffMetrics, editStaffMemory, clearStaffMemory } from '../../../core/ai/StaffAIMemory.js';
import type { BotClient } from '../../../core/platform/BotClient.js';
import {
    applyGuildAIPersona,
    clearGuildAIPersonalityLearning,
    ensureGuildAIPersona,
    generateGuildAIPersonaDraft,
    regenerateGuildAIPersona,
    getGuildAIPersonality,
    resetGuildAIPersonality,
    saveGuildAIPersonality,
    type GuildAIPersona,
    type GuildAIPersonalitySettings,
} from '../../../core/ai/GuildAIPersonality.js';
import { Logger } from '../../../utils/Logger.js';
import {
    canGeneratePersona,
    consumePersonaPreview,
    createPersonaPreview,
    isBotOwnerSession,
    PersonaGenerationLimiter,
    validatePersonaDirection,
} from './personaGenerationGuard.js';

const personaGenerationLimiter = new PersonaGenerationLimiter();

/** First view initializes the AI's character; a slow model never blocks the page for long. */
async function personalityWithPersona(guildId: string) {
    return Promise.race([
        ensureGuildAIPersona(guildId, true),
        new Promise<Awaited<ReturnType<typeof getGuildAIPersonality>>>(resolve =>
            setTimeout(() => void getGuildAIPersonality(guildId).then(resolve), 12_000)),
    ]);
}

export function createStaffAIRoutes(sessions: Map<string, SettingsSession>, _botClient: BotClient): Router {
    const router = Router();

    /**
     * 性格の生成・調整の認可: ルーター共通の「ギルド権限レベル1以上」に加え、
     * 生成系はギルド管理者（レベル2以上）またはBot管理者のみ許可する。
     * 許可できない場合は 403 を返して null を返す。
     */
    function authorizePersonaGeneration(req: any, res: any, guildId: string): SettingsSession | null {
        const session = req.session as SettingsSession | undefined;
        const actor = {
            permissionLevel: getSessionGuildPermissionLevel(session, guildId),
            isBotOwner: isBotOwnerSession(session),
        };
        if (!session || !canGeneratePersona(actor)) {
            res.status(403).json({ error: '性格の生成・調整にはサーバー管理者権限（またはBot管理者）が必要です' });
            return null;
        }
        return session;
    }

    /** レート制限の開始。制限中は 429 を返して false。 */
    function beginPersonaGeneration(res: any, guildId: string, userId: string): boolean {
        const verdict = personaGenerationLimiter.check(guildId, userId);
        if (!verdict.ok) {
            res.status(429).json({
                error: '性格の生成が混み合っています。しばらく待ってから再試行してください',
                reason: verdict.reason,
                retryAfterSeconds: Math.max(1, Math.ceil(verdict.retryAfterMs / 1000)),
            });
            return false;
        }
        personaGenerationLimiter.begin(guildId, userId);
        return true;
    }
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
            const [metrics, memories, personality, customMemos] = await Promise.all([
                staffMetrics(guildId), staffMemoryList(guildId), personalityWithPersona(guildId), loadMemos(guildId),
            ]);
            res.json({ metrics, memories, personality, customMemos });
        } catch {
            res.status(500).json({ error: 'Staff AI情報の取得に失敗しました' });
        }
    });
    router.post('/:guildId/history/reset', async (req, res) => {
        if (req.body?.confirm !== 'RESET') {
            res.status(400).json({ error: '確認文字列 RESET が必要です' }); return;
        }
        try {
            await resetStaffAIHistory(String(req.params.guildId));
            await clearGuildAIPersonalityLearning(String(req.params.guildId));
            res.json({ ok: true });
        } catch {
            res.status(500).json({ error: '総履歴のリセットに失敗しました' });
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
    router.post('/:guildId/personality/persona/regenerate', async (req, res) => {
        const guildId = String(req.params.guildId);
        const session = authorizePersonaGeneration(req, res, guildId);
        if (!session) return;
        if (!beginPersonaGeneration(res, guildId, session.userId)) return;
        try {
            const personality = await regenerateGuildAIPersona(guildId);
            Logger.info(`[PersonaAudit] action=regenerate guild=${guildId} user=${session.userId} (${session.username ?? ''}) persona=${personality.persona?.name ?? ''}`);
            res.json({ personality });
        } catch {
            res.status(500).json({ error: 'AIの性格を再生成できませんでした' });
        } finally {
            personaGenerationLimiter.end(guildId);
        }
    });
    router.post('/:guildId/personality/persona/preview', async (req, res) => {
        const guildId = String(req.params.guildId);
        const session = authorizePersonaGeneration(req, res, guildId);
        if (!session) return;
        // 方向プロンプトは長さ上限つきで、生成プロンプト内では「資料」としてのみ扱われる。
        const validated = validatePersonaDirection(req.body?.direction);
        if (!validated.ok) {
            res.status(400).json({ error: validated.error }); return;
        }
        if (!beginPersonaGeneration(res, guildId, session.userId)) return;
        try {
            const { draft, base } = await generateGuildAIPersonaDraft(guildId, validated.direction || undefined);
            const previewId = createPersonaPreview({
                guildId, userId: session.userId, persona: draft, baseGeneratedAt: base?.generatedAt,
            });
            Logger.info(`[PersonaAudit] action=preview guild=${guildId} user=${session.userId} (${session.username ?? ''}) direction=${JSON.stringify(validated.direction.slice(0, 80))} persona=${draft.name}`);
            res.json({ previewId, persona: draft, expiresInSeconds: 600 });
        } catch {
            res.status(500).json({ error: 'AIの性格を生成できませんでした' });
        } finally {
            personaGenerationLimiter.end(guildId);
        }
    });
    router.post('/:guildId/personality/persona/apply', async (req, res) => {
        const guildId = String(req.params.guildId);
        // 適用時にも認可を再検証する（プレビューの発行時点の権限に頼らない）。
        const session = authorizePersonaGeneration(req, res, guildId);
        if (!session) return;
        const record = consumePersonaPreview(req.body?.previewId, guildId, session.userId);
        if (!record) {
            res.status(400).json({ error: 'プレビューが無効か期限切れです。生成し直してください' }); return;
        }
        try {
            const current = await getGuildAIPersonality(guildId);
            if ((current.persona?.generatedAt ?? undefined) !== record.baseGeneratedAt) {
                res.status(409).json({ error: 'プレビュー後に性格が変更されています。プレビューを取り直してください' }); return;
            }
            const personality = await applyGuildAIPersona(guildId, record.persona as GuildAIPersona);
            Logger.info(`[PersonaAudit] action=apply guild=${guildId} user=${session.userId} (${session.username ?? ''}) persona=${record.persona.name}`);
            res.json({ personality });
        } catch {
            res.status(500).json({ error: 'AIの性格を適用できませんでした' });
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
