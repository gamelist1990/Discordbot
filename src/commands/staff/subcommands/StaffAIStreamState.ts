import { describeStaffTool } from './StaffAIToolFormatting.js';
import { renderStaffAnsiStatus } from './StaffAIAnsiStatus.js';
import type { OpenAIChatCompletionChunk } from '../../../types/openai.js';
import type { ToolExecutionStep, ResponseApiStreamDelta } from '../../../core/ai/ChatGPTClient.js';

type ToolPreview = {
    id: string;
    index: number;
    name: string;
    arguments: string;
    phase: '準備中' | '実行中' | '完了' | '失敗';
};

const DISCORD_LIMIT = 2000;

export class StaffAIStreamState {
    constructor(private readonly ansiColors = true) {}

    public content = '';
    private hasReasoning = false;
    private reasoningCharacters = 0;
    private tools: ToolPreview[] = [];
    private promptTokens = 0;
    private completionTokens = 0;
    private usageReceived = false;
    private timedOutputTokens = 0;
    private timedOutputSeconds = 0;
    private callIndex = 0;

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
        // Never show raw model reasoning in public Discord. Show a small progress indicator.
        if (delta?.reasoning_content || delta?.reasoning) {
            this.hasReasoning = true;
            this.reasoningCharacters += (delta.reasoning_content || delta.reasoning || '').length;
        }
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
                this.hasReasoning = true;
                this.reasoningCharacters += delta.text.length;
            }
            return;
        }
        if (delta.type === 'text') {
            if (delta.text) this.content += delta.text;
            return;
        }
        if (delta.type !== 'usage') return;
        if (typeof delta.inputTokens === 'number' && typeof delta.outputTokens === 'number') {
            this.promptTokens += delta.inputTokens;
            this.completionTokens += delta.outputTokens;
            this.usageReceived = true;
        }
        if (delta.predictedPerSecond && delta.predictedPerSecond > 0) {
            const count = delta.predictedTokens && delta.predictedTokens > 0 ? delta.predictedTokens : 1;
            this.timedOutputTokens += count;
            this.timedOutputSeconds += count / delta.predictedPerSecond;
        }
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

    /** Discord's standard markdown: no embeds, JSON dumps, or raw reasoning. */
    render(isComplete = false, answer = this.content): string {
        const speed = this.timedOutputSeconds > 0
            ? (this.timedOutputTokens / this.timedOutputSeconds).toFixed(1) : '—';
        const footer = isComplete
            ? `-# ${speed} toks/s · toks: ${this.usageReceived ? `${this.promptTokens + this.completionTokens} (in ${this.promptTokens} / out ${this.completionTokens})` : '未取得 (API未提供)'}`
            : '-# ▌ 生成中…';
        const latest = this.tools.slice(-2);
        const statusLines = latest.map(tool => {
            const info = describeStaffTool(tool);
            return `-# ${info.name} — ${info.value}`;
        });
        const showThinking = !isComplete && this.hasReasoning && !this.content.trim();
        if (!this.ansiColors && showThinking) {
            statusLines.unshift(`-# 💭 Thinking · ストリーミング中（${this.reasoningCharacters}文字）`);
        }
        if (!this.ansiColors && isComplete && this.hasReasoning) {
            statusLines.unshift(`-# 💭 Thinking · 完了（${this.reasoningCharacters}文字）`);
        }
        const activity = !this.ansiColors && statusLines.length ? '\n' + statusLines.join('\n') : '';
        // Optional ANSI decoration for desktop Discord. Plain Markdown above it
        // stays readable on mobile and other clients without ANSI rendering.
        const ansi = this.ansiColors
            ? renderStaffAnsiStatus(latest, this.hasReasoning && (showThinking || isComplete)
                ? { active: showThinking, characters: this.reasoningCharacters }
                : undefined)
            : '';
        // Keep token usage at the very bottom, after optional tool progress.
        const suffix = activity + ansi + '\n' + footer;
        const available = Math.max(0, DISCORD_LIMIT - suffix.length - 1);
        const response = answer.trim() || (isComplete ? '（応答なし）' : this.tools.length ? '処理中…' : '考え中…');
        const visible = response.length > available
            ? response.slice(0, Math.max(0, available - 1)) + '…'
            : response;
        return (visible + suffix).slice(0, DISCORD_LIMIT);
    }

    renderDiscord(isComplete = false, answer = this.content) {
        return {
            content: this.render(isComplete, answer),
            embeds: [] as [],
            allowedMentions: { parse: [] as [] },
        };
    }
}
