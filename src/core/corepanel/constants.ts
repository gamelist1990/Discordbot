import { PersonalityArchetypeDefinition, PersonalityKey } from './types.js';

export const CORE_FEATURE_MODEL_FALLBACKS = [
    'claude-haiku-4-5-20251001',
    'claude-haiku-4-5-private1',
    'claude-haiku-4-5@20251001',
    'claude-haiku-4.5'
] as const;

export const PERSONALITY_CATEGORY_NAME = '性格診断室';
export const DEBATE_CATEGORY_NAME = 'レスバアリーナ';
export const DEBATE_KING_ROLE_NAME = '論破王';
export const PERSONALITY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const CLEANUP_DELAY_MS = 60 * 60 * 1000;
export const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
export const PERSONALITY_MIN_USER_TURNS = 4;
export const PERSONALITY_MAX_USER_TURNS = 6;
export const DEBATE_TURN_LIMIT = 3;
export const MAX_SESSION_HISTORY = 200;
export const MAX_TRANSCRIPT_ENTRIES = 80;
export const DEBATE_KING_SCORE_THRESHOLD = 100;
export const DEBATE_KING_WIN_THRESHOLD = 3;

export const PERSONALITY_ARCHETYPES: Record<PersonalityKey, PersonalityArchetypeDefinition> = {
    analyst: {
        label: '分析家',
        roleName: '性格:分析家',
        summary: '物事を分解して筋道を立てるタイプです。'
    },
    mediator: {
        label: '調停者',
        roleName: '性格:調停者',
        summary: '対立の温度を下げ、落としどころを探すタイプです。'
    },
    challenger: {
        label: '挑戦者',
        roleName: '性格:挑戦者',
        summary: '遠慮せず論点を突き、勝負どころで強いタイプです。'
    },
    executor: {
        label: '実行者',
        roleName: '性格:実行者',
        summary: '考えるだけで終わらせず、具体的に動かすタイプです。'
    },
    creator: {
        label: '創造者',
        roleName: '性格:創造者',
        summary: '発想の幅が広く、新しい切り口を出すタイプです。'
    },
    supporter: {
        label: '支援者',
        roleName: '性格:支援者',
        summary: '相手の状況を見て、助け方を選べるタイプです。'
    },
    chaotic: {
        label: '混沌家',
        roleName: '性格:混沌家',
        summary: '場の流れを一気にかき回し、予測不能な方向へ持っていくタイプです。'
    },
    eccentric: {
        label: '奇行家',
        roleName: '性格:奇行家',
        summary: '常識の外側にある発想や振る舞いが多く、独特な空気をまといやすいタイプです。'
    },
    impulsive: {
        label: '衝動家',
        roleName: '性格:衝動家',
        summary: '考える前に動きやすく、感情や直感が先に出やすいタイプです。'
    },
    fabulist: {
        label: '虚言家',
        roleName: '性格:虚言家',
        summary: '話を大きく盛ったり、都合のよい作り話で自分を強く見せやすいタイプです。'
    },
    performative: {
        label: '虚飾家',
        roleName: '性格:虚飾家',
        summary: '本音より見せ方を優先し、自分を大きく見せる方向に寄りやすいタイプです。'
    },
    provocateur: {
        label: '扇動家',
        roleName: '性格:扇動家',
        summary: '相手をわざと煽り、空気を動かして主導権を握ろうとするタイプです。'
    },
    volatile: {
        label: '暴走家',
        roleName: '性格:暴走家',
        summary: '熱が入ると急加速しやすく、勢いのまま周囲を置いていくタイプです。'
    }
};
