/** Hide leaked model tool syntax, never parse it into executable tool calls. */
export class ToolProtocolTextFilter {
    private pending = '';
    public detected = false;
    private readonly markers = ['<tool_call', '\\<tool_call', '&lt;tool_call', '<function=', '\\<function=', '&lt;function=', '<parameter=', '\\<parameter=', '&lt;parameter='];

    push(text: string): string {
        if (this.detected) return '';
        this.pending += text;
        const lower = this.pending.toLowerCase();
        let start = -1;
        for (const marker of this.markers) {
            const index = lower.indexOf(marker);
            if (index >= 0 && (start < 0 || index < start)) start = index;
        }
        if (start >= 0) {
            this.detected = true;
            const visible = this.pending.slice(0, start).replace(/(?:^|\n)\s*\d+[.)]\s*$/, '');
            this.pending = '';
            // Fail closed for the rest of this model response: HTML/file bodies
            // can themselves contain closing tool markers. The next response gets a new filter.
            return visible;
        }
        const listPrefix = this.pending.match(/(?:^|\n)[ \t]*\d+(?:[.)][ \t]*)?$/);
        if (listPrefix && listPrefix[0].length <= 64) {
            const visible = this.pending.slice(0, -listPrefix[0].length);
            this.pending = listPrefix[0];
            return visible;
        }
        let keep = 0;
        for (const marker of this.markers) {
            for (let n=1;n<marker.length;n++) if(lower.endsWith(marker.slice(0,n))) keep=Math.max(keep,n);
        }
        let visible = this.pending.slice(0, this.pending.length-keep);
        this.pending = this.pending.slice(this.pending.length-keep);
        if (keep > 0) {
            const listPrefix = visible.match(/(?:^|\n)\s*\d+[.)]\s*$/);
            if (listPrefix) {
                this.pending = listPrefix[0] + this.pending;
                visible = visible.slice(0, -listPrefix[0].length);
            }
        }
        return visible;
    }

    finish(): string {
        // A dangling marker prefix is hidden; ordinary HTML/text is preserved.
        const lower = this.pending.trimStart().replace(/^\d+[.)]\s*/, '').toLowerCase();
        const partial = lower.length > 0 && this.markers.some(marker => marker.startsWith(lower));
        const tail = this.detected || partial ? '' : this.pending;
        this.pending = '';
        return tail;
    }
}

export function stripToolProtocolText(text: string): string {
    const filter = new ToolProtocolTextFilter();
    return filter.push(text) + filter.finish();
}
