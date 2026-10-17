import { buildStaffToolEmbed, buildStaffThinkingEmbed } from './StaffAIEmbed.js';
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
    public thinking = '';
    private hadContentOrThinking = false;
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
        // llama.cpp emits real generation throughput on its final usage chunk.
        // Aggregate multiple tool-call rounds without including prefill/tool execution time.
        const timing = chunk.timings;
        if (timing) {
            const measuredSpeed = timing.predicted_per_second;
            const measuredTokens = timing.predicted_n;
            if (typeof measuredSpeed === 'number' && Number.isFinite(measuredSpeed) && measuredSpeed > 0) {
                const weight = typeof measuredTokens === 'number' && Number.isFinite(measuredTokens) && measuredTokens > 0
                    ? measuredTokens : 1;
                this.timedOutputTokens += weight;
                this.timedOutputSeconds += weight / measuredSpeed;
            }
        }
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.reasoning_content) this.thinking += delta.reasoning_content;
        else if (delta?.reasoning) this.thinking += delta.reasoning;
        if (delta?.content) this.content += delta.content;
        if (delta?.content || delta?.reasoning_content || delta?.reasoning) {
            this.hadContentOrThinking = true;
        }
        for (const tool of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
            const id = tool.id || '';
            let current = id ? this.tools.find(entry => entry.id === id) : undefined;
            if (!current) {
                current = [...this.tools].reverse().find(entry =>
                    entry.index === tool.index && (entry.phase === '準備中' || entry.phase === '実行中'));
            }
            if (!current) {
                current = { id: id || `pending-${++this.callIndex}`, index: tool.index, name: '', arguments: '', phase: '準備中' };
                this.tools.push(current);
            }
            if (id) current.id = id;
            if (tool.function?.name) current.name = tool.function.name;
            if (tool.function?.arguments) current.arguments += tool.function.arguments;
        }
    }

    recordToolStep(step: ToolExecutionStep): void {
        const entry = [...this.tools].reverse().find(tool =>
            tool.name === step.name && (tool.phase === '準備中' || tool.phase === '実行中'));
        const tool = entry ?? {
            id: `step-${++this.callIndex}`, index: -1, name: step.name,
            arguments: '', phase: '準備中' as const,
        };
        if (!entry) this.tools.push(tool);
        tool.phase = step.phase === 'started' ? '実行中'
            : step.phase === 'completed' ? '完了' : '失敗';
    }

    /** Keep the visible tool log compact and leave the complete answer in the dataset. */
    render(isComplete = false, answer = this.content): string {
        const speed = this.timedOutputSeconds > 0
            ? (this.timedOutputTokens / this.timedOutputSeconds).toFixed(1)
            : '—';
        const footer = isComplete
            ? `\n-# ${speed} toks/s · toks: ${this.usageReceived ? `${this.promptTokens + this.completionTokens} (in ${this.promptTokens} / out ${this.completionTokens})` : '未取得 (API未提供)'}`
            : '\n▌';
        const prefix = '';
        const room = Math.max(0, DISCORD_LIMIT - prefix.length - footer.length);
        const visible = answer.length > room
            ? answer.slice(0, Math.max(0, room - 1)) + '…'
            : answer;
        return (prefix + (visible || (isComplete ? '（応答なし）' : '考え中…')) + footer).slice(0, DISCORD_LIMIT);
    }

    /** Discord-specific presentation: normal prose stays in content, activity stays in embeds. */
    renderDiscord(isComplete = false, answer = this.content) {
        const toolEmbed = buildStaffToolEmbed(this.tools);
        const thinkingEmbed = buildStaffThinkingEmbed(
            this.thinking, isComplete,
            !this.hadContentOrThinking && this.tools.length === 0,
        );
        return {
            content: this.render(isComplete, answer),
            embeds: [thinkingEmbed, toolEmbed].filter((entry): entry is NonNullable<typeof entry> => !!entry),
            allowedMentions: { parse: [] as [] },
        };
    }
}
