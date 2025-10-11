/**
 * 権限レベル定義
 * 数値が大きいほど高い権限を表す
 */
export enum PermissionLevel {
  /** 全員 (0) - 基本的なアクセス権限 */
  ANY = 0,

  /** スタッフ (1) - ロールを持つユーザー */
  STAFF = 1,

  /** 管理者 (2) - サーバーの管理権限ロールを持つユーザー */
  ADMIN = 2,

  /** オーナー (3) - サーバーのオーナー */
  OWNER = 3,
}

/**
 * 権限レベルに対応する説明
 */
export const PermissionLevelDescriptions = {
  [PermissionLevel.ANY]: '全員',
  [PermissionLevel.STAFF]: 'スタッフ（ロール持ち）',
  [PermissionLevel.ADMIN]: '管理者（管理権限ロール持ち）',
  [PermissionLevel.OWNER]: 'オーナー',
} as const;

/**
 * 指定された権限レベルが必要な権限を満たしているかをチェック
 * @param userLevel ユーザーの権限レベル
 * @param requiredLevel 必要な権限レベル
 * @returns 権限が満たされている場合true
 */
export function hasPermission(userLevel: PermissionLevel, requiredLevel: PermissionLevel): boolean {
  return userLevel >= requiredLevel;
}

/**
 * 権限レベルを文字列に変換
 */
export function permissionLevelToString(level: PermissionLevel): string {
  return PermissionLevelDescriptions[level] || '不明';
}

/**
 * 文字列から権限レベルに変換
 */
export function stringToPermissionLevel(str: string): PermissionLevel | null {
  const entries = Object.entries(PermissionLevelDescriptions) as [string, string][];
  const found = entries.find(([, desc]) => desc === str);
  return found ? parseInt(found[0]) as PermissionLevel : null;
}