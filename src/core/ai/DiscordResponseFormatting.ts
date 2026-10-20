const segmenter = new Intl.Segmenter('ja', {granularity: 'grapheme'});
const TABLE_WIDTH = 54;

/** Terminal-style widths for Japanese text and emoji inside Discord monospace blocks. */
export function discordDisplayWidth(value: string): number {
    let width = 0;
    for (const {segment} of segmenter.segment(value)) {
        if (/^[\p{Mark}\u200b-\u200f\ufe00-\ufe0f]+$/u.test(segment)) continue;
        const cp = segment.codePointAt(0)!;
        width += /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(segment)
            || cp >= 0x1100 && (cp <= 0x115f || cp >= 0x2e80 && cp <= 0xa4cf
                || cp >= 0xac00 && cp <= 0xd7a3 || cp >= 0xf900 && cp <= 0xfaff
                || cp >= 0xfe10 && cp <= 0xfe6f || cp >= 0xff01 && cp <= 0xff60
                || cp >= 0xffe0 && cp <= 0xffe6 || cp >= 0x20000) ? 2 : 1;
    }
    return width;
}

function tableCells(line: string): string[] | null {
    if (!line.includes('|')) return null;
    const cells: string[] = [];
    let cell = '', code = 0;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '\\' && line[i + 1] === '|') { cell += '|'; i++; continue; }
        if (char === '`') {
            let ticks = 1;
            while (line[i + ticks] === '`') ticks++;
            if (!code) code = ticks;
            else if (code === ticks) code = 0;
            cell += '`'.repeat(ticks); i += ticks - 1;
        } else if (char === '|' && !code) { cells.push(cell.trim()); cell = ''; }
        else cell += char;
    }
    cells.push(cell.trim());
    if (line.trimStart().startsWith('|')) cells.shift();
    if (line.trimEnd().endsWith('|') && cells.at(-1) === '') cells.pop();
    return cells.length >= 2 ? cells : null;
}

function plainCell(value: string): string {
    return value.replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
        .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
        .replace(/`+/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');
}

function wrap(value: string, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of value.split('\n')) {
        let line = '', size = 0;
        for (const {segment} of segmenter.segment(paragraph)) {
            const next = discordDisplayWidth(segment);
            if (line && size + next > width) { lines.push(line); line = ''; size = 0; }
            line += segment; size += next;
        }
        lines.push(line);
    }
    return lines;
}

function asciiTable(rows: string[][]): string {
    const columns = rows[0].length;
    // Very wide tables become two-column records instead of overflowing mobile screens.
    if (columns > 6) return (rows.length > 1 ? rows.slice(1) : [[]]).map((row, index) => `行 ${index + 1}\n` + asciiTable([
        ['項目', '内容'], ...rows[0].map((header, column) => [header, row[column] ?? '']),
    ])).join('\n\n');
    const plain = rows.map(row => Array.from({length: columns}, (_, i) => plainCell(row[i] ?? '')));
    const widths = Array.from({length: columns}, (_, i) => Math.max(4, Math.min(i === columns - 1 ? 36 : 22,
        Math.max(...plain.map(row => discordDisplayWidth(row[i]))))));
    while (widths.reduce((a, b) => a + b, 0) + 3 * columns + 1 > TABLE_WIDTH) {
        const widest = widths.indexOf(Math.max(...widths));
        if (widths[widest] <= 4) break;
        widths[widest]--;
    }
    const rule = '+' + widths.map(width => '-'.repeat(width + 2)).join('+') + '+';
    const output = [rule];
    plain.forEach(row => {
        const cells = row.map((cell, i) => wrap(cell, widths[i]));
        const height = Math.max(...cells.map(cell => cell.length));
        for (let line = 0; line < height; line++) output.push('| ' + cells.map((cell, i) => {
            const value = cell[line] ?? '';
            return value + ' '.repeat(Math.max(0, widths[i] - discordDisplayWidth(value)));
        }).join(' | ') + ' |');
        output.push(rule);
    });
    return '```text\n' + output.join('\n') + '\n```';
}

/** Presentation only: preserve original model text/history and all existing fenced code. */
export function formatDiscordResponse(value: string): string {
    const lines = value.replace(/\r\n/g, '\n').split('\n');
    const output: string[] = [];
    let fence: {char: string; length: number} | undefined;
    for (let i = 0; i < lines.length; i++) {
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i]);
        if (marker) {
            if (!fence) fence = {char: marker[1][0], length: marker[1].length};
            else if (marker[1][0] === fence.char && marker[1].length >= fence.length) fence = undefined;
            output.push(lines[i]); continue;
        }
        if (fence) { output.push(lines[i]); continue; }
        const header = tableCells(lines[i]);
        const separator = tableCells(lines[i + 1] ?? '');
        if (header && separator?.length === header.length && separator.every(cell => /^:?-{3,}:?$/.test(cell))) {
            const rows = [header];
            i++;
            while (i + 1 < lines.length) {
                const row = tableCells(lines[i + 1]);
                if (!row || row.length > header.length) break;
                rows.push(row); i++;
            }
            output.push(asciiTable(rows));
        } else output.push(/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(lines[i])
            ? '────────────────────' : lines[i]);
    }
    return output.join('\n');
}

/** Truncate streaming previews without leaving an open code fence. */
export function clipDiscordResponse(value: string, limit: number): string {
    if (value.length <= limit) return value;
    if (limit < 10) return '…'.slice(0, limit);
    let cut = value.slice(0, limit - 6);
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    let fence: string | undefined;
    for (const line of cut.split('\n')) {
        const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (match) {
            if (!fence) fence = match[1];
            else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = undefined;
        }
    }
    const closing = fence ? '\n' + fence : '';
    return cut.slice(0, Math.max(0, limit - closing.length - 1)) + '…' + closing;
}
