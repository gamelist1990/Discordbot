import { Router } from 'express';
import { verifyAuth } from '../middleware/auth.js';
import type { SettingsSession } from '../types/index.js';
import config from '../../config.js';
import { database } from '../../core/persistence/Database.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = () => path.resolve(database.getDataDir());
const isOwner = (session: SettingsSession | undefined) =>
    !!session && Array.isArray(config.owner) && config.owner.includes(session.userId);
async function databaseFiles() {
    const files: Array<{ id: string; bytes: number }> = [];
    async function visit(dir: string) {
        for (const ent of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
            if (ent.isSymbolicLink()) continue;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) { await visit(full); continue; }
            if (!ent.isFile()) continue;
            const id = path.relative(root(), full).replaceAll(path.sep, '/');
            const stat = await fs.stat(full);
            files.push({ id, bytes: stat.size });
        }
    }
    await visit(root());
    return files.sort((a,b) => b.bytes - a.bytes);
}

export function createSystemManagementRoutes(sessions: Map<string, SettingsSession>): Router {
    const router = Router();
    router.use(verifyAuth(sessions));
    router.use((req,res,next) => {
        if (!isOwner((req as any).session)) { res.status(403).json({error:'Botオーナーのみ'}); return; }
        next();
    });
    router.get('/status', async (_req,res) => {
        try {
            const [disk, files] = await Promise.all([fs.statfs(root()), databaseFiles()]);
            const memory = process.memoryUsage();
            const total = disk.blocks * disk.bsize, free = disk.bavail * disk.bsize;
            const totalRam = os.totalmem(), freeRam = os.freemem();
            res.setHeader('Cache-Control','no-store');
            res.json({
                uptimeSeconds: process.uptime(), systemUptimeSeconds: os.uptime(),
                disk: { total, free, used: total-free, usedPercent: total ? 100*(total-free)/total : 0 },
                ram: { total: totalRam, free: freeRam, used: totalRam-freeRam, usedPercent:100*(totalRam-freeRam)/totalRam,
                    botRss: memory.rss, botHeap:memory.heapUsed },
                database: { totalBytes: files.reduce((n,file) => n+file.bytes,0), fileCount:files.length,
                    files:files.slice(0,100), groups: Object.entries(files.reduce<Record<string,number>>((x,f)=>{
                      const group=f.id.split('/').slice(0,2).join('/');x[group]=(x[group]||0)+f.bytes;return x;
                    },{})).map(([name,bytes])=>({name,bytes})).sort((a,b)=>b.bytes-a.bytes) },
            });
        } catch { res.status(500).json({error:'統計を取得できません'}); }
    });
    router.delete('/database', async (req,res) => {
        const id = req.body?.id;
        if (typeof id !== 'string' || !id.endsWith('.json') || id.includes('..') || id.startsWith('/') ||
            !/^[\w./-]+$/.test(id)) { res.status(400).json({error:'不正なファイルID'});return; }
        try {
            const target = path.resolve(root(), id);
            if (!target.startsWith(root()+path.sep)) { res.status(403).end();return; }
            // Critical auth and configuration are not disposable cache.
            if (/^(system\/auth\/|system\/|integrations\/)/.test(id)) {
                res.status(403).json({error:'システム認証・統合データは削除禁止'}); return;
            }
            const file = (await databaseFiles()).find(f=>f.id===id);
            if (!file) {res.status(404).json({error:'ファイルがありません'});return;}
            await fs.unlink(target);
            database.clearCache();
            res.json({removed:id,bytes:file.bytes});
        } catch {res.status(500).json({error:'削除失敗'});}
    });
    return router;
}
