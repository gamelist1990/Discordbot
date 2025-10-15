/**
 * 権限管理ユーティリティ
 * Discord Botの権限チェックを一元管理
 */

export class PermissionManager {
    /**
     * スタッフ権限チェック
     * @param level ユーザーの権限レベル
     * @param requiredLevel 必要な最低権限レベル（デフォルト: 1）
     * @returns 権限がある場合はtrue、ない場合はfalse
     */
    static hasStaffPermission(level: number, requiredLevel: number = 1): boolean {
        return level >= requiredLevel;
    }

    /**
     * 管理者権限チェック
     * @param level ユーザーの権限レベル
     * @returns 管理者権限がある場合はtrue、ない場合はfalse
     */
    static hasAdminPermission(level: number): boolean {
        return level >= 2;
    }

    /**
     * オーナー権限チェック
     * @param level ユーザーの権限レベル
     * @returns オーナー権限がある場合はtrue、ない場合はfalse
     */
    static hasOwnerPermission(level: number): boolean {
        return level >= 3;
    }

    /**
     * 権限チェックを行い、権限がない場合はエラーレスポンスを返す
     * @param level ユーザーの権限レベル
     * @param requiredLevel 必要な最低権限レベル
     * @param errorMessage エラーメッセージ
     * @returns 権限がある場合はnull、ない場合はエラーレスポンスオブジェクト
     */
    static checkPermission(level: number, requiredLevel: number = 1, errorMessage?: string): { error: string; status: number } | null {
        if (!this.hasStaffPermission(level, requiredLevel)) {
            return {
                error: errorMessage || 'この操作にはスタッフ権限が必要です。',
                status: 403
            };
        }
        return null;
    }

    /**
     * 管理者権限チェックを行い、権限がない場合はエラーレスポンスを返す
     * @param level ユーザーの権限レベル
     * @param errorMessage エラーメッセージ
     * @returns 権限がある場合はnull、ない場合はエラーレスポンスオブジェクト
     */
    static checkAdminPermission(level: number, errorMessage?: string): { error: string; status: number } | null {
        if (!this.hasAdminPermission(level)) {
            return {
                error: errorMessage || 'この操作には管理者権限が必要です。',
                status: 403
            };
        }
        return null;
    }

    /**
     * オーナー権限チェックを行い、権限がない場合はエラーレスポンスを返す
     * @param level ユーザーの権限レベル
     * @param errorMessage エラーメッセージ
     * @returns 権限がある場合はnull、ない場合はエラーレスポンスオブジェクト
     */
    static checkOwnerPermission(level: number, errorMessage?: string): { error: string; status: number } | null {
        if (!this.hasOwnerPermission(level)) {
            return {
                error: errorMessage || 'この操作にはオーナー権限が必要です。',
                status: 403
            };
        }
        return null;
    }
}