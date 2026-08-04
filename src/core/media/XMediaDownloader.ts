import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const X_STATUS_URL = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d+(?:\?[^\s<>]*)?/giu;
const YOUTUBE_SHORTS_URL = /https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/[A-Za-z0-9_-]+(?:\?[^\s<>]*)?/giu;
const MEDIA_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv']);
const PROCESS_TIMEOUT_MS = 5 * 60 * 1000;
const FFMPEG_MAX_CONCURRENCY = 1;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_YOUTUBE_COOKIES_FILE = path.resolve(
    currentDirectory,
    '../../../assets/youtube/youtube-cookies.json',
);
let youtubeJsRuntimeArgsPromise: Promise<string[]> | undefined;

interface YoutubeCookie {
    domain?: string;
    expirationDate?: number;
    httpOnly?: boolean;
    name?: string;
    path?: string;
    secure?: boolean;
    session?: boolean;
    value?: string;
}

type CompressionJob = {
    run: () => Promise<string>;
    resolve: (value: string) => void;
    reject: (reason: unknown) => void;
};

const compressionQueue: CompressionJob[] = [];
let activeCompressionCount = 0;

function processCompressionQueue(): void {
    if (activeCompressionCount >= FFMPEG_MAX_CONCURRENCY) return;

    const job = compressionQueue.shift();
    if (!job) return;

    activeCompressionCount++;
    void job.run()
        .then(job.resolve, job.reject)
        .finally(() => {
            activeCompressionCount--;
            processCompressionQueue();
        });
}

function enqueueCompression(run: () => Promise<string>): Promise<string> {
    return new Promise((resolve, reject) => {
        compressionQueue.push({ run, resolve, reject });
        processCompressionQueue();
    });
}

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
    return match ? normalizeXStatusUrl(match) : null;
}

export function extractSupportedMediaUrl(content: string): string | null {
    const xUrl = extractXStatusUrl(content);
    if (xUrl) return xUrl;

    const shortsMatch = content.match(YOUTUBE_SHORTS_URL)?.[0];
    return shortsMatch ? normalizeYouTubeShortsUrl(shortsMatch) : null;
}

function normalizeXStatusUrl(sourceUrl: string): string {
    const parsed = new URL(sourceUrl.replace(/[),.;!?]+$/u, ''));
    parsed.protocol = 'https:';
    parsed.hostname = 'x.com';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
}

function normalizeYouTubeShortsUrl(sourceUrl: string): string {
    const parsed = new URL(sourceUrl.replace(/[),.;!?]+$/u, ''));
    const shortsId = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)\/?$/u)?.[1];
    if (!shortsId) throw new Error('YouTubeはショート動画のURLのみ対応しています。');
    return `https://www.youtube.com/shorts/${shortsId}`;
}

function isYouTubeShortsUrl(sourceUrl: string): boolean {
    try {
        const parsed = new URL(sourceUrl);
        return /^(?:www\.|m\.)?youtube\.com$/iu.test(parsed.hostname)
            && /^\/shorts\/[A-Za-z0-9_-]+\/?$/u.test(parsed.pathname);
    } catch {
        return false;
    }
}

function getXStatusUrlCandidates(sourceUrl: string): string[] {
    return [normalizeXStatusUrl(sourceUrl)];
}

