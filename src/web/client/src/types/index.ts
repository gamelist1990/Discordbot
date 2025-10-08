export interface Role {
  id: string;
  name: string;
  color: number;
  position: number;
}

export interface GuildInfo {
  id: string;
  name: string;
  iconURL: string | null;
  roles: Role[];
}

export interface GuildSettings {
  guildId: string;
  staffRoleId?: string;
  adminRoleId?: string;
  updatedAt: number;
}

export interface ValidationResponse {
  valid: boolean;
  guildId?: string;
  userId?: string;
  error?: string;
}

export interface SaveResponse {
  success: boolean;
  error?: string;
}

export interface BotStatusResponse {
  startTime: number;
  lastUpdate: number;
  guildCount: number;
  maxGuilds: number;
  uptime: number;
}

export * from './permission.ts';
