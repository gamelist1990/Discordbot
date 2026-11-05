// src/commands/staff/subcommands/StaffAIDotMode.ts
import { database } from '../../../core/persistence/Database.js';

/** Bot全体で共有する Staff AI 設定の保存先スコープ（Database の guildId 枠を流用）。 */
export const STAFF_AI_SETTINGS_SCOPE = 'global';
export const STAFF_AI_DOT_MODE_KEY = 'staffAiDotMode';

export type StaffAISettingsParse =
    | { kind: 'set'; value: boolean }
    | { kind: 'status' }
    | { kind: 'invalid' };

/**
 * `/staff ai settings` の入力を解釈する。
 * 対応形式: "mode dot true" / "mode dot false" / "mode dot"（状態確認）。
 */
export function parseStaffAISettings(input: string): StaffAISettingsParse {
    const normalized = input.trim().toLowerCase().replace(/\s+/g, ' ');
    if (normalized === 'mode dot') return { kind: 'status' };
    if (normalized === 'mode dot true') return { kind: 'set', value: true };
    if (normalized === 'mode dot false') return { kind: 'set', value: false };
    return { kind: 'invalid' };
}

/** dotモードが有効か。読み取りに失敗した場合は安全側（無効）に倒す。 */
export async function getStaffAIDotMode(): Promise<boolean> {
    try {
        return (await database.get<boolean>(STAFF_AI_SETTINGS_SCOPE, STAFF_AI_DOT_MODE_KEY, false)) === true;
    } catch (error) {
        console.warn('[StaffAI] dotモード設定の読み取りに失敗:', error);
        return false;
    }
}

export async function setStaffAIDotMode(value: boolean): Promise<void> {
    await database.set(STAFF_AI_SETTINGS_SCOPE, STAFF_AI_DOT_MODE_KEY, value);
}
