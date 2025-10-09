import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
// Import the implementation directly to avoid executing pdf-parse's top-level test harness
import * as pdfParseModule from 'pdf-parse/lib/pdf-parse.js';
const pdfParse: (data: Buffer | Uint8Array | ArrayBuffer | { data: Buffer | Uint8Array | ArrayBuffer }) => Promise<any> = (pdfParseModule as any).default || (pdfParseModule as any);
import { config } from '../config';

// Simple in-file vector store using JSON. Not optimized for production.
type VectorItem = {
  id: string;
  sourceFile: string;
  chunkText: string;
  embedding: number[];
};

export class PdfRAGManager {
  private storePath: string;
  private store: VectorItem[] = [];

  constructor(storePath?: string) {
    this.storePath = storePath || path.join(__dirname, '..', 'Data', 'pdf_vectors.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf8');
        this.store = JSON.parse(raw) as VectorItem[];
      }
    } catch (err) {
      console.error('PdfRAGManager load error:', err);
      this.store = [];
    }
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), 'utf8');
    } catch (err) {
      console.error('PdfRAGManager save error:', err);
    }
  }

  private async embedTexts(texts: string[]): Promise<number[][]> {
    // Call OpenAI embeddings endpoint
    const payload = { input: texts, model: 'text-embedding-3-small' };
    const res = await fetch(`${config.openai.apiEndpoint}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openai.apiKey}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Embedding request failed: ' + res.statusText);
    const body = await res.json();
    return body.data.map((d: any) => d.embedding as number[]);
  }

  private chunkText(text: string, maxChars = 1000): string[] {
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = '';
    for (const line of lines) {
      if ((current + '\n' + line).length > maxChars) {
        if (current) chunks.push(current.trim());
        current = line;
      } else {
        current = current ? `${current}\n${line}` : line;
      }
    }
    if (current) chunks.push(current.trim());
    return chunks;
  }

  public async indexPdfBuffer(buffer: Buffer, sourceId?: string) {
    const pdf = await pdfParse(buffer as any);
    const text = String(pdf.text || '');
    const chunks = this.chunkText(text, 1000);
    const embeddings = await this.embedTexts(chunks);

    const fileId = sourceId || crypto.createHash('sha1').update(buffer).digest('hex');
    // Remove existing items for same fileId
    this.store = this.store.filter(i => i.sourceFile !== fileId);

    for (let i = 0; i < chunks.length; i++) {
      this.store.push({ id: `${fileId}_${i}`, sourceFile: fileId, chunkText: chunks[i], embedding: embeddings[i] });
    }

    this.save();
    return { fileId, chunksIndexed: chunks.length };
  }

  private cosineSim(a: number[], b: number[]) {
    let dot = 0, la = 0, lb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      la += a[i] * a[i];
      lb += b[i] * b[i];
    }
    if (la <= 0 || lb <= 0) return 0;
    return dot / (Math.sqrt(la) * Math.sqrt(lb));
  }

  public async queryRelevant(text: string, topK = 3) {
    const emb = (await this.embedTexts([text]))[0];
    const scored = this.store.map(s => ({ item: s, score: this.cosineSim(emb, s.embedding) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => ({ id: s.item.id, text: s.item.chunkText, score: s.score }));
  }
}
