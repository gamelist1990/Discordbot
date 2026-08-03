import type { DetectorDefinition } from './viewTypes';
import type { AntiCheatSettings, WordFilterRule } from './types';

export const DETECTORS: DetectorDefinition[] = [
  { key: 'textSpam', title: 'テキストスパム', description: '短時間の連投を検知します。', icon: 'sms', fields: [
    { kind: 'number', key: 'windowSeconds', label: '監視秒数', defaultValue: 5, min: 1 },
    { kind: 'number', key: 'rapidMessageCount', label: '大量投稿回数', defaultValue: 6, min: 1 },
    { kind: 'number', key: 'duplicateThreshold', label: '重複しきい値', defaultValue: 3, min: 1 },
  ] },
  { key: 'inviteReferral', title: '広告・紹介リンク', description: '招待リンクと紹介パターンを止めます。', icon: 'campaign', fields: [
    { kind: 'list', key: 'blockedDomains', label: 'ブロックドメイン', wide: true, placeholder: 'example.com' },
    { kind: 'list', key: 'blockedPatterns', label: '広告パターン', wide: true, placeholder: 'promo, affiliate' },
  ] },
  { key: 'redirectLink', title: '危険リンク', description: '危険な転送リンクを検知します。', icon: 'link', fields: [
    { kind: 'list', key: 'allowDomains', label: '許可ドメイン', wide: true, placeholder: 'discord.com' },
    { kind: 'number', key: 'maxDepth', label: '最大追跡段数', defaultValue: 5, min: 1 },
    { kind: 'number', key: 'timeoutMs', label: 'タイムアウト(ms)', defaultValue: 2500, min: 500, step: 100 },
  ] },
  { key: 'copyPaste', title: 'コピーペースト', description: '詐欺コピペと装飾文字を抑えます。', icon: 'content_paste_off', fields: [
    { kind: 'number', key: 'minLength', label: '最小文字数', defaultValue: 80, min: 1 },
    { kind: 'list', key: 'suspiciousTerms', label: '疑わしい語句', wide: true, placeholder: 'free nitro' },
  ] },
  { key: 'everyoneMention', title: 'Everyoneメンション', description: '大量通知を防ぎます。', icon: 'alternate_email' },
  { key: 'duplicateMessage', title: '重複メッセージ', description: '同じ文面の連投を止めます。', icon: 'content_copy', fields: [
    { kind: 'number', key: 'windowSeconds', label: '監視秒数', defaultValue: 180, min: 1 },
    { kind: 'number', key: 'deleteFrom', label: '削除開始回数', defaultValue: 2, min: 1 },
    { kind: 'number', key: 'scoreFrom', label: 'スコア開始回数', defaultValue: 4, min: 1 },
  ] },
  { key: 'mentionSpam', title: 'メンションスパム', description: '連続メンション攻撃を止めます。', icon: 'record_voice_over', fields: [
    { kind: 'number', key: 'windowSeconds', label: '監視秒数', defaultValue: 30, min: 1 },
    { kind: 'number', key: 'sameUserMentionThreshold', label: '同一ユーザー上限', defaultValue: 5, min: 1 },
    { kind: 'number', key: 'roleMentionThreshold', label: 'ロール上限', defaultValue: 5, min: 1 },
    { kind: 'number', key: 'totalMentionThreshold', label: '合計上限', defaultValue: 10, min: 1 },
  ] },
  { key: 'mentionLimit', title: '最大メンション数', description: '大量メンションを制御します。', icon: 'groups', fields: [
    { kind: 'number', key: 'maxUserMentions', label: 'ユーザー上限', defaultValue: 200, min: 1 },
    { kind: 'number', key: 'maxRoleMentions', label: 'ロール上限', defaultValue: 200, min: 1 },
  ] },
  { key: 'maxLines', title: '最大行数', description: '長文スパムを行数で検知します。', icon: 'format_line_spacing', fields: [
    { kind: 'number', key: 'maxLines', label: '最大行数', defaultValue: 10, min: 1 },
  ] },
  { key: 'wordFilter', title: 'ワードフィルター', description: 'NGワードをルールごとに設定します。', icon: 'filter_alt' },
  { key: 'raidDetection', title: '自動アンチレイド', description: '参加急増時に保護を強化します。', icon: 'security', fields: [
    { kind: 'number', key: 'joinsPerHour', label: '1時間の参加数', defaultValue: 25, min: 1 },
    { kind: 'number', key: 'burstCount', label: '短時間参加数', defaultValue: 10, min: 1 },
    { kind: 'number', key: 'burstWindowSeconds', label: '監視秒数', defaultValue: 10, min: 1 },
    { kind: 'number', key: 'cooldownMinutes', label: '再発動待機(分)', defaultValue: 60, min: 1 },
  ] },
];

export const cloneSettings = (settings: AntiCheatSettings) => JSON.parse(JSON.stringify(settings)) as AntiCheatSettings;
export const parseListText = (value: string) => value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
export const toTextList = (value: unknown) => Array.isArray(value) ? value.join('\n') : '';
export const readNumber = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('ja-JP') : '未設定';
export const formatRemaining = (remainingMs: number) => {
  if (remainingMs <= 0) return 'まもなく終了';
  const seconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}時間 ${minutes}分`;
  if (minutes > 0) return `${minutes}分 ${seconds % 60}秒`;
  return `${seconds}秒`;
};
export const createWordFilterRule = (): WordFilterRule => ({
  id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  label: '', pattern: '', mode: 'contains', score: 1, deleteMessage: true, enabled: true,
});
