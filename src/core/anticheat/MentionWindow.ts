interface MentionRecord {
    timestamp: number;
    userIds: string[];
    roleIds: string[];
}

export function positiveSetting(value: unknown, fallback: number, maximum = 4096): number {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 ? Math.min(maximum, Math.floor(number)) : fallback;
}

// Discord collections contain each target once. Count raw occurrences instead.
export function extractMentions(content: string): { userIds: string[]; roleIds: string[] } {
    const userIds: string[] = [], roleIds: string[] = [];
    for (const match of content.matchAll(/<@([!&]?)(\d+)>/g)) {
        (match[1] === '&' ? roleIds : userIds).push(match[2]);
    }
    return { userIds, roleIds };
}

export class MentionWindow {
    private records = new Map<string, MentionRecord>();
    readonly users = new Map<string, number>();
    readonly roles = new Map<string, number>();
    userCount = 0;
    roleCount = 0;

    private adjust(record: MentionRecord, direction: 1 | -1): void {
        for (const [ids, counts] of [[record.userIds, this.users], [record.roleIds, this.roles]] as const) {
            for (const id of ids) {
                const count = (counts.get(id) || 0) + direction;
                if (count > 0) counts.set(id, count);
                else counts.delete(id);
            }
        }
        this.userCount += direction * record.userIds.length;
        this.roleCount += direction * record.roleIds.length;
    }

    update(messageId: string, mentions: ReturnType<typeof extractMentions>, now: number, windowMs: number): boolean {
        for (const [id, record] of this.records) {
            if (now - record.timestamp >= windowMs) {
                this.adjust(record, -1);
                this.records.delete(id);
            }
        }
        const previous = this.records.get(messageId);
        if (previous && previous.userIds.join(',') === mentions.userIds.join(',')
            && previous.roleIds.join(',') === mentions.roleIds.join(',')) return false;
        if (previous) {
            this.adjust(previous, -1);
            this.records.delete(messageId);
        }
        if (mentions.userIds.length + mentions.roleIds.length === 0) return false;
        // All supported thresholds fit even when each post has one mention.
        if (this.records.size >= 4096) {
            const oldest = this.records.keys().next().value!;
            this.adjust(this.records.get(oldest)!, -1);
            this.records.delete(oldest);
        }
        const record = { ...mentions, timestamp: now };
        this.records.set(messageId, record);
        this.adjust(record, 1);
        return true;
    }
}
