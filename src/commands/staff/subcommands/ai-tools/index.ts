// src/commands/staff/subcommands/ai-tools/index.ts
/**
 * AI ツール定義のインデックス
 * 新しいツールを追加する場合はここにエクスポートを追加してください
 */

export { statusToolDefinition, statusToolHandler } from './status';
export { weatherToolDefinition, weatherToolHandler } from './weather';
export { timeToolDefinition, timeToolHandler } from './time';
export { countPhraseToolDefinition, countPhraseToolHandler } from './count_phrase';
export { userInfoToolDefinition, userInfoToolHandler } from './user_info';

