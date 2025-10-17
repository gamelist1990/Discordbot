/**
 * Tab補完ユーティリティ
 * プレースホルダーの自動補完機能を提供
 */

import { PLACEHOLDERS } from './placeholders.js';

export interface TabCompletionResult {
    completed: boolean;
    newValue: string;
    newCursorPos: number;
    candidates?: string[];
}

/**
 * Tab キーハンドラー
 * textareaの現在位置から プレースホルダー補完候補を検出・適用
 */
export function handleTabCompletion(
    textarea: HTMLTextAreaElement,
    event: React.KeyboardEvent<HTMLTextAreaElement>
): TabCompletionResult | null {
    if (event.key !== 'Tab') {
        return null;
    }

    const value = textarea.value;
    const cursorPos = textarea.selectionStart;

    // 現在のカーソル位置から左側の { を探す
    let bracketPos = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
        if (value[i] === '{') {
            bracketPos = i;
            break;
        }
        if (value[i] === '\n' || value[i] === ' ') {
            // { を見つける前に改行やスペースがあれば、補完対象外
            if (i !== cursorPos - 1) break;
        }
    }

    if (bracketPos === -1) {
        return null;
    }

    // カーソル位置までのテキスト
    const prefix = value.substring(bracketPos, cursorPos);

    // マッチする候補を検索
    const candidates = PLACEHOLDERS.filter(p => p.name.startsWith(prefix)).map(p => p.name);

    if (candidates.length === 0) {
        return null;
    }

    // 候補が1つだけの場合はそれを適用
    if (candidates.length === 1) {
        const placeholder = candidates[0];
        const newValue = value.substring(0, bracketPos) + placeholder + value.substring(cursorPos);
        const newCursorPos = bracketPos + placeholder.length;

        return {
            completed: true,
            newValue,
            newCursorPos,
        };
    }

    // 複数候補の場合は最初の共通部分を適用
    const commonPrefix = findCommonPrefix(candidates);
    if (commonPrefix.length > prefix.length) {
        const newValue = value.substring(0, bracketPos) + commonPrefix + value.substring(cursorPos);
        const newCursorPos = bracketPos + commonPrefix.length;

        return {
            completed: false,
            newValue,
            newCursorPos,
            candidates,
        };
    }

    // 候補を返すだけ
    return {
        completed: false,
        newValue: value,
        newCursorPos: cursorPos,
        candidates,
    };
}

/**
 * 文字列配列の共通接頭辞を探す
 */
function findCommonPrefix(strings: string[]): string {
    if (strings.length === 0) return '';

    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
        let j = 0;
        while (j < prefix.length && j < strings[i].length && prefix[j] === strings[i][j]) {
            j++;
        }
        prefix = prefix.substring(0, j);
    }

    return prefix;
}

/**
 * プレースホルダー候補をリスト表示
 */
export function getPlaceholderCandidates(prefix: string): typeof PLACEHOLDERS {
    if (!prefix.startsWith('{')) {
        return [];
    }

    return PLACEHOLDERS.filter(p => p.name.startsWith(prefix));
}