function executable(name: 'gallery-dl' | 'yt-dlp' | 'ffmpeg' | 'ffprobe'): string {
    const environmentName = name === 'gallery-dl'
        ? 'GALLERY_DL_PATH'
        : name === 'yt-dlp'
            ? 'YT_DLP_PATH'
            : `${name.toUpperCase()}_PATH`;
    const configured = process.env[environmentName];
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

function galleryDlAuthenticationArgs(): string[] {
    const cookiePath = process.env.X_COOKIES_PATH?.trim();
    if (cookiePath) return ['--cookies', cookiePath];

    const browser = process.env.X_COOKIES_BROWSER?.trim();
    if (browser) return ['--cookies-from-browser', browser];

    return [];
}

async function youtubeAuthenticationArgs(directory: string): Promise<string[]> {
    const configuredPath = process.env.YOUTUBE_COOKIES_PATH?.trim();
    let cookieSource: string;

    cookieSource = configuredPath
        ? path.resolve(configuredPath)
        : DEFAULT_YOUTUBE_COOKIES_FILE;

    try {
        await access(cookieSource);
    } catch {
        return [];
    }

    // yt-dlpの--cookiesはNetscape形式を要求するため、
    // ブラウザー拡張形式のJSON Cookieを一時ファイルへ変換する。
    if (path.extname(cookieSource).toLowerCase() === '.json') {
        const parsed = JSON.parse(await readFile(cookieSource, 'utf8')) as YoutubeCookie[];
        const lines = [
            '# Netscape HTTP Cookie File',
            '# Generated from assets/youtube/youtube-cookies.json',
        ];

        for (const cookie of parsed) {
            const domain = cookie.domain?.trim();
            const name = cookie.name?.trim();
            if (!domain || !name || cookie.value === undefined) continue;

            const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
            const cookiePath = cookie.path?.trim() || '/';
            const secure = cookie.secure ? 'TRUE' : 'FALSE';
            const expiration = cookie.session
                ? 0
                : Math.max(0, Math.floor(cookie.expirationDate ?? 0));
            const netscapeDomain = cookie.httpOnly
                ? `#HttpOnly_${domain}`
                : domain;

            lines.push([
                netscapeDomain,
                includeSubdomains,
                cookiePath,
                secure,
                String(expiration),
                name,
                cookie.value,
            ].join('\t'));
        }

        const convertedPath = path.join(directory, 'youtube-cookies.txt');
        await writeFile(convertedPath, `${lines.join('\n')}\n`, {
            encoding: 'utf8',
            mode: 0o600,
        });
        return ['--cookies', convertedPath];
    }

    return ['--cookies', cookieSource];
}

async function canRunExecutable(command: string): Promise<boolean> {
    try {
        await runProcess(command, ['--version'], 15_000);
        return true;
    } catch {
        return false;
    }
}

async function detectYoutubeJsRuntimeArgs(): Promise<string[]> {
    if (!youtubeJsRuntimeArgsPromise) {
        youtubeJsRuntimeArgsPromise = (async (): Promise<string[]> => {
            const configuredDenoPath = process.env.DENO_PATH?.trim();
            const candidates = [
                configuredDenoPath,
                path.join(homedir(), '.deno', 'bin', process.platform === 'win32' ? 'deno.exe' : 'deno'),
                process.platform === 'win32'
                    ? path.join(process.env.USERPROFILE ?? homedir(), '.deno', 'bin', 'deno.exe')
                    : '/home/ubuntu/.deno/bin/deno',
                'deno',
            ].filter((candidate): candidate is string => Boolean(candidate));

            for (const candidate of [...new Set(candidates)]) {
                if (await canRunExecutable(candidate)) {
                    return [
                        '--js-runtimes',
                        `deno:${candidate}`,
                        '--remote-components',
                        'ejs:npm',
                    ];
                }
            }

            // Denoが利用できない環境では従来どおり取得を試行する。
            return [];
        })();
    }

    return await youtubeJsRuntimeArgsPromise;
}

async function downloadWithGalleryDl(sourceUrl: string, directory: string): Promise<string[]> {
    await runProcess(executable('gallery-dl'), [
        '--config-ignore',
        '--no-mtime',
        '--directory', directory,
        '--filename', '{tweet_id}_{num}.{extension}',
        ...galleryDlAuthenticationArgs(),
        sourceUrl,
    ]);
    return await listMediaFiles(directory);
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

async function compressVideoNow(input: string, limitBytes: number, directory: string): Promise<string> {
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
            '-y',
            '-threads', '1',
            '-filter_threads', '1',
            '-filter_complex_threads', '1',
            '-i', input,
            '-map', '0:v:0', '-map', '0:a?',
            '-vf', scale,
            '-r', String(Math.min(Math.max(metadata.frameRate, 1), 30)),
            '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
            '-b:v', `${videoKbps}k`, '-maxrate', `${Math.floor(videoKbps * 1.08)}k`, '-bufsize', `${videoKbps * 2}k`,
            '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-movflags', '+faststart', output,
        ]);
        if ((await stat(output)).size <= limitBytes) return output;
    }

    throw new Error('動画をDiscordのアップロード上限まで圧縮できませんでした。');
}

