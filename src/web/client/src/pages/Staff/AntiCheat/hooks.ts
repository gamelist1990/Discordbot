import { useState, useEffect, useCallback } from 'react';
import { ActiveTimeoutEntry, AntiCheatSettings, DetectionLog, RestoreJobView, RestorePreviewView, SnapshotMetaView, UserTrustDataWithUser, PunishmentAction, WatchUserEntryView, WebAuthRecordView } from './types';

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
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.error || `Failed to update settings: ${response.statusText}`);
            }

            const data = await response.json();
            setSettings(data.settings);
            setError(null);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            return false;
        }
    }, [guildId]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    return { settings, loading, error, updateSettings, refetch: fetchSettings, clearError: () => setError(null) };
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

export function useActiveTimeouts(guildId: string) {    const [activeTimeouts, setActiveTimeouts] = useState<ActiveTimeoutEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchActiveTimeouts = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch(`${API_BASE}/${guildId}/active-timeouts`, {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch active timeouts: ${response.statusText}`);
            }

            const data = await response.json();
            setActiveTimeouts(data.activeTimeouts || []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [guildId]);

    useEffect(() => {
        fetchActiveTimeouts();
    }, [fetchActiveTimeouts]);

    return { activeTimeouts, loading, error, refetch: fetchActiveTimeouts };
}

/**
 * Hook for the 警戒ユーザー (watch tier) list
 */
export function useWatchUsers(guildId: string) {
    const [watchUsers, setWatchUsers] = useState<WatchUserEntryView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchWatchUsers = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch(`${API_BASE}/${guildId}/watch-users`, {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch watch users: ${response.statusText}`);
            }

            const data = await response.json();
            setWatchUsers(data.watchUsers || []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [guildId]);

    const dismiss = useCallback(async (userId: string) => {
        try {
            const response = await fetch(`${API_BASE}/${guildId}/watch-users/${encodeURIComponent(userId)}/dismiss`, {
                method: 'POST',
                credentials: 'include'
            });

            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.error || `Failed to dismiss watch user: ${response.statusText}`);
            }

            setError(null);
            await fetchWatchUsers();
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            return false;
        }
    }, [guildId, fetchWatchUsers]);

    useEffect(() => {
        fetchWatchUsers();
    }, [fetchWatchUsers]);

    return { watchUsers, loading, error, refetch: fetchWatchUsers, dismiss };
}

/**
 * Hook for the Web認証 (web fingerprint auth) record list
 */
export function useWebAuthRecords(guildId: string) {
    const [webAuthRecords, setWebAuthRecords] = useState<WebAuthRecordView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchRecords = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch(`${API_BASE}/${guildId}/webauth`, {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch WebAuth records: ${response.statusText}`);
            }

            const data = await response.json();
            setWebAuthRecords(data.records || []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [guildId]);

    const forceVerify = useCallback(async (userId: string, note: string) => {
        try {
            const response = await fetch(`${API_BASE}/${guildId}/webauth/force-verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ userId, note })
            });

            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.error || `Failed to force-verify: ${response.statusText}`);
            }

            setError(null);
            await fetchRecords();
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            return false;
        }
    }, [guildId, fetchRecords]);

    useEffect(() => {
        fetchRecords();
    }, [fetchRecords]);

    return { webAuthRecords, loading, error, refetch: fetchRecords, forceVerify };
}

const SNAPSHOT_API = '/api/staff/anticheat';

/**
 * AntiNuke snapshots + restore (AN2). Restores run as tracked background jobs,
 * so this polls the job record until it leaves `running`.
 */
export function useAntiNukeSnapshots(guildId: string) {
    const [snapshots, setSnapshots] = useState<SnapshotMetaView[]>([]);
    const [jobs, setJobs] = useState<RestoreJobView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [capturing, setCapturing] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [preview, setPreview] = useState<RestorePreviewView | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [activeJob, setActiveJob] = useState<RestoreJobView | null>(null);

    const refetch = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch(`${SNAPSHOT_API}/${guildId}/antinuke/snapshots`, {
                credentials: 'include'
            });
            if (!response.ok) throw new Error('スナップショット一覧を取得できませんでした。');
            const data = await response.json();
            setSnapshots(Array.isArray(data.snapshots) ? data.snapshots : []);
            setJobs(Array.isArray(data.restores) ? data.restores : []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'スナップショット一覧を取得できませんでした。');
        } finally {
            setLoading(false);
        }
    }, [guildId]);

    useEffect(() => {
        void refetch();
    }, [refetch]);

    const capture = useCallback(async () => {
        try {
            setCapturing(true);
            const response = await fetch(`${SNAPSHOT_API}/${guildId}/antinuke/snapshots`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'スナップショットを取得できませんでした。');
            setError(null);
            await refetch();
            return data.snapshot as SnapshotMetaView;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'スナップショットを取得できませんでした。');
            return null;
        } finally {
            setCapturing(false);
        }
    }, [guildId, refetch]);

    const loadPreview = useCallback(async (snapshotId: string, incidentIds: string[] = []) => {
        try {
            setPreviewLoading(true);
            const url = new URL(`${SNAPSHOT_API}/${guildId}/antinuke/restore/preview`, window.location.origin);
            url.searchParams.set('snapshotId', snapshotId);
            if (incidentIds.length) url.searchParams.set('incidentId', incidentIds.join(','));
            const response = await fetch(url.toString(), { credentials: 'include' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || '復元プレビューを取得できませんでした。');
            setPreview(data.preview as RestorePreviewView);
            setError(null);
            return data.preview as RestorePreviewView;
        } catch (err) {
            setError(err instanceof Error ? err.message : '復元プレビューを取得できませんでした。');
            return null;
        } finally {
            setPreviewLoading(false);
        }
    }, [guildId]);

    const clearPreview = useCallback(() => setPreview(null), []);

    const pollJob = useCallback(async (jobId: string): Promise<RestoreJobView | null> => {
        const response = await fetch(`${SNAPSHOT_API}/${guildId}/antinuke/restore/${jobId}`, {
            credentials: 'include'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '復元ジョブを取得できませんでした。');
        return data.job as RestoreJobView;
    }, [guildId]);

    const startRestore = useCallback(async (
        snapshotId: string,
        options: { unbanAdded: boolean; rebanSnapshotBans: boolean }
    ) => {
        try {
            setRestoring(true);
            const response = await fetch(`${SNAPSHOT_API}/${guildId}/antinuke/restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ snapshotId, confirm: 'RESTORE', ...options })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || '復元を開始できませんでした。');
            let job = data.job as RestoreJobView;
            setActiveJob(job);
            setError(null);
            for (let attempt = 0; attempt < 200 && job.status === 'running'; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
                const next = await pollJob(job.id).catch(() => null);
                if (!next) break;
                job = next;
                setActiveJob(job);
            }
            await refetch();
            return job;
        } catch (err) {
            setError(err instanceof Error ? err.message : '復元を開始できませんでした。');
            return null;
        } finally {
            setRestoring(false);
        }
    }, [guildId, pollJob, refetch]);

    return {
        snapshots,
        jobs,
        loading,
        error,
        capturing,
        restoring,
        preview,
        previewLoading,
        activeJob,
        refetch,
        capture,
        loadPreview,
        clearPreview,
        startRestore,
        clearError: () => setError(null),
    };
}
