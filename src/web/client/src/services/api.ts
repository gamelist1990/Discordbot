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
export async function fetchPrivateChats(token: string): Promise<PrivateChatsResponse> {
  return apiRequest<PrivateChatsResponse>(`${API_BASE}/staff/privatechats/${token}`);
}

/**
 * プライベートチャットの作成
 */
// createPrivateChat supports two payload shapes:
//  - { userId }
//  - { roomName, members?: string[] }
export async function createPrivateChat(token: string, payload: string | { roomName: string; members?: string[] } ): Promise<{ success: boolean; chat: PrivateChat }> {
  const body = typeof payload === 'string' ? { userId: payload } : payload;
  return apiRequest(`${API_BASE}/staff/privatechats/${token}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * プライベートチャットの削除
 */
export async function deletePrivateChat(token: string, chatId: string): Promise<{ success: boolean }> {
  return apiRequest(`${API_BASE}/staff/privatechats/${token}/${chatId}`, {
    method: 'DELETE',
  });
}

/**
 * プライベートチャット統計の取得
 */
export async function fetchPrivateChatStats(token: string): Promise<PrivateChatStats> {
  return apiRequest<PrivateChatStats>(`${API_BASE}/staff/stats/${token}`);
}