async function compressVideo(input: string, limitBytes: number, directory: string): Promise<string> {
    return await enqueueCompression(() => compressVideoNow(input, limitBytes, directory));
}

export async function downloadXMedia(sourceUrl: string, attachmentLimit: number): Promise<DownloadedXMedia> {
    const directory = await mkdtemp(path.join(tmpdir(), 'discord-x-media-'));
    const cleanup = async (): Promise<void> => { await rm(directory, { recursive: true, force: true }); };

    try {
        if (isYouTubeShortsUrl(sourceUrl)) {
            const normalizedShortsUrl = normalizeYouTubeShortsUrl(sourceUrl);
            const youtubeAuthArgs = await youtubeAuthenticationArgs(directory);
            const youtubeJsRuntimeArgs = await detectYoutubeJsRuntimeArgs();
            const args = [
                ...youtubeAuthArgs,
                ...youtubeJsRuntimeArgs,
                '--no-warnings', '--no-playlist',
                '--format', 'bestvideo*+bestaudio/best',
                '--merge-output-format', 'mp4',
                '--output', path.join(directory, '%(id)s.%(ext)s'),
                normalizedShortsUrl,
            ];
            await runProcess(executable('yt-dlp'), args);

            const downloadedFiles = await listMediaFiles(directory);
            const videoFiles = downloadedFiles.filter(file => VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()));
            if (videoFiles.length === 0) throw new Error('YouTubeショート動画を取得できませんでした。');

            const video = videoFiles[0];
            const size = (await stat(video)).size;
            const uploadFile = size <= attachmentLimit
                ? video
                : await compressVideo(video, attachmentLimit, directory);
            return { directory, sourceUrl: normalizedShortsUrl, files: [uploadFile], cleanup };
        }

        if (!extractXStatusUrl(sourceUrl)) {
            throw new Error('対応しているのはXの投稿またはYouTubeショート動画のURLのみです。');
        }

        let files: string[] = [];
        let galleryError: unknown = null;
        for (const candidate of getXStatusUrlCandidates(sourceUrl)) {
            try {
                files = await downloadWithGalleryDl(candidate, directory);
                if (files.length > 0) break;
            } catch (error) {
                galleryError = error;
            }
        }

        // gallery-dlは画像と動画の両方を扱う。利用不能または抽出失敗時のみ、
        // 動画に強いyt-dlpを後方互換のフォールバックとして使用する。
        let ytDlpError: unknown = null;
        if (files.length === 0) {
            for (const candidate of getXStatusUrlCandidates(sourceUrl)) {
                try {
                    await runProcess(executable('yt-dlp'), [
                    '--no-warnings', '--no-playlist', '--write-info-json', '--write-thumbnail',
                    '--format', 'bestvideo*+bestaudio/best', '--merge-output-format', 'mp4',
                    '--output', path.join(directory, '%(id)s-%(playlist_index|0)s.%(ext)s'),
                    ...galleryDlAuthenticationArgs(),
                    candidate,
                    ]);
                    files = await listMediaFiles(directory);
                    if (files.length > 0) break;
                } catch (error) {
                    ytDlpError = error;
                }
            }
        }

        if (files.length === 0) {
            const galleryMessage = galleryError instanceof Error ? galleryError.message : String(galleryError ?? '取得結果なし');
            const ytDlpMessage = ytDlpError instanceof Error ? ytDlpError.message : String(ytDlpError ?? '取得結果なし');
            throw new Error(`gallery-dlで取得できませんでした: ${galleryMessage}\nyt-dlpでも取得できませんでした: ${ytDlpMessage}`);
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
        return { directory, sourceUrl: normalizeXStatusUrl(sourceUrl), files: uploadFiles, cleanup };
    } catch (error) {
        await cleanup();
        throw error;
    }
}
