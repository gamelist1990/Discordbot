import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { OpenAITool, ToolHandler } from '../../../types/openai.js';
import type { ChatAIToolRegistrar } from './types.js';
import type { ChatAISandboxPaths } from '../types.js';

const execFileAsync = promisify(execFile);
const BASH_TIMEOUT_MS = 15_000;
const MAX_BASH_OUTPUT = 12_000;

const sandboxBashDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'sandbox_bash',
        description: '隔離された作業フォルダ内だけで安全なbashコマンドを実行します。sudo、OS情報取得、外部領域アクセス、危険操作は禁止です。downloads/はユーザー提示ファイル参照、uploads/は作成ファイル配置用です。',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '実行するbashコマンド。安全な読み取り・変換・軽量処理のみ。' },
            },
            required: ['command'],
        },
    },
};

export const registerSandboxBashTool: ChatAIToolRegistrar = (manager, context) => {
    manager.registerTool(sandboxBashDefinition, createSandboxBashHandler(context.sandboxPaths));
};

function createSandboxBashHandler(paths: ChatAISandboxPaths): ToolHandler {
    return async (args) => {
        const command = String(args?.command ?? '').trim();
        if (!command) return 'コマンドが空です。';
        const check = validateSandboxCommand(command);
        if (!check.ok) return `BLOCKED: ${check.reason}`;

        await ensureSandbox(paths);
        try {
            const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
                cwd: paths.work,
                timeout: BASH_TIMEOUT_MS,
                maxBuffer: 128 * 1024,
                env: {
                    PATH: process.env.PATH || '',
                    HOME: paths.root,
                    PWD: paths.work,
                    CHAT_AI_SANDBOX: paths.root,
                    CHAT_AI_DOWNLOADS: paths.downloads,
                    CHAT_AI_UPLOADS: paths.uploads,
                },
            });
            const output = [`$ ${command}`, stdout, stderr ? `STDERR:\n${stderr}` : ''].filter(Boolean).join('\n');
            return output.slice(0, MAX_BASH_OUTPUT);
        } catch (error: any) {
            const stdout = error?.stdout ? String(error.stdout) : '';
            const stderr = error?.stderr ? String(error.stderr) : '';
            return [`COMMAND_ERROR: ${error?.message || String(error)}`, stdout, stderr].filter(Boolean).join('\n').slice(0, MAX_BASH_OUTPUT);
        }
    };
}

async function ensureSandbox(paths: ChatAISandboxPaths): Promise<void> {
    await Promise.all([
        fs.mkdir(paths.root, { recursive: true }),
        fs.mkdir(paths.work, { recursive: true }),
        fs.mkdir(paths.downloads, { recursive: true }),
        fs.mkdir(paths.uploads, { recursive: true }),
    ]);
}

function validateSandboxCommand(command: string): { ok: true } | { ok: false; reason: string } {
    const lowered = command.toLowerCase();
    const blocked = [
        'sudo', 'su ', 'powershell', 'pwsh', 'cmd.exe', 'reg ', 'net user', 'whoami', 'hostname', 'systeminfo',
        'shutdown', 'reboot', 'format', 'diskpart', 'mount', 'umount', 'chmod 777', 'chown', '/etc/', '/proc/', '/sys/',
        'c:/', 'c:\\', '\\windows', '../', '..\\', '~/', '$home', '%userprofile%', 'curl ', 'wget ', 'ssh ', 'scp ', 'ftp ',
    ];
    const hit = blocked.find(token => lowered.includes(token));
    if (hit) return { ok: false, reason: `禁止された操作を含みます: ${hit}` };

    const first = lowered.split(/\s+/)[0]?.replace(/[^a-z0-9_.-]/g, '') || '';
    const allowedFirst = new Set(['pwd', 'ls', 'cat', 'head', 'tail', 'grep', 'find', 'sed', 'awk', 'python', 'python3', 'node', 'bun', 'echo', 'date', 'wc', 'sort', 'uniq', 'mkdir', 'touch', 'cp', 'mv', 'tar', 'zip', 'unzip']);
    if (!allowedFirst.has(first)) {
        return { ok: false, reason: `許可されていないコマンドです: ${first || '(unknown)'}` };
    }

    return { ok: true };
}
