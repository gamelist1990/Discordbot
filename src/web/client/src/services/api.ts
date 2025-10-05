import type { ValidationResponse, GuildInfo, GuildSettings, SaveResponse, BotStatusResponse } from '../types';

const API_BASE = '/api';

/**
 * Bot ステータスの取得
 */
export async function fetchBotStatus(): Promise<BotStatusResponse> {
  const response = await fetch(`${API_BASE}/status`);
  if (!response.ok) {
    throw new Error('Failed to fetch bot status');
  }
  return response.json();
}

/**
 * トークンの検証
 */
export async function validateToken(token: string): Promise<ValidationResponse> {
  const response = await fetch(`${API_BASE}/validate/${token}`);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Validation failed');
  }
  return response.json();
}

/**
 * ギルド情報の取得
 */
export async function fetchGuildInfo(token: string): Promise<GuildInfo> {
  const response = await fetch(`${API_BASE}/guild/${token}`);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to fetch guild info');
  }
  return response.json();
}

/**
 * 設定の取得
 */
export async function fetchSettings(token: string): Promise<GuildSettings> {
  const response = await fetch(`${API_BASE}/settings/${token}`);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to fetch settings');
  }
  return response.json();
}

/**
 * 設定の保存
 */
export async function saveSettings(token: string, settings: GuildSettings): Promise<SaveResponse> {
  const response = await fetch(`${API_BASE}/settings/${token}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to save settings');
  }

  return response.json();
}
