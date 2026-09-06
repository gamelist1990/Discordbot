import type { DetectorDefinition } from './viewTypes';
import type { AntiCheatSettings, WordFilterRule } from './types';

export const DETECTORS: DetectorDefinition[] = [
  { key: 'crossChannelSpam', title: 'チャンネル横断スパム', description: '同じユーザーによる複数チャンネルへの同文拡散・短時間の大量投稿を監視します。編集で同文に変える行為も対象です。', icon: 'dynamic_feed', fields: [
    { kind: 'number', key: 'windowSeconds', label: '同文拡散の監視秒数', defaultValue: 120, min: 1, max: 3600 },
    { kind: 'number', key: 'duplicateThreshold', label: '同文の検知開始件数', defaultValue: 2, min: 2, max: 100 },
    { kind: 'number', key: 'minChannels', label: '最小チャンネル数', defaultValue: 2, min: 2, max: 100 },
    { kind: 'number', key: 'rapidWindowSeconds', label: '大量投稿の監視秒数', defaultValue: 10, min: 1, max: 60 },
    { kind: 'number', key: 'rapidMessageCount', label: '大量投稿の検知開始件数', defaultValue: 6, min: 2, max: 100 },
  ] },
  { key: 'contentSafety', title: 'AIコンテンツフィルター', description: '画像・GIF・URL・本文のH系/R18、暴言などを検査します。検知後はネタバレ代理投稿または削除を選べます。全体の自動削除設定とは独立し、スコア加算は初期OFFで、有効時はAIが設定上限以内で妥当な加算点（0点を含む）と理由を提案します。誤検知・見逃しがあり、障害時は元投稿を残し、違反の検知通知は送りません。', icon: 'shield', fields: [
    { kind: 'toggle', key: 'awardScore', label: 'AI判定に応じてスコア加算（既存の自動処罰にも反映）', defaultValue: 0 },
    { kind: 'number', key: 'maxAiScore', label: 'AIが提案する加算点の上限', defaultValue: 10, min: 1, max: 100 },
    { kind: 'toggle', key: 'scanImages', label: '画像・GIFを検査', defaultValue: 1 },
    { kind: 'toggle', key: 'similarCache', label: '類似投稿の検知済み結果を再利用（ネタバレ・加算OFF時）', defaultValue: 1 },
    { kind: 'number', key: 'similarityThreshold', label: '類似度しきい値（0.9＝90%）', defaultValue: 0.9, min: 0.9, max: 1, step: 0.01 },
    { kind: 'number', key: 'cacheTtlMinutes', label: '判定キャッシュの保持時間（90日固定）', defaultValue: 129600, min: 129600, max: 129600 },
    { kind: 'toggle', key: 'scanText', label: '文章を検査', defaultValue: 1 },
    { kind: 'toggle', key: 'scanUrls', label: 'URL・リンク先のプレビュー画像を検査', defaultValue: 1 },
    { kind: 'toggle', key: 'suggestive', label: '軽度の性的表現・H系', defaultValue: 1 },
    { kind: 'toggle', key: 'explicit', label: '強度の性的表現・R18', defaultValue: 1 },
    { kind: 'toggle', key: 'harassment', label: '暴言・嫌がらせ', defaultValue: 1 },
    { kind: 'toggle', key: 'hate', label: '差別・憎悪', defaultValue: 1 },
    { kind: 'toggle', key: 'threat', label: '脅迫', defaultValue: 1 },
    { kind: 'toggle', key: 'violence', label: '残虐・暴力表現', defaultValue: 1 },
    { kind: 'number', key: 'imageThreshold', label: '画像の表現強度しきい値（低いほど厳格）', defaultValue: 0.7, min: 0.1, max: 1, step: 0.05 },
    { kind: 'number', key: 'textThreshold', label: '文章の表現強度しきい値（低いほど厳格）', defaultValue: 0.8, min: 0.1, max: 1, step: 0.05 },
    { kind: 'number', key: 'imageSuggestiveThreshold', label: '軽度H画像の強度しきい値', defaultValue: 0.65, min: 0.1, max: 1, step: 0.05 },
    { kind: 'number', key: 'textSuggestiveThreshold', label: '軽度H文章の強度しきい値', defaultValue: 0.7, min: 0.1, max: 1, step: 0.05 },
    { kind: 'number', key: 'maxSampleFrames', label: 'GIF・WebPの抽出枚数（初期6枚・等間隔）', defaultValue: 6, min: 1, max: 12 },
    { kind: 'number', key: 'maxImages', label: '1投稿の画像取得上限', defaultValue: 4, min: 1, max: 10 },
    { kind: 'number', key: 'maxFileSizeMb', label: '画像1件の取得上限(MB)', defaultValue: 8, min: 1, max: 10 },
    { kind: 'number', key: 'timeoutMs', label: 'AI応答の待機上限(ms)', defaultValue: 120000, min: 5000, max: 180000, step: 1000 },
  ] },
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
  { key: 'gifFlash', title: '点滅GIF保護', description: '強い明暗変化を繰り返すGIFを容量制限なしで検査します。削除は自動削除設定に従います。', icon: 'visibility_off', fields: [
    { kind: 'number', key: 'timeoutMs', label: '取得待機時間(ms)', defaultValue: 3000, min: 500, step: 500 },
    { kind: 'number', key: 'maxSampleFrames', label: '解析フレーム数', defaultValue: 12, min: 2, max: 20 },
    { kind: 'number', key: 'luminanceDeltaThreshold', label: '明暗差しきい値', defaultValue: 80, min: 20, max: 255 },
    { kind: 'number', key: 'minimumTransitions', label: '危険な変化回数', defaultValue: 2, min: 1 },
  ] },
  { key: 'duplicateImage', title: '重複画像', description: '同一画像と軽微に加工された酷似画像の連投を止めます。', icon: 'image_not_supported', fields: [
    { kind: 'number', key: 'windowSeconds', label: '監視秒数', defaultValue: 300, min: 1 },
    { kind: 'number', key: 'deleteFrom', label: '削除開始回数', defaultValue: 2, min: 2 },
    { kind: 'number', key: 'scoreFrom', label: 'スコア開始回数', defaultValue: 3, min: 2 },
    { kind: 'number', key: 'perceptualDistance', label: '類似許容値', defaultValue: 5, min: 0, max: 16 },
    { kind: 'number', key: 'maxFileSizeMb', label: '解析上限(MB)', defaultValue: 8, min: 1, max: 25 },
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
