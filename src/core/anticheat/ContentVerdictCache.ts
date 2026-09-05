import sharp from 'sharp';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import type { ContentVerdict } from './detectors/ContentSafetyDetector.js';

export interface SimilarityInput { kind: 'text' | 'image'; features: string | Buffer; guard: string }
interface Entry { guildId: string; key: string; input: SimilarityInput; verdict: ContentVerdict; expires: number }
interface StoredEntry extends Omit<Entry, 'input'> {
    input: Omit<SimilarityInput, 'features'> & { features: string; encoding?: 'base64' };
}

export const CONTENT_VERDICT_CACHE_PATH = path.join(process.cwd(), 'Database', 'system', 'content-safety-cache.json');

export async function similarityInput(text: string, images: string[]): Promise<SimilarityInput> {
    if (images.length) {
        const features = Buffer.concat(await Promise.all(images.map(async image => sharp(Buffer.from(image.split(',')[1], 'base64'))
            .resize(16, 16, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer())));
        // A changed caption can reverse the interpretation of an otherwise identical image.
        return { kind: 'image', features, guard: `${images.length}:${createHash('sha256').update(text).digest('hex')}` };
    }
    const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const guard = (normalized.match(/ない|ません|相談|引用|報告|被害|教育|医療|[「」"“”]|\b(?:not|never|no|report|quote)\b/gi) || []).join('|');
    return { kind: 'text', features: normalized, guard };
}

export function inputSimilarity(a: SimilarityInput, b: SimilarityInput): number {
    if (a.kind !== b.kind || a.guard !== b.guard) return 0;
    if (a.kind === 'text') {
        const left = String(a.features), right = String(b.features);
        if (left.length < 30 || right.length < 30) return left === right ? 1 : 0;
        if (Math.min(left.length, right.length) / Math.max(left.length, right.length) < .9) return 0;
        const grams = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 2) }, (_, i) => text.slice(i, i + 3)));
        const x = grams(left), y = grams(right);
        return 2 * [...x].filter(item => y.has(item)).length / (x.size + y.size);
    }
    const left = a.features as Buffer, right = b.features as Buffer;
    if (left.length !== right.length) return 0;
    let delta = 0, edges = 0, matches = 0;
    for (let i = 0; i < left.length; i++) {
        delta += Math.abs(left[i] - right[i]);
        if (i % 48 < 45) {
            const x = left[i + 3] - left[i], y = right[i + 3] - right[i];
            if (Math.abs(x) > 8 || Math.abs(y) > 8) { edges++; if (Math.sign(x) === Math.sign(y)) matches++; }
        }
    }
    return Math.min(1 - delta / (255 * left.length), edges ? matches / edges : 1);
}

export class ContentVerdictCache {
    private entries = new Map<string, Entry>();
    private sequence = 0;
    private revisions = new Map<string, number>();
    private persistQueue = Promise.resolve();
    constructor(private readonly persistPath: string | null = null) {
        if (persistPath) this.loadFromDisk();
    }
    private loadFromDisk() {
        try {
            const stored = JSON.parse(fs.readFileSync(this.persistPath!, 'utf8')) as StoredEntry[];
            const now = Date.now();
            for (const entry of Array.isArray(stored) ? stored : []) {
                if (!entry || entry.expires <= now || typeof entry.guildId !== 'string' || typeof entry.key !== 'string') continue;
                const input: SimilarityInput = {
                    kind: entry.input.kind,
                    guard: entry.input.guard,
                    features: entry.input.encoding === 'base64'
                        ? Buffer.from(entry.input.features, 'base64')
                        : entry.input.features
                };
                this.entries.set(`${entry.guildId}:${entry.key}`, { ...entry, input });
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[ContentSafety] persisted cache could not be loaded; starting empty');
        }
    }
    private persist() {
        if (!this.persistPath) return;
        this.persistQueue = this.persistQueue.then(async () => {
            const now = Date.now();
            const stored: StoredEntry[] = [];
            for (const [id, entry] of this.entries) {
                if (entry.expires <= now) { this.entries.delete(id); continue; }
                stored.push({
                    ...entry,
                    input: {
                        kind: entry.input.kind,
                        guard: entry.input.guard,
                        features: Buffer.isBuffer(entry.input.features) ? entry.input.features.toString('base64') : entry.input.features,
                        ...(Buffer.isBuffer(entry.input.features) ? { encoding: 'base64' as const } : {})
                    }
                });
            }
            await fsPromises.mkdir(path.dirname(this.persistPath!), { recursive: true });
            const temporary = `${this.persistPath!}.tmp`;
            await fsPromises.writeFile(temporary, JSON.stringify(stored), 'utf8');
            await fsPromises.rename(temporary, this.persistPath!);
        }).catch(() => console.warn('[ContentSafety] persisted cache could not be saved'));
    }
    async flush() { await this.persistQueue; }
    revision(guildId: string) { return this.revisions.get(guildId) || 0; }
    clear(guildId: string): number {
        let removed = 0;
        for (const [id, entry] of this.entries) if (entry.guildId === guildId) { this.entries.delete(id); removed++; }
        this.revisions.set(guildId, ++this.sequence);
        this.persist();
        return removed;
    }
    get(guildId: string, key: string, input: SimilarityInput, similarity: number, allowSimilar: (v: ContentVerdict) => boolean) {
        let best: { verdict: ContentVerdict; similarity: number; cache: 'exact' | 'similar' } | undefined;
        for (const [id, entry] of this.entries) {
            if (entry.expires <= Date.now()) { this.entries.delete(id); continue; }
            if (entry.guildId !== guildId) continue;
            if (entry.key === key) return { verdict: entry.verdict, similarity: 1, cache: 'exact' as const };
            if (similarity <= 1 && allowSimilar(entry.verdict)) {
                const score = inputSimilarity(entry.input, input);
                if (score >= similarity && score > (best?.similarity || 0)) best = { verdict: entry.verdict, similarity: score, cache: 'similar' };
            }
        }
        return best;
    }
    set(guildId: string, key: string, input: SimilarityInput, verdict: ContentVerdict, ttlMs: number, revision: number) {
        if (revision !== this.revision(guildId)) return; // Clear also invalidates still-running requests.
        if (this.entries.size >= 2000) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(`${guildId}:${key}`, { guildId, key, input, verdict, expires: Date.now() + ttlMs });
        this.persist();
    }
}
