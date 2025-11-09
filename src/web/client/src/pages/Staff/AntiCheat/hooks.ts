import { useState, useEffect, useCallback } from 'react';
import { AntiCheatSettings, DetectionLog, UserTrustDataWithUser, PunishmentAction } from './types';

const API_BASE = '/api/staff/anticheat';

/**
 * Hook for managing AntiCheat settings
 */
export function useAntiCheatSettings(guildId: string) {
    const [settings, setSettings] = useState<AntiCheatSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSettings = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch(`${API_BASE}/${guildId}/settings`, {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch settings: ${response.statusText}`);
            }

            const data = await response.json();
            setSettings(data.settings);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [guildId]);

    const updateSettings = useCallback(async (updates: Partial<AntiCheatSettings>) => {
        try {
            const response = await fetch(`${API_BASE}/${guildId}/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(updates)
            });

            if (!response.ok) {
                throw new Error(`Failed to update settings: ${response.statusText}`);
            }

            const data = await response.json();
            setSettings(data.settings);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            return false;
        }
    }, [guildId]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    return { settings, loading, error, updateSettings, refetch: fetchSettings };
}

/**
 * Hook for managing detection logs
 */
export function useDetectionLogs(guildId: string, limit = 50) {
    const [logs, setLogs] = useState<DetectionLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchLogs = useCallback(async (before?: string) => {
        try {
            setLoading(true);
            const url = new URL(`${API_BASE}/${guildId}/logs`, window.location.origin);
            url.searchParams.set('limit', limit.toString());
            if (before) url.searchParams.set('before', before);

            const response = await fetch(url.toString(), {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch logs: ${response.statusText}`);
            }

            const data = await response.json();
            setLogs(data.logs || []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [guildId, limit]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    return { logs, loading, error, refetch: fetchLogs };
}

/**
 * Hook for executing punishment actions
 */
export function useAntiCheatActions(guildId: string) {
    const [executing, setExecuting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const executeAction = useCallback(async (userId: string, action: PunishmentAction) => {
        try {
            setExecuting(true);
            const response = await fetch(`${API_BASE}/${guildId}/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ userId, action })
            });

            if (!response.ok) {
                throw new Error(`Failed to execute action: ${response.statusText}`);
            }

            setError(null);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            return false;
        } finally {
            setExecuting(false);
        }
    }, [guildId]);

    const revokeTimeout = useCallback(async (userId: string, resetTrust = false, messageId?: string) => {
        try {
            setExecuting(true);
            const response = await fetch(`${API_BASE}/${guildId}/revoke`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ userId, resetTrust, messageId })
            });

            if (!response.ok) {
                throw new Error(`Failed to revoke timeout: ${response.statusText}`);
            }

            setError(null);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            return false;
        } finally {
            setExecuting(false);
        }
    }, [guildId]);

    const resetTrust = useCallback(async (userId: string) => {
        try {
            setExecuting(true);
            const response = await fetch(`${API_BASE}/${guildId}/reset-trust`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ userId })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Failed to reset trust: ${response.statusText}`);
            }

            setError(null);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            return false;
        } finally {
            setExecuting(false);
        }
    }, [guildId]);

    return { executeAction, revokeTimeout, resetTrust, executing, error };
}

/**
 * Hook for managing user trust data
 */
export function useUserTrust(guildId: string, userId?: string) {
    const [trust, setTrust] = useState<Record<string, UserTrustDataWithUser> | UserTrustDataWithUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchTrust = useCallback(async () => {
        try {
            setLoading(true);
            const url = new URL(`${API_BASE}/${guildId}/trust`, window.location.origin);
            if (userId) url.searchParams.set('userId', userId);

            const response = await fetch(url.toString(), {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch trust data: ${response.statusText}`);
            }

            const data = await response.json();
            setTrust(userId ? data.trust : data.userTrust);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [guildId, userId]);

    useEffect(() => {
        fetchTrust();
    }, [fetchTrust]);

    return { trust, loading, error, refetch: fetchTrust };
}
