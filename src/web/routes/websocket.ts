import { Server as HTTPServer } from 'http';
import { unifiedWsManager } from '../services/UnifiedWebSocketManager.js';
import { SettingsSession } from '../types/index.js';

export function setupWebSocketServer(
  server: HTTPServer,
  sessions: Map<string, SettingsSession>
): void {
  unifiedWsManager.initialize(server, sessions);
  unifiedWsManager.startHeartbeat(30000);
  console.log('[WebSocket] Unified WebSocket server initialized');
}
