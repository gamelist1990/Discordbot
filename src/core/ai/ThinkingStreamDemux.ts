import type { ResponseApiStreamDelta } from './ChatGPTClient.js';

/**
 * RustingStrata's XML chat template starts generation inside <think>, but its
 * chat streaming route currently labels every output token as regular content.
 * Turn that raw text into genuine thinking/text deltas for the Discord UI.
 * Use only for the local Ornith model with enable_thinking explicitly enabled.
 */
export class ThinkingStreamDemux {
    private thinking = true;
    private pending = '';
    private afterClosingTag = false;

    public push(delta: ResponseApiStreamDelta): ResponseApiStreamDelta[] {
        if (delta.type === 'thinking') {
            // Future backend versions may provide native structured reasoning.
            this.thinking = false;
            this.pending = '';
            return [delta];
        }
        if (delta.type !== 'text' || !delta.text) return [delta];
        if (!this.thinking) {
            if (!this.afterClosingTag) return [delta];
            const answer = delta.text.replace(/^[\r\n]+/, '');
            if (answer) this.afterClosingTag = false;
            return answer ? [{...delta, text: answer}] : [];
        }

        this.pending += delta.text;
        const end = '</think>';
        const index = this.pending.indexOf(end);
        if (index >= 0) {
            const thought = this.pending.slice(0, index).replace(/^<think>\s*/, '');
            const answer = this.pending.slice(index + end.length).replace(/^\n+/, '');
            this.pending = '';
            this.thinking = false;
            this.afterClosingTag = !answer;
            return [
                ...(thought ? [{type: 'thinking' as const, text: thought}] : []),
                ...(answer ? [{type: 'text' as const, text: answer}] : []),
            ];
        }

        // Hold back seven Unicode characters to prevent a split "</think>"
        // delimiter from leaking into the UI.
        const chars = Array.from(this.pending);
        if (chars.length <= end.length - 1) return [];
        const count = chars.length - (end.length - 1);
        const thought = chars.slice(0, count).join('');
        this.pending = chars.slice(count).join('');
        return thought ? [{type: 'thinking', text: thought}] : [];
    }

    public finish(): ResponseApiStreamDelta[] {
        if (!this.thinking || !this.pending) return [];
        const thought = this.pending.replace(/^<think>\s*/, '');
        this.pending = '';
        return thought ? [{type: 'thinking', text: thought}] : [];
    }
}
