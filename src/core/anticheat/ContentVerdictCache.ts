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
    const normalized = text.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
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
    private buckets = new Map<string, Set<string>>();
    private textIndex = new Map<string, Set<string>>();
    private sequence = 0;
    private revisions = new Map<string, number>();
    private persistQueue = Promise.resolve();
    constructor(private readonly persistPath: string | null = null) {
        if (persistPath) this.loadFromDisk();
    }
    private bucketKey(entry: Pick<Entry, 'guildId' | 'input'>) {
        return `${entry.guildId}:${entry.input.kind}:${entry.input.guard}`;
    }
    private textTokens(input: SimilarityInput): string[] {
        if (input.kind !== 'text') return [];
        const value = String(input.features).toLocaleLowerCase();
        const words = value.match(/[\p{L}\p{N}_]{2,}/gu) || [];
        const grams = value.length >= 3
            ? Array.from({ length: Math.min(value.length - 2, 96) }, (_, index) => value.slice(index, index + 3))
            : [];
        return [...new Set([...words.slice(0, 48), ...grams])];
    }
    private addToIndex(id: string, entry: Entry) {
        const bucket = this.bucketKey(entry);
        const bucketEntries = this.buckets.get(bucket) || new Set<string>();
        bucketEntries.add(id);
        this.buckets.set(bucket, bucketEntries);
        for (const token of this.textTokens(entry.input)) {
            const key = `${bucket}:${token}`;
            const matches = this.textIndex.get(key) || new Set<string>();
            matches.add(id);
            this.textIndex.set(key, matches);
        }
    }
    private removeFromIndex(id: string, entry: Entry) {
        const bucket = this.bucketKey(entry);
        const bucketEntries = this.buckets.get(bucket);
        bucketEntries?.delete(id);
        if (!bucketEntries?.size) this.buckets.delete(bucket);
        for (const token of this.textTokens(entry.input)) {
            const key = `${bucket}:${token}`;
            const matches = this.textIndex.get(key);
            matches?.delete(id);
            if (!matches?.size) this.textIndex.delete(key);
        }
    }
    private deleteEntry(id: string) {
        const entry = this.entries.get(id);
        if (!entry) return false;
        this.removeFromIndex(id, entry);
        return this.entries.delete(id);
    }
    private candidateIds(guildId: string, input: SimilarityInput): Iterable<string> {
        const bucket = `${guildId}:${input.kind}:${input.guard}`;
        if (input.kind !== 'text') return this.buckets.get(bucket) || [];
        const ranked = new Map<string, number>();
        for (const token of this.textTokens(input)) {
            for (const id of this.textIndex.get(`${bucket}:${token}`) || []) {
                ranked.set(id, (ranked.get(id) || 0) + 1);
            }
        }
        return [...ranked.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 128)
            .map(([id]) => id);
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
                const id = `${entry.guildId}:${entry.key}`;
                const restored = { ...entry, input };
                this.entries.set(id, restored);
                this.addToIndex(id, restored);
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
                if (entry.expires <= now) { this.deleteEntry(id); continue; }
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
        for (const [id, entry] of this.entries) if (entry.guildId === guildId) { this.deleteEntry(id); removed++; }
        this.revisions.set(guildId, ++this.sequence);
        this.persist();
        return removed;
    }
    get(guildId: string, key: string, input: SimilarityInput, similarity: number, allowSimilar: (v: ContentVerdict) => boolean) {
        const exactId = `${guildId}:${key}`;
        const exact = this.entries.get(exactId);
        if (exact) {
            if (exact.expires > Date.now()) return { verdict: exact.verdict, similarity: 1, cache: 'exact' as const };
            this.deleteEntry(exactId);
        }
        let best: { verdict: ContentVerdict; similarity: number; cache: 'exact' | 'similar' } | undefined;
        for (const id of this.candidateIds(guildId, input)) {
            const entry = this.entries.get(id);
            if (!entry) continue;
            if (entry.expires <= Date.now()) { this.deleteEntry(id); continue; }
            if (similarity <= 1 && allowSimilar(entry.verdict)) {
                const score = inputSimilarity(entry.input, input);
                if (score >= similarity && score > (best?.similarity || 0)) best = { verdict: entry.verdict, similarity: score, cache: 'similar' };
            }
        }
        return best;
    }
    set(guildId: string, key: string, input: SimilarityInput, verdict: ContentVerdict, ttlMs: number, revision: number) {
        if (revision !== this.revision(guildId)) return; // Clear also invalidates still-running requests.
        if (this.entries.size >= 10000) this.deleteEntry(this.entries.keys().next().value!);
        const id = `${guildId}:${key}`;
        this.deleteEntry(id);
        const entry = { guildId, key, input, verdict, expires: Date.now() + ttlMs };
        this.entries.set(id, entry);
        this.addToIndex(id, entry);
        this.persist();
    }
}
