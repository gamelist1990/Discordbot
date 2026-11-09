import { Router } from 'express';
import { loadMemos } from '../../../commands/staff/subcommands/ai-tools/memo.js';
import type { SettingsSession } from '../../types/index.js';
import { verifyAuth, isGuildAccessible, getSessionGuildPermissionLevel } from '../../middleware/auth.js';
import { resetStaffAIHistory, clearAIExperienceMemories, staffMemoryList, editStaffMemory, clearStaffMemory } from '../../../core/ai/StaffAIMemory.js';
import { ensureAIUsageMetrics, getGlobalAIUsageMetrics } from '../../../core/ai/AIUsageMetrics.js';
import type { BotClient } from '../../../core/platform/BotClient.js';
import {
    applyGuildAIPersona,
    clearGuildAIPersonalityLearning,
    ensureGuildAIPersona,
    generateGuildAIPersonaDraft,
    regenerateGuildAIPersona,
    getGuildAIPersonality,
    personaContentFingerprint,
    resetGuildAIPersonality,
    saveGuildAIPersonality,
    type GuildAIPersona,
    type GuildAIPersonalitySettings,
} from '../../../core/ai/GuildAIPersonality.js';
import {
    loadGuildMemberMemoStore,
    removeGuildMemberMemo,
    toMemberMemoAdminItem,
} from '../../../core/ai/GuildMemberMemory.js';
import { loadGuildEpisodeStore } from '../../../core/ai/GuildEpisodeMemory.js';
import { buildEpisodeLibrary } from '../../../core/ai/EpisodeLibrary.js';
import { Logger } from '../../../utils/Logger.js';
import {
    canGeneratePersona,
    consumePersonaPreview,
    createPersonaPreview,
    peekPersonaPreview,
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
        const session = (req as any).session as SettingsSession | undefined;
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

    /**
     * メンバーメモ削除の認可。性格生成と同じ水準（ギルド権限レベル2以上またはBot管理者）。
     * 閲覧（GET）はルーター共通のレベル1以上で足りるが、削除は誤メモの消去とはいえ
     * 他人の記録を消す操作なので、生成系と同じ一段強い認可にする。
     */
    function authorizeMemberMemoManagement(req: any, res: any, guildId: string): SettingsSession | null {
        const session = (req as any).session as SettingsSession | undefined;
        const actor = {
            permissionLevel: getSessionGuildPermissionLevel(session, guildId),
            isBotOwner: isBotOwnerSession(session),
        };
        if (!session || !canGeneratePersona(actor)) {
            res.status(403).json({ error: 'メンバーメモの削除にはサーバー管理者権限（またはBot管理者）が必要です' });
            return null;
        }
        return session;
    }

    /** レート制限の開始。制限中は 429 を返して false。 */
    function beginPersonaGeneration(res: any, guildId: string, userId: string): boolean {
        const verdict = personaGenerationLimiter.check(guildId, userId);
        if (!verdict.ok) {
            const retryAfterSeconds = Math.max(1, Math.ceil(verdict.retryAfterMs / 1000));
            const error = verdict.reason === 'in-flight'
                ? 'このサーバーの性格を生成中です。完了するまでお待ちください'
                : verdict.reason === 'daily-user' || verdict.reason === 'daily-guild'
                    ? '本日の性格生成の上限に達しました。日本時間の翌日0時以降に再試行してください'
                    : `性格生成の間隔が短すぎます。${retryAfterSeconds}秒後に再試行してください`;
            Logger.info(`[PersonaAudit] action=generation-rejected guild=${guildId} user=${userId} reason=${verdict.reason}`);
            res.setHeader('Retry-After', String(retryAfterSeconds));
            res.status(429).json({
                error,
                reason: verdict.reason,
                retryAfterSeconds,
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
            // 利用状況は全AI経路を共通層で数える新集計（AIUsageMetrics）。
            // 旧 staffMetrics（/staff ai のみ）は表示に使わない。
            const [metrics, globalMetrics, memories, personality, customMemos] = await Promise.all([
                ensureAIUsageMetrics(guildId), getGlobalAIUsageMetrics(),
                staffMemoryList(guildId), personalityWithPersona(guildId), loadMemos(guildId),
            ]);
            res.json({ metrics, globalMetrics, memories, personality, customMemos });
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
        } catch (error) {
            Logger.error(`[PersonaAudit] action=regenerate-failed guild=${guildId} user=${session.userId}`, error);
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
                guildId, userId: session.userId, persona: draft, basePersonaFingerprint: personaContentFingerprint(base),
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
        if (!session) {
            Logger.warn(`[PersonaAudit] action=apply-rejected guild=${guildId} reason=forbidden`);
            return;
        }
        // まず消費せずに確認する。楽観チェックで弾いたときにプレビューまで
        // 消えてしまうと、ユーザーは理由も分からず再生成を強いられるため、
        // 消費はチェックを通過した直前に確定させる（ワンタイム性は維持する）。
        // 拒否理由は監査ログに残す（プレビューID自体は秘密情報なので出さない）。
        const peeked = peekPersonaPreview(req.body?.previewId, guildId, session.userId);
        if (!peeked) {
            Logger.warn(`[PersonaAudit] action=apply-rejected guild=${guildId} user=${session.userId} (${session.username ?? ''}) reason=invalid-preview`);
            res.status(400).json({ error: 'プレビューが無効か期限切れです。生成し直してください' }); return;
        }
        try {
            const current = await getGuildAIPersonality(guildId);
            // 楽観チェックは生成時刻ではなく性格本体の指紋で見る。学習や設定保存で
            // レコードが書き直されても、性格そのものが変わっていなければ適用できる。
            if (personaContentFingerprint(current.persona) !== peeked.basePersonaFingerprint) {
                Logger.warn(`[PersonaAudit] action=apply-rejected guild=${guildId} user=${session.userId} (${session.username ?? ''}) reason=persona-changed`);
                res.status(409).json({ error: 'プレビュー後に性格が変更されています。プレビューを取り直してください' }); return;
            }
            const record = consumePersonaPreview(req.body?.previewId, guildId, session.userId);
            if (!record) {
                // peek の直後に消費された（連打・競合）場合だけここに来る。
                Logger.warn(`[PersonaAudit] action=apply-rejected guild=${guildId} user=${session.userId} (${session.username ?? ''}) reason=preview-consumed`);
                res.status(400).json({ error: 'プレビューが無効か期限切れです。生成し直してください' }); return;
            }
            const personality = await applyGuildAIPersona(guildId, record.persona as GuildAIPersona);
            Logger.info(`[PersonaAudit] action=apply guild=${guildId} user=${session.userId} (${session.username ?? ''}) persona=${record.persona.name}`);
            res.json({ personality });
        } catch {
            Logger.warn(`[PersonaAudit] action=apply-rejected guild=${guildId} user=${session.userId} (${session.username ?? ''}) reason=apply-failed`);
            res.status(500).json({ error: 'AIの性格を適用できませんでした' });
        }
    });
    router.get('/:guildId/member-memos', async (req, res) => {
        const guildId = String(req.params.guildId);
        const session = (req as any).session as SettingsSession | undefined;
        // 削除ボタンの表示可否はサーバー側の判定を正としてクライアントへ渡す。
        const canManage = canGeneratePersona({
            permissionLevel: getSessionGuildPermissionLevel(session, guildId),
            isBotOwner: isBotOwnerSession(session),
        });
        try {
            const store = await loadGuildMemberMemoStore(guildId);
            res.json({ memos: store.memos.map(toMemberMemoAdminItem), canManage });
        } catch {
            res.status(500).json({ error: 'メンバーメモの取得に失敗しました' });
        }
    });
    router.delete('/:guildId/member-memos/:userId', async (req, res) => {
        const guildId = String(req.params.guildId);
        const session = authorizeMemberMemoManagement(req, res, guildId);
        if (!session) return;
        const userId = String(req.params.userId);
        if (!/^\d{17,20}$/.test(userId)) {
            res.status(400).json({ error: 'ユーザーIDの形式が不正です' });
            return;
        }
        try {
            const removed = await removeGuildMemberMemo(guildId, userId);
            Logger.info(`[MemberMemoAudit] action=delete guild=${guildId} user=${session.userId} (${session.username ?? ''}) target=${userId} targetName=${removed?.name ?? ''} removed=${removed !== null}`);
            res.json({ removed: removed !== null });
        } catch {
            res.status(500).json({ error: 'メンバーメモの削除に失敗しました' });
        }
    });
    router.get('/:guildId/episodes', async (req, res) => {
        const guildId = String(req.params.guildId);
        // 検索語は長すぎる入力でストア全件の照合が重くならないよう上限を付ける。
        const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
        try {
            const store = await loadGuildEpisodeStore(guildId);
            res.json(buildEpisodeLibrary(store.episodes, { guildId, query }));
        } catch {
            res.status(500).json({ error: '出来事ライブラリの取得に失敗しました' });
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
