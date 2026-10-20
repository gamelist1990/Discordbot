import { describeStaffTool } from './StaffAIToolFormatting.js';
import { escapeMarkdown } from 'discord.js';
import { renderStaffAnsiStatus } from './StaffAIAnsiStatus.js';
import type { OpenAIChatCompletionChunk } from '../../../types/openai.js';
import type { ToolExecutionStep, ToolCallStreamDelta, ResponseApiStreamDelta } from '../../../core/ai/ChatGPTClient.js';
import type { APIEmbed } from 'discord.js';
import { stripDiscordStreamMetadata } from '../../../core/ai/AIConversationHistory.js';
import { ToolProtocolTextFilter, stripToolProtocolText } from '../../../core/ai/ToolProtocolTextFilter.js';
import { formatDiscordResponse, clipDiscordResponse } from '../../../core/ai/DiscordResponseFormatting.js';

type StaffAIReply = { content: string; embeds: APIEmbed[]; allowedMentions: {parse: []};
    files?: Array<{attachment: Buffer; name: string}> };

type ToolPreview = {
    id: string;
    index: number;
    name: string;
    arguments: string;
    phase: '準備中' | '実行中' | '完了' | '失敗';
    round?: number;
    itemId?: string;
    argumentCharacters?: number;
    argumentsComplete?: boolean;
    startedAt?: number;
    endedAt?: number;
    resultSummary?: string;
};

const DISCORD_LIMIT = 2000;
const THINKING_PREVIEW_LIMIT = 200;

function escapeMarkdownTail(value: string, maxLength: number): { text: string; trimmed: boolean } {
    const characters = Array.from(value);
    let start = 0;
    let text = escapeMarkdown(value);
    while (text.length > maxLength && start < characters.length) {
        start = Math.min(characters.length, start + Math.max(1, text.length - maxLength));
        text = escapeMarkdown(characters.slice(start).join(''));
    }
    return { text, trimmed: start > 0 };
}

export class StaffAIStreamState {
    constructor(private readonly ansiColors = true, private readonly nativeCards = false) {}

    public content = '';
    private hasReasoning = false;
    private reasoningCharacters = 0;
    private thinkingPreview = '';
    private readonly thinkingProtocol = new ToolProtocolTextFilter();
    private tools: ToolPreview[] = [];
    private promptTokens = 0;
    private cacheTokens = 0;
    private cacheAvailable = false;
    private streamingFrom = 0;
    private completionTokens = 0;
    private usageReceived = false;
    private timedOutputTokens = 0;
    private timedOutputSeconds = 0;
    private callIndex = 0;

    private appendThinking(text: string): void {
        if (!text) return;
        this.hasReasoning = true;
        this.reasoningCharacters += text.length;
        // Keep a rolling window so new thoughts replace the oldest text.
        this.thinkingPreview = Array.from(this.thinkingPreview + this.thinkingProtocol.push(text))
            .slice(-THINKING_PREVIEW_LIMIT)
            .join('');
    }

