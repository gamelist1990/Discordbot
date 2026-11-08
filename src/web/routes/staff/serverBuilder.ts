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
    SERVER_BUILDER_MIN_TOKENS_TO_GENERATE,
    ServerBuilderBudget,
    ServerBuilderLimiter,
    STYLE_PRESETS,
    buildGuildStructure,
    consumeServerBuilderPreview,
    createDiscordGuildAdapter,
    createServerBuilderPreview,
    estimateTokensFromText,
    executePlan,
    generatePlanWithRepair,
    getStylePreset,
    planContextFromStructure,
    resolvePlanFocus,
    summarizePlan,
    validateManualPlan,
} from '../../../core/serverBuilder/ServerBuilder.js';

const budget = new ServerBuilderBudget();
const limiter = new ServerBuilderLimiter();
const MAX_REQUEST_LENGTH = 1000;
const PLAN_MAX_TOKENS = 6000;

/**
 * AIサーバー構築コントロールパネルのルート。
 * 認可は性格生成と同じ流儀: ギルド権限レベル2以上またはBot管理者のみ（閲覧含む）。
 * プラン生成は予算（ギルド毎5時間300,000トークン）を消費し、適用はワンタイムプレビューの消費が必須。
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
                const droppedNames = validated.droppedNoops.map(d => d.name);
                const status = await budget.status(guildId);
                if (validated.plan.operations.length === 0) {
                    // 全操作が同名リネーム等の無意味な操作だった場合は、エラーではなく「変更不要」の正常系で返す。
                    Logger.info(`[ServerBuilderAudit] action=plan-manual-noop guild=${guildId} user=${session.userId} dropped-noops=${validated.droppedNoops.length}`);
                    res.json({
                        noop: true,
                        message: 'すべての操作が現在の状態と同じだったため、変更は不要でした',
                        droppedNoops: validated.droppedNoops.length, droppedNames,
                        budget: status, usage: { tokens: 0, estimated: false }, source: 'manual',
                    });
                    return;
                }
                const previewId = createServerBuilderPreview({
                    guildId, userId: session.userId, plan: validated.plan,
                    styleId: 'manual', request: '', source: 'manual',
                });
                Logger.info(`[ServerBuilderAudit] action=plan-manual guild=${guildId} user=${session.userId} (${session.username ?? ''}) ops=${validated.plan.operations.length} dropped-noops=${validated.droppedNoops.length} ops-summary=${summarizePlan(validated.plan)}`);
                res.json({ previewId, plan: validated.plan, budget: status, usage: { tokens: 0, estimated: false }, source: 'manual', expiresInSeconds: 600, droppedNoops: validated.droppedNoops.length, droppedNames });
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
            // 詳細画面で選択中の対象（任意）。構造に実在する対象だけを文脈として採用する。
            const focus = resolvePlanFocus(structure, req.body?.focus);

            // usage の取得経路: EndPoint の Responses API は response.completed の usage を
            // 常に0で返す（2026-11-08 実測）ため、Responses 経由では実測が取れない。
            // Chat Completions のストリームは最終チャンクに usage（prompt/completion/total）を
            // 含む（include_usage、ChatGPTClient 側でも常時有効化）ため、streamMessage 経由で
            // 実測を取得し、それを予算集計の正とする。取得できない場合のみ文字数見積り
            // （estimateTokensFromText）にフォールバックして estimated として記録する。
            // 検証失敗時の自動修復呼び出しも、ここを通るため同じ集計に含まれる。
            const totals = { tokens: 0, inputTokens: 0, outputTokens: 0, hasInput: false, hasOutput: false, estimated: false };
            const generate = async (messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> => {
                let text = '';
                const usageRef: { current: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null } = { current: null };
                await new OpenAIChatManager().streamMessage(
                    messages,
                    chunk => {
                        const content = chunk.choices?.[0]?.delta?.content;
                        if (typeof content === 'string' && content) text += content;
                        const u = chunk.usage;
                        if (u && (typeof u.prompt_tokens === 'number' || typeof u.completion_tokens === 'number' || typeof u.total_tokens === 'number')) {
                            usageRef.current = {
                                inputTokens: typeof u.prompt_tokens === 'number' ? u.prompt_tokens : undefined,
                                outputTokens: typeof u.completion_tokens === 'number' ? u.completion_tokens : undefined,
                                totalTokens: typeof u.total_tokens === 'number' ? u.total_tokens : undefined,
                            };
                        }
                    },
                    {
                        model: config.pexAi.channelModel || config.pexAi.model,
                        strictModel: true,
                        maxTokens: PLAN_MAX_TOKENS,
                        priority: 'background',
                        includeUsage: true,
                        usageContext: { guildId, purpose: 'server-builder' },
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
                if (tokensUsed <= 0) {
                    // usage が 0 で返る経路があり、そのままだと生成したのに予算へ計上されないため見積りに切り替える。
                    estimated = true;
                    inputTokens = estimateTokensFromText(promptText);
                    outputTokens = estimateTokensFromText(text);
                    tokensUsed = inputTokens + outputTokens;
                }
                await budget.record(guildId, { tokens: tokensUsed, inputTokens, outputTokens, estimated });
                totals.tokens += tokensUsed;
                if (inputTokens !== undefined) { totals.inputTokens += inputTokens; totals.hasInput = true; }
                if (outputTokens !== undefined) { totals.outputTokens += outputTokens; totals.hasOutput = true; }
                totals.estimated = totals.estimated || estimated;
                return text;
            };

            const outcome = await generatePlanWithRepair({
                request: requestText,
                style,
                structure,
                focus,
                generate,
                canRepair: async () => {
                    const status = await budget.status(guildId);
                    return status.remaining >= SERVER_BUILDER_MIN_TOKENS_TO_GENERATE;
                },
            });
            const nextBudget = await budget.status(guildId);

            if (!outcome.ok) {
                Logger.info(`[ServerBuilderAudit] action=plan-rejected guild=${guildId} user=${session.userId} attempts=${outcome.attempts} tokens=${totals.tokens} estimated=${totals.estimated} first-errors=${outcome.firstErrors.slice(0, 3).join(' | ')} errors=${outcome.errors.slice(0, 3).join(' | ')}`);
                res.status(422).json({
                    error: outcome.attempts > 1
                        ? 'AIのプランが検証を通過しませんでした（自動修復を試みましたが解消できませんでした）'
                        : 'AIのプランが検証を通過しませんでした',
                    details: outcome.errors.slice(0, 5),
                    budget: nextBudget,
                });
                return;
            }

            const usageJson = {
                tokens: totals.tokens,
                inputTokens: totals.hasInput ? totals.inputTokens : undefined,
                outputTokens: totals.hasOutput ? totals.outputTokens : undefined,
                estimated: totals.estimated,
            };
            const droppedNames = outcome.droppedNoops.map(d => d.name);
            if (outcome.plan.operations.length === 0) {
                // 対象がすべて既に条件を満たしていたケース。エラーではなく通常の結果として返す。
                Logger.info(`[ServerBuilderAudit] action=plan-noop guild=${guildId} user=${session.userId} (${session.username ?? ''}) style=${style.id} focus=${focus ? `${focus.kind}:${focus.id}` : 'none'} repaired=${outcome.repaired} dropped-noops=${outcome.droppedNoops.length} tokens=${totals.tokens} estimated=${totals.estimated}`);
                res.json({
                    noop: true,
                    message: '対象はすべて既に条件を満たしていました（変更は不要でした）',
                    droppedNoops: outcome.droppedNoops.length,
                    droppedNames,
                    budget: nextBudget,
                    usage: usageJson,
                    repaired: outcome.repaired,
                });
                return;
            }

            const previewId = createServerBuilderPreview({
                guildId,
                userId: session.userId,
                plan: outcome.plan,
                styleId: style.id,
                request: requestText.slice(0, 200),
                source: 'ai',
            });
            Logger.info(`[ServerBuilderAudit] action=plan guild=${guildId} user=${session.userId} (${session.username ?? ''}) style=${style.id} focus=${focus ? `${focus.kind}:${focus.id}` : 'none'} repaired=${outcome.repaired} ops=${outcome.plan.operations.length} dropped-noops=${outcome.droppedNoops.length} tokens=${totals.tokens} estimated=${totals.estimated} ops-summary=${summarizePlan(outcome.plan)}`);
            res.json({
                previewId,
                plan: outcome.plan,
                budget: nextBudget,
                usage: usageJson,
                repaired: outcome.repaired,
                droppedNoops: outcome.droppedNoops.length,
                droppedNames,
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
