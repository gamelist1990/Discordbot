import { Router } from 'express';
import type { SettingsSession } from '../../types/index.js';
import { verifyAuth, isGuildAccessible, getSessionGuildPermissionLevel } from '../../middleware/auth.js';
import type { BotClient } from '../../../core/platform/BotClient.js';
import { Logger } from '../../../utils/Logger.js';
import { config } from '../../../config.js';
import { OpenAIChatManager } from '../../../core/ai/OpenAIChatManager.js';
import { canGeneratePersona, isBotOwnerSession } from './personaGenerationGuard.js';
import {
    SERVER_BUILDER_BUDGET_LIMIT,
    ServerBuilderBudget,
    ServerBuilderLimiter,
    STYLE_PRESETS,
    buildGuildStructure,
    buildPlanMessages,
    consumeServerBuilderPreview,
    createDiscordGuildAdapter,
    createServerBuilderPreview,
    estimateTokensFromText,
    executePlan,
    extractPlanJson,
    getStylePreset,
    planContextFromStructure,
    summarizePlan,
    validateManualPlan,
    validatePlan,
} from '../../../core/serverBuilder/ServerBuilder.js';

const budget = new ServerBuilderBudget();
const limiter = new ServerBuilderLimiter();
const MAX_REQUEST_LENGTH = 1000;
const PLAN_MAX_TOKENS = 3000;

/**
 * AIサーバー構築コントロールパネルのルート。
 * 認可は性格生成と同じ流儀: ギルド権限レベル2以上またはBot管理者のみ（閲覧含む）。
 * プラン生成は予算（ギルド毎5時間100,000トークン）を消費し、適用はワンタイムプレビューの消費が必須。
 */
