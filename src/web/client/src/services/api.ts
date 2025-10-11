import type { ValidationResponse, GuildInfo, GuildSettings, SaveResponse, BotStatusResponse } from '../types';

const API_BASE = '/api';

/**
 * API エラーハンドリング用カスタムエラークラス
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * API リクエストの共通処理
 */
async function apiRequest<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        errorData.error || `Request failed with status ${response.status}`,
        response.status,
        errorData
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      error instanceof Error ? error.message : 'Network error',
      0
    );
  }
}

/**
 * Bot ステータスの取得
 */
export async function fetchBotStatus(): Promise<BotStatusResponse> {
  return apiRequest<BotStatusResponse>(`${API_BASE}/status`);
}

/**
 * トークンの検証
 */
export async function validateToken(token: string): Promise<ValidationResponse> {
  return apiRequest<ValidationResponse>(`${API_BASE}/validate/${token}`);
}

/**
 * ギルド情報の取得
 */
export async function fetchGuildInfo(token: string): Promise<GuildInfo> {
  return apiRequest<GuildInfo>(`${API_BASE}/guild/${token}`);
}

/**
 * 設定の取得
 */
export async function fetchSettings(token: string): Promise<GuildSettings> {
  return apiRequest<GuildSettings>(`${API_BASE}/settings/${token}`);
}

/**
 * 設定の保存
 */
export async function saveSettings(token: string, settings: GuildSettings): Promise<SaveResponse> {
  return apiRequest<SaveResponse>(`${API_BASE}/settings/${token}`, {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

/**
 * プライベートチャット関連の型定義
 */
export interface PrivateChat {
  chatId: string;
  channelId: string;
  vcId?: string;
  userId: string;
  roomName?: string;
  staffId: string;
  userName: string;
  staffName: string;
  channelExists: boolean;
  createdAt: number;
}

export interface PrivateChatStats {
  total: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
}

export interface PrivateChatsResponse {
  chats: PrivateChat[];
}

/**
 * プライベートチャット一覧の取得
 */
export async function fetchPrivateChats(guildId?: string): Promise<PrivateChatsResponse> {
  const url = guildId ? `${API_BASE}/staff/privatechats?guildId=${encodeURIComponent(guildId)}` : `${API_BASE}/staff/privatechats`;
  return apiRequest<PrivateChatsResponse>(url);
}

/**
 * プライベートチャットの作成
 */
// createPrivateChat supports two payload shapes:
//  - { userId }
//  - { roomName, members?: string[] }
export async function createPrivateChat(payload: string | { roomName: string; members?: string[] }, guildId?: string ): Promise<{ success: boolean; chat: PrivateChat }> {
  const body = typeof payload === 'string' ? { userId: payload } : payload;
  const url = guildId ? `${API_BASE}/staff/privatechats?guildId=${encodeURIComponent(guildId)}` : `${API_BASE}/staff/privatechats`;
  return apiRequest(`${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * プライベートチャットの削除
 */
export async function deletePrivateChat(chatId: string, guildId?: string): Promise<{ success: boolean }> {
  const url = guildId ? `${API_BASE}/staff/privatechats/${chatId}?guildId=${encodeURIComponent(guildId)}` : `${API_BASE}/staff/privatechats/${chatId}`;
  return apiRequest(`${url}`, {
    method: 'DELETE',
  });
}

/**
 * プライベートチャット統計の取得
 */
export async function fetchPrivateChatStats(guildId?: string): Promise<PrivateChatStats> {
  const url = guildId ? `${API_BASE}/staff/stats?guildId=${encodeURIComponent(guildId)}` : `${API_BASE}/staff/stats`;
  return apiRequest<PrivateChatStats>(url);
}

/**
 * チャットメンバー情報
 */
export interface ChatMember {
  id: string;
  username: string;
  avatar: string | null;
}

export interface ChatMembersResponse {
  members: ChatMember[];
}

/**
 * チャットのメンバーリストを取得
 */
export async function fetchChatMembers(chatId: string, guildId?: string): Promise<ChatMembersResponse> {
  const url = guildId ? `${API_BASE}/staff/privatechats/${chatId}/members?guildId=${encodeURIComponent(guildId)}` : `${API_BASE}/staff/privatechats/${chatId}/members`;
  return apiRequest<ChatMembersResponse>(url);
}

/**
 * チャットにメンバーを追加
 */
export async function addChatMember(chatId: string, userName: string, guildId?: string): Promise<{ success: boolean }> {
  const url = guildId ? `${API_BASE}/staff/privatechats/${chatId}/members?guildId=${encodeURIComponent(guildId)}` : `${API_BASE}/staff/privatechats/${chatId}/members`;
  return apiRequest(`${url}`, {
    method: 'POST',
    body: JSON.stringify({ userName }),
  });
}

/**
 * チャットからメンバーを削除
 */
export async function removeChatMember(chatId: string, userId: string, guildId?: string): Promise<{ success: boolean }> {
  const url = guildId ? `${API_BASE}/staff/privatechats/${chatId}/members/${userId}?guildId=${encodeURIComponent(guildId)}` : `${API_BASE}/staff/privatechats/${chatId}/members/${userId}`;
  return apiRequest(`${url}`, {
    method: 'DELETE',
  });
}

/**
 * ユーザー検索
 */
export async function searchUsers(query: string, chatId?: string, guildId?: string): Promise<{ users: Array<{ id: string; username: string; displayName: string | null; avatar: string | null }> }> {
  let url = `${API_BASE}/staff/searchusers?query=${encodeURIComponent(query)}`;
  if (chatId) url += `&chatId=${encodeURIComponent(chatId)}`;
  if (guildId) url += `&guildId=${encodeURIComponent(guildId)}`;
  return apiRequest(url);
}

/**
 * スタッフコマンド情報の型定義
 */
export interface CommandOption {
  name: string;
  description: string;
  type: string;
  required: boolean;
  choices: Array<{ name: string; value: string | number }>;
}

export interface StaffSubcommand {
  name: string;
  description: string;
  options: CommandOption[];
}

export interface StaffCommandData {
  name: string;
  description: string;
  subcommands: StaffSubcommand[];
}

/**
 * スタッフコマンド情報の取得
 */
export async function fetchStaffCommands(): Promise<StaffCommandData> {
  return apiRequest<StaffCommandData>(`${API_BASE}/staff/commands`);
}
