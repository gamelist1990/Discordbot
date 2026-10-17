import { describeStaffTool, type StaffToolView } from './StaffAIToolFormatting.js';

// Discord's October 2026 desktop update supports truecolor ANSI (38;2;R;G;B).
// Only opt-in, never replace accessible Markdown status lines on mobile.
const ESC = '\u001b';
const RESET = `${ESC}[0m`;

function safeAnsiText(value: string): string {
    return value
        // Prevent untrusted arguments from breaking the code fence or injecting control sequences.
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
        .replace(/`/g, '＇')
        .replace(/@(?!\u200b)/g, '@\u200b')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 96);
}

type Rgb = readonly [red: number, green: number, blue: number];

const COLORS = {
    thinking: [180, 135, 245],
    completed: [71, 201, 137],
    failed: [244, 105, 105],
    running: [83, 196, 230],
    pending: [251, 190, 95],
} as const satisfies Record<string, Rgb>;

function colored(value: string, rgb: Rgb): string {
    return `${ESC}[38;2;${rgb.join(';')}m${safeAnsiText(value)}${RESET}`;
}

export function renderStaffAnsiStatus(
    toolViews: StaffToolView[],
    thinking?: { active: boolean; characters: number; waiting?: boolean },
): string {
    const lines: string[] = [];
    if (thinking) {
        lines.push(colored(
            thinking.waiting
                ? '💭 Thinking · 詳細待機中'
                : `💭 Thinking · ${thinking.active ? 'ストリーミング中' : '完了'} (${thinking.characters}文字)`,
            COLORS.thinking,
        ));
    }

    for (const tool of toolViews.slice(-2)) {
        const info = describeStaffTool(tool);
        const color = tool.phase === '完了' ? COLORS.completed
            : tool.phase === '失敗' ? COLORS.failed
                : tool.phase === '実行中' ? COLORS.running : COLORS.pending;
        lines.push(colored(`${info.name} — ${info.value}`, color));
    }

    return lines.length > 0 ? `\n\`\`\`ansi\n${lines.join('\n')}\n\`\`\`` : '';
}