export function createServerBuilderRoutes(sessions: Map<string, SettingsSession>, botClient: BotClient): Router {
    const router = Router();

    function authorize(req: any, res: any, guildId: string): SettingsSession | null {
        const session = req.session as SettingsSession | undefined;
        const actor = {
            permissionLevel: getSessionGuildPermissionLevel(session, guildId),
            isBotOwner: isBotOwnerSession(session),
        };
        if (!session || !canGeneratePersona(actor)) {
            res.status(403).json({ error: 'サーバー構築パネルの利用にはサーバー管理者権限（またはBot管理者）が必要です' });
            return null;
        }
        return session;
    }

    function resolveGuild(res: any, guildId: string): any | null {
        const guild = (botClient as any)?.client?.guilds?.cache?.get(guildId);
        if (!guild) {
            res.status(404).json({ error: 'Botが参加しているサーバーが見つかりません' });
            return null;
        }
        return guild;
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

    router.get('/:guildId/state', async (req, res) => {
        const guildId = String(req.params.guildId);
        const session = authorize(req, res, guildId);
        if (!session) return;
        const guild = resolveGuild(res, guildId);
        if (!guild) return;
        try {
            const structure = buildGuildStructure(guild);
            const status = await budget.status(guildId);
            res.json({
                guild: { id: structure.guildId, name: structure.guildName },
                structure,
                budget: status,
                presets: STYLE_PRESETS,
            });
        } catch {
            res.status(500).json({ error: 'サーバー情報の取得に失敗しました' });
        }
    });

    router.post('/:guildId/plan', async (req, res) => {
        const guildId = String(req.params.guildId);
        const session = authorize(req, res, guildId);
        if (!session) return;
        // 手動プラン入力（v2）: AIを介さず operations を直接受け付け、同じ検証・プレビュー保持に通す。
        // AI予算・レート制限は消費/適用しない。認可・監査はAI経路と同一で、即時適用はせずプレビュー必須。
        if (Array.isArray(req.body?.operations)) {
            const guildForManual = resolveGuild(res, guildId);
            if (!guildForManual) return;
            try {
                const structure = buildGuildStructure(guildForManual);
                const summary = typeof req.body?.summary === 'string' ? req.body.summary.slice(0, 300) : '手動プラン';
                const validated = validateManualPlan(req.body.operations, planContextFromStructure(structure), summary);
                if (!validated.ok) {
                    Logger.info(`[ServerBuilderAudit] action=plan-manual-rejected guild=${guildId} user=${session.userId} errors=${validated.errors.slice(0, 3).join(' | ')}`);
                    res.status(422).json({ error: '手動プランが検証を通過しませんでした', details: validated.errors.slice(0, 5) });
                    return;
                }
                const previewId = createServerBuilderPreview({
                    guildId, userId: session.userId, plan: validated.plan,
                    styleId: 'manual', request: '', source: 'manual',
                });
                Logger.info(`[ServerBuilderAudit] action=plan-manual guild=${guildId} user=${session.userId} (${session.username ?? ''}) ops=${validated.plan.operations.length} ops-summary=${summarizePlan(validated.plan)}`);
                const status = await budget.status(guildId);
                res.json({ previewId, plan: validated.plan, budget: status, usage: { tokens: 0, estimated: false }, source: 'manual', expiresInSeconds: 600 });
            } catch {
                res.status(500).json({ error: '手動プランの作成に失敗しました' });
            }
            return;
        }
        const requestText = typeof req.body?.request === 'string' ? req.body.request.trim() : '';
        if (!requestText || requestText.length > MAX_REQUEST_LENGTH) {
            res.status(400).json({ error: `依頼文は1〜${MAX_REQUEST_LENGTH}文字で入力してください` });
            return;
        }
        const style = getStylePreset(req.body?.style);
        if (!style) {
            res.status(400).json({ error: '命名スタイルの指定が不正です' });
            return;
        }
        const guild = resolveGuild(res, guildId);
        if (!guild) return;

        const verdict = limiter.check(guildId, session.userId);
        if (!verdict.ok) {
            res.status(429).json({
                error: 'プラン生成が混み合っています。しばらく待ってから再試行してください',
                reason: verdict.reason,
                retryAfterSeconds: Math.max(1, Math.ceil(verdict.retryAfterMs / 1000)),
            });
            return;
        }
        const budgetCheck = await budget.checkCanGenerate(guildId);
        if (!budgetCheck.ok) {
            res.status(429).json({
                error: `AI予算の残量が不足しています（残り ${budgetCheck.status.remaining.toLocaleString('ja-JP')} / ${SERVER_BUILDER_BUDGET_LIMIT.toLocaleString('ja-JP')} トークン）。時間をおいて再試行してください`,
                budget: budgetCheck.status,
            });
            return;
        }

        limiter.begin(guildId, session.userId);
        try {
            const structure = buildGuildStructure(guild);
            const messages = buildPlanMessages({ request: requestText, style, structure });

            // usage の取得可否: ChatGPTClient の Responses ストリームは response.completed で
            // usage デルタ（type: 'usage'）を流すため、streamResponseText 経由で入力/出力トークンを
            // 取得できる。取得できた場合はそれを予算集計の正とし、取得できない場合のみ
            // 文字数見積り（estimateTokensFromText）にフォールバックして estimated として記録する。
            let text = '';
            const usageRef: { current: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null } = { current: null };
            await new OpenAIChatManager().streamResponseText(
                messages,
                delta => {
                    if (delta.type === 'text') text += delta.text;
                    if (delta.type === 'usage') {
                        usageRef.current = {
                            inputTokens: delta.inputTokens,
                            outputTokens: delta.outputTokens,
                            totalTokens: delta.totalTokens,
                        };
                    }
                },
                {
                    model: config.pexAi.channelModel || config.pexAi.model,
                    strictModel: true,
                    maxTokens: PLAN_MAX_TOKENS,
                    priority: 'background',
                },
            );

            const usage = usageRef.current;
            const promptText = messages.map(m => m.content).join('\n');
            let tokensUsed: number;
            let estimated = false;
            let inputTokens: number | undefined;
            let outputTokens: number | undefined;
            if (usage && (usage.totalTokens !== undefined || usage.inputTokens !== undefined || usage.outputTokens !== undefined)) {
                inputTokens = usage.inputTokens;
                outputTokens = usage.outputTokens;
                tokensUsed = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
            } else {
                estimated = true;
                inputTokens = estimateTokensFromText(promptText);
                outputTokens = estimateTokensFromText(text);
                tokensUsed = inputTokens + outputTokens;
            }
            const nextBudget = await budget.record(guildId, {
                tokens: tokensUsed, inputTokens, outputTokens, estimated,
            });

            const rawPlan = extractPlanJson(text);
            const validated = rawPlan === null
                ? { ok: false as const, errors: ['AIの出力からプランJSONを読み取れませんでした'] }
                : validatePlan(rawPlan, planContextFromStructure(structure));
            if (!validated.ok) {
                Logger.info(`[ServerBuilderAudit] action=plan-rejected guild=${guildId} user=${session.userId} tokens=${tokensUsed} estimated=${estimated} errors=${validated.errors.slice(0, 3).join(' | ')}`);
                res.status(422).json({
                    error: 'AIのプランが検証を通過しませんでした。依頼文を変えて再試行してください',
                    details: validated.errors.slice(0, 5),
                    budget: nextBudget,
                });
                return;
            }

            const previewId = createServerBuilderPreview({
                guildId,
                userId: session.userId,
                plan: validated.plan,
                styleId: style.id,
                request: requestText.slice(0, 200),
                source: 'ai',
            });
            Logger.info(`[ServerBuilderAudit] action=plan guild=${guildId} user=${session.userId} (${session.username ?? ''}) style=${style.id} ops=${validated.plan.operations.length} tokens=${tokensUsed} estimated=${estimated} ops-summary=${summarizePlan(validated.plan)}`);
            res.json({
                previewId,
                plan: validated.plan,
                budget: nextBudget,
                usage: { tokens: tokensUsed, inputTokens, outputTokens, estimated },
                expiresInSeconds: 600,
            });
        } catch (error) {
            Logger.warn(`[ServerBuilderAudit] action=plan-failed guild=${guildId} user=${session.userId} error=${error instanceof Error ? error.message : String(error)}`);
            res.status(502).json({ error: 'AIプランの生成に失敗しました。しばらく待ってから再試行してください' });
        } finally {
            limiter.end(guildId);
        }
    });

    router.post('/:guildId/apply', async (req, res) => {
        const guildId = String(req.params.guildId);
        // 適用時にも認可を再検証する（プレビュー発行時点の権限に頼らない）。
        const session = authorize(req, res, guildId);
        if (!session) return;
        const rawIndexes: unknown = req.body?.opIndexes;
        if (rawIndexes !== undefined
            && (!Array.isArray(rawIndexes) || rawIndexes.some(i => !Number.isInteger(i) || (i as number) < 0))) {
            res.status(400).json({ error: 'opIndexes の形式が不正です' });
            return;
        }
        const record = consumeServerBuilderPreview(req.body?.previewId, guildId, session.userId);
        if (!record) {
            res.status(400).json({ error: 'プレビューが無効か期限切れです。プランを生成し直してください' });
            return;
        }
        const opIndexes = rawIndexes as number[] | undefined;
        if (opIndexes && opIndexes.some(i => i >= record.plan.operations.length)) {
            res.status(400).json({ error: 'opIndexes に範囲外の操作が含まれています' });
            return;
        }
        const guild = resolveGuild(res, guildId);
        if (!guild) return;
        try {
            const results = await executePlan(createDiscordGuildAdapter(guild), record.plan, opIndexes);
            const applied = results.filter(r => r.ok).length;
            Logger.info(`[ServerBuilderAudit] action=apply guild=${guildId} user=${session.userId} (${session.username ?? ''}) applied=${applied}/${results.length} ops-summary=${summarizePlan(record.plan)}`);
            res.json({ results, applied, failed: results.length - applied });
        } catch {
            res.status(500).json({ error: 'プランの適用に失敗しました' });
        }
    });

    return router;
}
