import { describeStaffTool } from './StaffAIToolFormatting.js';
import { escapeMarkdown } from 'discord.js';
import { renderStaffAnsiStatus } from './StaffAIAnsiStatus.js';
import type { OpenAIChatCompletionChunk } from '../../../types/openai.js';
import type { ToolExecutionStep, ResponseApiStreamDelta } from '../../../core/ai/ChatGPTClient.js';
import { stripDiscordStreamMetadata } from '../../../core/ai/AIConversationHistory.js';

type ToolPreview = {
    id: string;
    index: number;
    name: string;
    arguments: string;
    phase: '準備中' | '実行中' | '完了' | '失敗';
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
    constructor(private readonly ansiColors = true) {}

    public content = '';
    private hasReasoning = false;
    private reasoningCharacters = 0;
    private thinkingPreview = '';
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
        this.thinkingPreview = Array.from(this.thinkingPreview + text)
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
            if (entry.function?.arguments) tool.arguments += entry.function.arguments;
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

    recordToolStep(step: ToolExecutionStep): void {
        const active = [...this.tools].reverse().find(item =>
            item.name === step.name && (item.phase === '準備中' || item.phase === '実行中'));
        const tool = active ?? {
            id: `step-${++this.callIndex}`, index: -1, name: step.name,
            arguments: '', phase: '準備中' as const,
        };
        if (!active) this.tools.push(tool);
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
        const response = stripDiscordStreamMetadata(answer) || (
            showThinking ? '' : isComplete ? '（応答なし）' : this.tools.length ? '処理中…' : '考え中…'
        );
        const separatorLength = showThinking && prefix && response ? 1 : 0;
        const available = Math.max(0, DISCORD_LIMIT - prefix.length - suffix.length - separatorLength);
        const visible = response.length > available
            ? response.slice(0, Math.max(0, available - 1)) + '…'
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

    renderDiscord(isComplete = false, answer = this.content) {
        return {
            content: this.render(isComplete, answer),
            embeds: [] as [],
            allowedMentions: { parse: [] as [] },
        };
    }
}
