import { describeStaffTool } from './StaffAIToolFormatting.js';
import type { OpenAIChatCompletionChunk } from '../../../types/openai.js';
import type { ToolExecutionStep } from '../../../core/ai/ChatGPTClient.js';

type ToolPreview = {
    id: string;
    index: number;
    name: string;
    arguments: string;
    phase: '準備中' | '実行中' | '完了' | '失敗';
};

const DISCORD_LIMIT = 2000;

export class StaffAIStreamState {
    public content = '';
    private hasReasoning = false;
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
        if (delta?.reasoning_content || delta?.reasoning) this.hasReasoning = true;
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
        if (showThinking) statusLines.unshift('-# 💭 考え中…');
        const activity = statusLines.length ? '\n' + statusLines.join('\n') : '';
        // Keep token usage at the very bottom, after optional tool progress.
        const suffix = activity + '\n' + footer;
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
