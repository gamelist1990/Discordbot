import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type DotInteractionPreferenceCommand = 'opt-out' | 'opt-in';

/** This parser is only used on posts that explicitly @mention the bot. */
export function parseDotInteractionPreference(text: string): DotInteractionPreferenceCommand | null {
    const input = text.replace(/<@!?\d+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!input || input.length > 160) return null;
    if (/(?:関わらないで|絡まないで|話しかけないで|返信しないで|反応しないで|勝手に反応(?:するな|しないで|やめて|.{0,15}やめて(?:ほしい)?)|反応するの(?:だけは)?やめて|もう(?:絡むな|話しかけるな|返事するな|反応するな)|無視して|放っておいて|ほっといて|ミュートして|関わるの(?:やめて|禁止))/.test(input)) return 'opt-out';
    if (/(?:ミュート解除|反応制限(?:を)?解除|無視(?:を)?解除|関わらない設定(?:を)?解除|また(?:反応して|話しかけて)|(?:反応|返信|話しかけ|関わっ)て(?:いいよ|いいです|OK)|(?:制限を)?解除して)/.test(input)) return 'opt-in';
    return null;
}

/** Persistent per-guild, per-member opt-out, with atomic disk replacement. */
export class DotInteractionOptOutStore {
    private loaded = false;
    private muted = new Map<string, Set<string>>();

    constructor(private readonly filePath = join(process.cwd(), 'Data', 'dot-interaction-optout.json')) {}

    private load(): void {
        if (this.loaded) return;
        let raw: string;
        try { raw = readFileSync(this.filePath, 'utf8'); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                this.loaded = true;
                return;
            }
            throw error;
        }
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid dot opt-out store');
        for (const [guildId, userIds] of Object.entries(parsed)) {
            if (!/^\d+$/.test(guildId) || !Array.isArray(userIds)) throw new Error('Invalid dot opt-out guild');
            if (!userIds.every(id => typeof id === 'string' && /^\d+$/.test(id))) throw new Error('Invalid dot opt-out users');
            this.muted.set(guildId, new Set(userIds));
        }
        this.loaded = true;
    }

    has(guildId: string, userId: string): boolean {
        this.load();
        return this.muted.get(guildId)?.has(userId) ?? false;
    }

    set(guildId: string, userId: string, mute: boolean): boolean {
        this.load();
        const existing = this.muted.get(guildId) ?? new Set<string>();
        if (existing.has(userId) === mute) return false;
        const updated = new Map(this.muted);
        const users = new Set(existing);
        if (mute) users.add(userId); else users.delete(userId);
        if (users.size) updated.set(guildId, users); else updated.delete(guildId);
        const data = Object.fromEntries([...updated].map(([guild, ids]) => [guild, [...ids].sort()]));
        mkdirSync(dirname(this.filePath), { recursive: true });
        const tmp = this.filePath + '.tmp';
        writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
        renameSync(tmp, this.filePath);
        this.muted = updated;
        return true;
    }
}
