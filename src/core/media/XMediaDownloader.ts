import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const X_STATUS_URL = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d+(?:\?[^\s<>]*)?/giu;
const MEDIA_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv']);
const PROCESS_TIMEOUT_MS = 5 * 60 * 1000;

export interface DownloadedXMedia {
    directory: string;
    sourceUrl: string;
    files: string[];
    cleanup: () => Promise<void>;
}

interface VideoMetadata {
    duration: number;
    width: number;
    height: number;
    frameRate: number;
}

export function extractXStatusUrl(content: string): string | null {
    const match = content.match(X_STATUS_URL)?.[0];
    return match ? match.replace(/[),.;!?]+$/u, '') : null;
}

function executable(name: 'yt-dlp' | 'ffmpeg' | 'ffprobe'): string {
    const configured = process.env[name === 'yt-dlp' ? 'YT_DLP_PATH' : name.toUpperCase() + '_PATH'];
    return configured?.trim() || name;
}

async function runProcess(command: string, args: string[], timeoutMs = PROCESS_TIMEOUT_MS): Promise<string> {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true, shell: false });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`${command} の処理がタイムアウトしました。`));
        }, timeoutMs);

        child.stdout.on('data', chunk => { stdout += String(chunk); });
        child.stderr.on('data', chunk => { stderr += String(chunk); });
        child.once('error', error => {
            clearTimeout(timer);
            const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
            reject(new Error(missing
                ? `${command} が見つかりません。Windows または Ubuntu にインストールするか環境変数でパスを指定してください。`
                : `${command} の起動に失敗しました: ${error.message}`));
        });
        child.once('close', code => {
            clearTimeout(timer);
            if (code === 0) resolve(stdout);
            else reject(new Error(`${command} が終了コード ${code} で失敗しました: ${stderr.slice(-1500)}`));
        });
    });
}

async function listMediaFiles(directory: string): Promise<string[]> {
    return (await readdir(directory, { withFileTypes: true }))
        .filter(entry => entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map(entry => path.join(directory, entry.name));
}

async function getVideoMetadata(file: string): Promise<VideoMetadata> {
    const output = await runProcess(executable('ffprobe'), [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
        '-of', 'json', file,
    ]);
    const data = JSON.parse(output) as {
        streams?: Array<{ width?: number; height?: number; r_frame_rate?: string }>;
        format?: { duration?: string };
    };
    const stream = data.streams?.[0];
    const [numerator, denominator] = (stream?.r_frame_rate ?? '30/1').split('/').map(Number);
    return {
        duration: Math.max(Number(data.format?.duration) || 1, 1),
        width: stream?.width || 1280,
        height: stream?.height || 720,
        frameRate: denominator ? numerator / denominator : numerator || 30,
    };
}

async function compressVideo(input: string, limitBytes: number, directory: string): Promise<string> {
    const metadata = await getVideoMetadata(input);
    const output = path.join(directory, `${path.parse(input).name}-discord.mp4`);
    const targetBits = Math.floor(limitBytes * 0.96 * 8);
    const audioKbps = metadata.duration < 240 ? 128 : 96;
    const videoKbps = Math.max(160, Math.floor(targetBits / metadata.duration / 1000) - audioKbps - 24);
    const dimensions = [
        { width: metadata.width, height: metadata.height },
        { width: 1920, height: 1080 },
        { width: 1280, height: 720 },
        { width: 854, height: 480 },
        { width: 640, height: 360 },
    ].filter((item, index, array) =>
        item.width <= metadata.width && item.height <= metadata.height &&
        array.findIndex(other => other.width === item.width && other.height === item.height) === index
    );

    for (const dimension of dimensions) {
        const scale = `scale='min(${dimension.width},iw)':'min(${dimension.height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
        await runProcess(executable('ffmpeg'), [
            '-y', '-i', input,
            '-map', '0:v:0', '-map', '0:a?',
            '-vf', scale,
            '-r', String(Math.min(Math.max(metadata.frameRate, 1), 60)),
            '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
            '-b:v', `${videoKbps}k`, '-maxrate', `${Math.floor(videoKbps * 1.08)}k`, '-bufsize', `${videoKbps * 2}k`,
            '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-movflags', '+faststart', output,
        ]);
        if ((await stat(output)).size <= limitBytes) return output;
    }

    throw new Error('動画をDiscordのアップロード上限まで圧縮できませんでした。');
}

async function downloadPhotoUrlsFromMetadata(directory: string): Promise<string[]> {
    const infoFiles = (await readdir(directory)).filter(name => name.endsWith('.info.json'));
    const urls = new Set<string>();
    for (const name of infoFiles) {
        const info = JSON.parse(await readFile(path.join(directory, name), 'utf8')) as {
            entries?: Array<{ url?: string; thumbnails?: Array<{ url?: string }> }>;
            thumbnails?: Array<{ url?: string }>;
        };
        for (const thumbnail of info.thumbnails ?? []) if (thumbnail.url) urls.add(thumbnail.url);
        for (const entry of info.entries ?? []) {
            if (entry.url && /\.(?:jpe?g|png|webp)(?:\?|$)/iu.test(entry.url)) urls.add(entry.url);
            for (const thumbnail of entry.thumbnails ?? []) if (thumbnail.url) urls.add(thumbnail.url);
        }
    }

    const downloaded: string[] = [];
    let index = 1;
    for (const url of urls) {
        const response = await fetch(url);
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) continue;
        const extension = response.headers.get('content-type')?.includes('png') ? '.png' : '.jpg';
        const destination = path.join(directory, `image-${index++}${extension}`);
        await writeFile(destination, Buffer.from(await response.arrayBuffer()));
        downloaded.push(destination);
        if (downloaded.length >= 4) break;
    }
    return downloaded;
}

export async function downloadXMedia(sourceUrl: string, attachmentLimit: number): Promise<DownloadedXMedia> {
    const directory = await mkdtemp(path.join(tmpdir(), 'discord-x-media-'));
    const cleanup = async (): Promise<void> => { await rm(directory, { recursive: true, force: true }); };

    try {
        await runProcess(executable('yt-dlp'), [
            '--no-warnings', '--write-info-json', '--write-thumbnail',
            '--format', 'bestvideo*+bestaudio/best', '--merge-output-format', 'mp4',
            '--output', path.join(directory, '%(id)s-%(playlist_index|0)s.%(ext)s'),
            sourceUrl,
        ]);

        let files = await listMediaFiles(directory);
        if (!files.some(file => !file.includes('.info.') && !file.endsWith('.webp'))) {
            files.push(...await downloadPhotoUrlsFromMetadata(directory));
        }
        files = [...new Set(files)].filter(file => !file.endsWith('.webp') || files.length === 1);

        if (files.length === 0) throw new Error('投稿から画像または動画を取得できませんでした。');

        const uploadFiles: string[] = [];
        for (const file of files.slice(0, 10)) {
            const size = (await stat(file)).size;
            if (size <= attachmentLimit) {
                uploadFiles.push(file);
            } else if (VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase())) {
                uploadFiles.push(await compressVideo(file, attachmentLimit, directory));
            }
        }
        if (uploadFiles.length === 0) throw new Error('取得したメディアがDiscordの添付上限を超えています。');
        return { directory, sourceUrl, files: uploadFiles, cleanup };
    } catch (error) {
        await cleanup();
        throw error;
    }
}
