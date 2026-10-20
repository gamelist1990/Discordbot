/** Ordered Discord edits: coalesce text deltas, retain a bounded set of tool transitions. */
export class StaffAILiveUpdates<T> {
    private milestones: T[] = [];
    private latest: T | undefined;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private sending = false;
    private closed = false;
    private failed = false;
    private lastSentAt = 0;
    private lastQueued = '';
    private waiters: Array<() => void> = [];

    constructor(private readonly send: (payload: T) => Promise<unknown>, private readonly intervalMs = 600,
        private readonly onError: (error: unknown) => void = () => {}) {}

    queue(payload: T, milestone = false): void {
        if (this.closed || this.failed) return;
        const key = JSON.stringify(payload);
        if (key === this.lastQueued) return;
        this.lastQueued = key;
        if (milestone) {
            this.latest = undefined;
            this.milestones.push(payload);
            if (this.milestones.length > 8) this.milestones.shift();
        } else this.latest = payload;
        this.pump();
    }

    /** Drain actual tool transitions before the caller writes the final response. */
    finish(): Promise<void> {
        this.closed = true;
        this.latest = undefined;
        if (!this.sending && !this.milestones.length) {
            if (this.timer) clearTimeout(this.timer);
            this.timer = undefined;
            return Promise.resolve();
        }
        const finished = new Promise<void>(resolve => this.waiters.push(resolve));
        this.pump();
        return finished;
    }

    private pump(): void {
        if (this.sending || this.timer) return;
        if (!this.milestones.length && this.latest === undefined) {
            for (const resolve of this.waiters.splice(0)) resolve();
            return;
        }
        const wait = Math.max(0, this.intervalMs - (Date.now() - this.lastSentAt));
        if (wait) {
            this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, wait);
            return;
        }
        const payload = this.milestones.shift() ?? this.latest!;
        if (!this.milestones.length && payload === this.latest) this.latest = undefined;
        this.sending = true;
        this.lastSentAt = Date.now();
        void Promise.resolve().then(() => this.send(payload)).catch(error => {
            this.failed = true;
            this.milestones = [];
            this.latest = undefined;
            this.onError(error);
        }).finally(() => { this.sending = false; this.pump(); });
    }
}