    consume(chunk: OpenAIChatCompletionChunk): void {
        const usage = chunk.usage;
        if (usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)) {
            this.promptTokens += usage.prompt_tokens;
            this.completionTokens += usage.completion_tokens;
            this.usageReceived = true;
        }
        const timing = chunk.timings;
        if (timing) {
            const speed = timing.predicted_per_second;
            const n = timing.predicted_n;
            if (typeof speed === 'number' && Number.isFinite(speed) && speed > 0) {
                const weight = typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 1;
                this.timedOutputTokens += weight;
                this.timedOutputSeconds += weight / speed;
            }
        }
        const delta = chunk.choices?.[0]?.delta;
        const reasoning = delta?.reasoning_content || delta?.reasoning || '';
        this.appendThinking(reasoning);
        if (delta?.content) this.content += delta.content;
        for (const entry of delta?.tool_calls ?? []) {
            const id = entry.id || '';
            let tool = id ? this.tools.find(item => item.id === id) : undefined;
            if (!tool) {
                tool = [...this.tools].reverse().find(item =>
                    item.index === entry.index && (item.phase === '準備中' || item.phase === '実行中'));
            }
            if (!tool) {
                tool = { id: id || `pending-${++this.callIndex}`, index: entry.index, name: '', arguments: '', phase: '準備中' };
                this.tools.push(tool);
            }
            if (id) tool.id = id;
            if (entry.function?.name) tool.name = entry.function.name;
            if (entry.function?.arguments && (!this.nativeCards || tool.round === undefined)) {
                tool.arguments += entry.function.arguments;
            }
        }
    }

    /** Native /v1/responses SSE: reasoning and output text arrive independently. */
    consumeResponse(delta: ResponseApiStreamDelta): void {
        if (delta.type === 'thinking') {
            if (delta.text) {
                if (!this.streamingFrom) this.streamingFrom = Date.now();
                this.appendThinking(delta.text);
            }
            return;
        }
        if (delta.type === 'text') {
            if (delta.text) {
                if (!this.streamingFrom) this.streamingFrom = Date.now();
                this.content += delta.text;
            }
            return;
        }
        if (delta.type !== 'usage') return;
        if (typeof delta.inputTokens === 'number' && typeof delta.outputTokens === 'number') {
            this.promptTokens += delta.inputTokens;
            this.completionTokens += delta.outputTokens;
            this.usageReceived = true;
        }
        if (typeof delta.cachedInputTokens === 'number') {
            this.cacheTokens += delta.cachedInputTokens;
            this.cacheAvailable = true;
        }
        if (delta.predictedPerSecond && delta.predictedPerSecond > 0) {
            const count = delta.predictedTokens && delta.predictedTokens > 0 ? delta.predictedTokens : 1;
            this.timedOutputTokens += count;
            this.timedOutputSeconds += count / delta.predictedPerSecond;
        } else if (this.streamingFrom && (delta.outputTokens || 0) > 0) {
            // Approximate when native llama timings are absent.
            this.timedOutputTokens += delta.outputTokens!;
            this.timedOutputSeconds += Math.max(0.001, (Date.now() - this.streamingFrom) / 1000);
        }
        this.streamingFrom = 0;
    }

    recordToolCall(call: ToolCallStreamDelta): boolean {
        let tool = this.tools.find(item => (call.callId && item.id === call.callId && (item.round === undefined || item.round === call.round))
            || (call.itemId && item.itemId === call.itemId && item.round === call.round));
        tool ??= this.tools.find(item => item.round === call.round && item.index === call.index
            && item.phase === '準備中' && item.id.startsWith('stream:'));
        const created = !tool;
        if (!tool) {
            tool = {id: call.callId ?? `stream:${call.round}:${call.itemId ?? call.index ?? ++this.callIndex}`,
                index: call.index ?? -1, name: call.name, arguments: '', phase: '準備中', round: call.round};
            this.tools.push(tool);
        }
        if (call.callId) tool.id = call.callId;
        if (call.itemId) tool.itemId = call.itemId;
        tool.name = call.name;
        tool.argumentCharacters = Math.max(tool.argumentCharacters ?? 0, call.argumentCharacters);
        tool.argumentsComplete ||= call.argumentsComplete;
        if (call.arguments) tool.arguments = call.arguments;
        return created;
    }

    recordToolStep(step: ToolExecutionStep): void {
        const id = step.callId || `step-${step.round}-${step.name}`;
        const active = this.tools.find(item => item.id === id && (item.round === undefined || item.round === step.round)) ?? (!step.callId ? [...this.tools].reverse().find(item =>
            item.name === step.name && (item.phase === '準備中' || item.phase === '実行中')) : undefined);
        const tool = active ?? {
            id, index: -1, name: step.name,
            arguments: '', phase: '準備中' as const,
        };
        if (!active) this.tools.push(tool);
        tool.round = step.round;
        if (step.arguments) tool.arguments = step.arguments;
        if (step.phase === 'started') tool.startedAt ??= Date.now();
        else tool.endedAt = Date.now();
        tool.resultSummary = step.phase === 'started' ? undefined : step.resultSummary
            ?? (step.phase === 'failed' ? step.error?.startsWith('Tool not found:') ? '指定されたツールは登録されていません' : '入力・取得・実行に失敗しました' : undefined);
        tool.phase = step.phase === 'started' ? '実行中'
            : step.phase === 'completed' ? '完了' : '失敗';
    }

    /** Discord's standard markdown: no embeds or raw tool JSON. */
    render(isComplete = false, answer = this.content): string {
        const speed = this.timedOutputSeconds > 0
            ? (this.timedOutputTokens / this.timedOutputSeconds).toFixed(1) : '—';
        const footer = isComplete
            ? `-# ${speed} toks/s · 合計 ${this.usageReceived ? `${this.promptTokens + this.completionTokens} toks (in ${this.promptTokens} / out ${this.completionTokens})` : '未取得 (API未提供)'}`
            : '-# ▌ 生成中…';
        const latest = this.tools.slice(-2);
        const statusLines = latest.map(tool => {
            const info = describeStaffTool(tool);
            return `-# ${info.name} — ${info.value}`;
        });
        // Keep the rolling thought preview visible while answer text streams too.
        const showThinking = !isComplete && this.hasReasoning;
        if (!this.ansiColors && showThinking) {
            statusLines.unshift(`-# 💭 Thinking · ストリーミング中（${this.reasoningCharacters}文字）`);
        }
        if (!this.ansiColors && isComplete && this.hasReasoning) {
            statusLines.unshift(`-# 💭 Thinking · 完了（${this.reasoningCharacters}文字）`);
        }
        if (!this.ansiColors && !isComplete && !this.hasReasoning) {
            statusLines.unshift('-# 💭 Thinking · 詳細待機中');
        }
        const activity = !this.ansiColors && statusLines.length ? '\n' + statusLines.join('\n') : '';
        // Optional ANSI decoration for desktop Discord. Plain Markdown above it
        // stays readable on mobile and other clients without ANSI rendering.
        const ansi = this.ansiColors
            ? renderStaffAnsiStatus(latest, isComplete
                ? this.hasReasoning ? { active: false, characters: this.reasoningCharacters } : undefined
                : this.hasReasoning
                    ? { active: true, characters: this.reasoningCharacters }
                    : { active: true, characters: 0, waiting: true })
            : '';
        const status = activity + ansi;
        const statusText = status.trim();
        const thinkingText = this.thinkingPreview.replace(/\s+/g, ' ').trim();
        const escapedThinking = escapeMarkdownTail(
            thinkingText,
            Math.max(0, DISCORD_LIMIT - statusText.length - footer.length - 5),
        );
        const previewWasTrimmed = this.reasoningCharacters > this.thinkingPreview.length || escapedThinking.trimmed;
        const quotedThinking = showThinking && escapedThinking.text
            ? `> ${previewWasTrimmed ? '…' : ''}${escapedThinking.text}`
            : '';
        const prefix = showThinking
            ? [statusText, quotedThinking].filter(Boolean).join('\n')
            : '';
        // Keep token usage at the very bottom, after optional tool progress.
        const suffix = (showThinking ? '' : status) + '\n' + footer;
        const response = formatDiscordResponse(stripDiscordStreamMetadata(stripToolProtocolText(answer))) || (
            showThinking ? '' : isComplete ? '（応答なし）' : this.tools.length ? '処理中…' : '考え中…'
        );
        const separatorLength = showThinking && prefix && response ? 1 : 0;
        const available = Math.max(0, DISCORD_LIMIT - prefix.length - suffix.length - separatorLength);
        const visible = response.length > available
            ? clipDiscordResponse(response, available)
            : response;
        const body = showThinking
            ? [prefix, visible].filter(Boolean).join('\n')
            : visible;
        return (body + suffix).slice(0, DISCORD_LIMIT);
    }

    usageMetrics() {
        return {
            input: this.promptTokens, output: this.completionTokens,
            generatedSeconds: this.timedOutputSeconds,
            cached: this.cacheAvailable ? this.cacheTokens : undefined,
        };
    }

    /** Preserve usage from a failed attempt when a sanitized retry succeeds. */
    addUsageMetrics(metrics: ReturnType<StaffAIStreamState['usageMetrics']>): void {
        this.promptTokens += metrics.input;
        this.completionTokens += metrics.output;
        this.usageReceived ||= metrics.input > 0 || metrics.output > 0;
        this.timedOutputTokens += metrics.output;
        this.timedOutputSeconds += metrics.generatedSeconds;
        if (metrics.cached !== undefined) {
            this.cacheTokens += metrics.cached;
            this.cacheAvailable = true;
        }
    }

    renderDiscord(isComplete = false, answer = this.content): StaffAIReply {
        if (this.nativeCards) return this.renderNativeDiscord(isComplete, answer);
        const content = this.render(isComplete, answer);
        const full = formatDiscordResponse(stripDiscordStreamMetadata(stripToolProtocolText(answer)));
        return {
            content,
            embeds: [] as [],
            allowedMentions: { parse: [] as [] },
            ...(isComplete && full && !content.includes(full)
                ? {files: [{attachment: Buffer.from(full, 'utf8'), name: 'ai-response.txt'}]} : {}),
        };
    }

    private renderNativeDiscord(isComplete: boolean, answer: string) {
        const now = Date.now();
        const active = this.tools.filter(tool => tool.phase === '準備中' || tool.phase === '実行中');
        const completed = this.tools.filter(tool => tool.phase === '完了').length;
        const failed = this.tools.filter(tool => tool.phase === '失敗').length;
        // Keep active work visible even if newer calls have already finished.
        const visible = [...this.tools.filter(tool => !active.includes(tool)).slice(-Math.max(0, 8 - active.length)),
            ...active].slice(-8);
        const description = [
            !isComplete ? active.length ? 'ツールを使用しています。'
                : this.content ? '回答を生成しています。' : '💭 応答を準備しています。' : '',
            this.tools.length ? `ツール ${this.tools.length}件 · 完了 ${completed}件 · 失敗 ${failed}件` : '',
            isComplete && active.length ? `未完了 ${active.length}件` : '',
            this.tools.length > visible.length ? `直近と実行中の${visible.length}件を表示` : '',
        ].filter(Boolean).join('\n');
        const fields = visible.map(tool => {
            const info = describeStaffTool(tool);
            const detail = tool.phase === '準備中'
                ? isComplete ? '呼び出し未実行' : tool.argumentsComplete ? '引数の生成完了・実行待ち'
                    : `引数を生成中（${tool.argumentCharacters ?? tool.arguments.length}文字）`
                : tool.startedAt !== undefined ? `${Math.max(0, Math.floor(((tool.endedAt ?? now) - tool.startedAt) / 1000))}秒` : '';
            return {name: info.name, value: [info.value, detail].filter(Boolean).join('\n'), inline: false};
        });
        const speed = this.timedOutputSeconds > 0 ? (this.timedOutputTokens / this.timedOutputSeconds).toFixed(1) : '—';
        const tokens = this.usageReceived ? `合計 ${this.promptTokens + this.completionTokens} toks (in ${this.promptTokens} / out ${this.completionTokens})`
            : '合計 未取得 (API未提供)';
        const embed: APIEmbed = {
            title: isComplete ? failed || active.length ? '回答完了（一部ツールが失敗・未完了）' : '回答完了'
                : active.some(tool => tool.phase === '実行中') ? '🛠️ ツール実行中'
                : active.length ? '🧩 ツール呼び出しを生成中' : this.content ? '✍️ 回答を生成中' : '💭 応答を準備中',
            color: isComplete ? failed || active.length ? 0xF4A261 : 0x47C989 : 0x53C4E6,
            ...(description ? {description} : {}),
            ...(fields.length ? {fields} : {}),
            footer: {text: `${speed} toks/s · ${tokens}`},
        };
        const full = formatDiscordResponse(stripDiscordStreamMetadata(stripToolProtocolText(answer)));
        const overflow = full.length > DISCORD_LIMIT;
        return {content: full ? overflow ? clipDiscordResponse(full, isComplete ? 1900 : DISCORD_LIMIT)
            + (isComplete ? '\n\n全文は添付の回答ファイルをご覧ください。' : '') : full
            : isComplete ? '（応答なし）' : '', embeds: [embed], allowedMentions: {parse: [] as []},
            ...(isComplete && overflow ? {files: [{attachment: Buffer.from(full, 'utf8'), name: 'ai-response.txt'}]} : {})};
    }
}
