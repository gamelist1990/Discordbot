import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const MAX_COMMAND = 16_000;
const MAX_OUTPUT = 32_000;
const TIMEOUT_MS = 5_000;
let active = 0;

type Calculation = { engine: 'bash' | 'bash+bc'; program: string };

/** Parse a small Bash interface, never a general shell command or interpolated bc input. */
export function parseBashCalculation(command: string): Calculation | null {
    if (!command.trim() || command.length > MAX_COMMAND || command.includes('\0')) return null;
    const source = command.trim();
    const heredoc = /^bc\s+-l\s+<<\s*'([A-Za-z_][A-Za-z0-9_]*)'\r?\n([\s\S]*?)\r?\n\1$/.exec(source);
    const pipe = /^(?:printf[ \t]+'%s\\n'|echo)[ \t]+'([^']+)'[ \t]*\|[ \t]*bc[ \t]+-l$/.exec(source);
    const bc = heredoc?.[2] ?? pipe?.[1];
    if (bc !== undefined && bc.trim()) return { engine: 'bash+bc', program: bc };

    const arithmetic = /^(?:echo|printf '%s\\n')\s+(?:"\$\(\(([\s\S]*)\)\)"|\$\(\(([\s\S]*)\)\))$/.exec(source);
    const expression = arithmetic?.[1] ?? arithmetic?.[2];
    if (!expression?.trim()) return null;
    // No identifiers, assignments, array subscripts, variable expansion or command substitution.
    // Numbers and operators are the only text allowed into the arithmetic shell expression.
    const token = /\s*(?:0[xX][0-9a-fA-F]+|[0-9]+|\*\*|<<|>>|<=|>=|==|!=|&&|\|\||[()+\-*/%<>&|^!~?:,])/y;
    let offset = 0, depth = 0;
    while (offset < expression.trimEnd().length) {
        token.lastIndex = offset;
        const match = token.exec(expression);
        if (!match) return null;
        if (match[0].trim() === '(') depth++;
        if (match[0].trim() === ')' && --depth < 0) return null;
        offset = token.lastIndex;
    }
    if (depth !== 0) return null;
    return { engine: 'bash', program: expression };
}

/** Only fixed shell templates run. User bc programs are sent over stdin as data. */
export async function runBashCalculation(command: string): Promise<object> {
    const calculation = parseBashCalculation(command);
    if (!calculation) return { error: '計算用Bash構文のみ対応しています。例: echo "$((2**10))" または printf \'%s\\n\' \'scale=50; sqrt(2)\' | bc -l。複雑な計算は bc -l <<\'BC\' の引用付きヒアドキュメントを使ってください。' };
    if (process.platform !== 'linux') return { error: 'Bash計算にはLinux上の /usr/bin/bash と /usr/bin/bc が必要です' };
    if (active >= 2) return { error: '計算が混み合っています。実行中の計算が完了してから再試行してください' };
    active++;
    try {
        return await new Promise<object>(resolve => {
            const fixedProgram = 'set -e\nulimit -t 3\nulimit -v 131072\nulimit -f 0\n'
                + (calculation.engine === 'bash+bc' ? 'exec /usr/bin/bc -l'
                    : `printf '%s\\n' "$(( ${calculation.program} ))"`);
            const child = spawn('/usr/bin/bash', ['--noprofile', '--norc', '-c', fixedProgram], {
                cwd: tmpdir(), detached: true, stdio: ['pipe', 'pipe', 'pipe'],
                env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', BC_LINE_LENGTH: '0' },
            });
            const stdout: Buffer[] = [], stderr: Buffer[] = [];
            let bytes = 0, failure: string | undefined;
            const kill = () => {
                if (!child.pid) return;
                try { process.kill(-child.pid, 'SIGKILL'); }
                catch { child.kill('SIGKILL'); }
            };
            const timer = setTimeout(() => { failure = '計算時間の上限（5秒）を超えました'; kill(); }, TIMEOUT_MS);
            const collect = (buffers: Buffer[]) => (data: Buffer) => {
                bytes += data.length;
                if (bytes > MAX_OUTPUT) {
                    failure = '計算の出力量が上限（32000バイト）を超えました';
                    kill();
                    return;
                }
                buffers.push(data);
            };
            child.stdout.on('data', collect(stdout));
            child.stderr.on('data', collect(stderr));
            child.stdin.on('error', () => { /* EPIPE is reported through the child exit/result. */ });
            child.on('error', () => { failure = 'Bash計算を起動できませんでした。bashとbcのインストールを確認してください'; });
            child.on('close', (code, signal) => {
                clearTimeout(timer);
                const output = Buffer.concat(stdout).toString('utf8').trim();
                const errors = Buffer.concat(stderr).toString('utf8').trim();
                // GNU bc can exit 0 even after reporting a syntax/runtime error on stderr.
                if (failure || code !== 0 || errors || !output) {
                    resolve({ error: failure ?? (signal ? '計算のリソース上限を超えたため終了しました'
                        : '計算に失敗しました。構文・ゼロ除算・計算範囲を確認してください'),
                    stderr: errors, engine: calculation.engine });
                } else resolve({ success: true, engine: calculation.engine, stdout: output });
            });
            child.stdin.end(calculation.engine === 'bash+bc' ? calculation.program + '\n' : undefined);
        });
    } finally { active--; }
}
