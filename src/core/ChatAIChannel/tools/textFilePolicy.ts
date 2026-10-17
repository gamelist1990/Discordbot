import path from 'node:path';

export const CHAT_AI_TEXT_FILE_MAX_BYTES = 256 * 1024;

export const CHAT_AI_TEXT_FILE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
    '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown',
    '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
    '.json': 'application/json', '.csv': 'text/csv', '.xml': 'application/xml',
    '.yaml': 'application/yaml', '.yml': 'application/yaml', '.log': 'text/plain',
    '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript',
    '.ts': 'text/plain', '.tsx': 'text/plain', '.jsx': 'text/plain',
    '.py': 'text/x-python', '.java': 'text/plain', '.c': 'text/plain', '.h': 'text/plain',
    '.cpp': 'text/plain', '.hpp': 'text/plain', '.rs': 'text/plain', '.go': 'text/plain',
    '.sql': 'text/plain', '.sh': 'text/plain',
};

export function normalizeChatAITextFilename(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 180) return null;
    const normalized = value.replace(/\\/g, '/');
    const filename = path.posix.basename(normalized).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!filename || filename === '.' || filename === '..' || filename.startsWith('.')) return null;
    return CHAT_AI_TEXT_FILE_MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] ? filename : null;
}
