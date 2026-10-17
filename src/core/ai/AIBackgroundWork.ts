export type AIBackgroundTask = (signal: AbortSignal) => Promise<void>;
export type AIRequestPriority = 'foreground' | 'background';

type QueuedTask = {
    key: string;
    run: AIBackgroundTask;
    controller: AbortController | null;
    rerunAfterCurrent: boolean;
    failures: number;
    waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
};

const IDLE_DELAY_MS = 20_000;
const MAX_FAILURE_RETRIES = 3;
const pendingTasks: QueuedTask[] = [];
const tasksByKey = new Map<string, QueuedTask>();
let activeTask: QueuedTask | null = null;
let activeForegroundRequests = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function clearIdleTimer(): void {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
}

function scheduleNext(delayMs = IDLE_DELAY_MS): void {
    if (activeForegroundRequests > 0 || activeTask || pendingTasks.length === 0 || idleTimer) return;
    idleTimer = setTimeout(() => {
        idleTimer = null;
        void runNextTask();
    }, delayMs);
    idleTimer.unref?.();
}

function settleTask(task: QueuedTask, error?: unknown): void {
    tasksByKey.delete(task.key);
    for (const waiter of task.waiters.splice(0)) {
        if (error === undefined) waiter.resolve();
        else waiter.reject(error);
    }
}

async function runNextTask(): Promise<void> {
    if (activeForegroundRequests > 0 || activeTask) return;
    const task = pendingTasks.shift();
    if (!task) return;

    activeTask = task;
    const controller = new AbortController();
    task.controller = controller;
    let retryDelay = IDLE_DELAY_MS;
    try {
        await task.run(controller.signal);
        if (controller.signal.aborted) {
            task.rerunAfterCurrent = false;
            pendingTasks.unshift(task);
        } else if (task.rerunAfterCurrent) {
            task.rerunAfterCurrent = false;
            task.failures = 0;
            pendingTasks.push(task);
        } else {
            settleTask(task);
        }
    } catch (error) {
        if (controller.signal.aborted) {
            task.rerunAfterCurrent = false;
            pendingTasks.unshift(task);
        } else if (task.failures < MAX_FAILURE_RETRIES) {
            task.rerunAfterCurrent = false;
            task.failures += 1;
            pendingTasks.push(task);
            retryDelay = Math.min(60_000, IDLE_DELAY_MS * (task.failures + 1));
            console.warn(`[AIBackgroundWork] background task failed; retry ${task.failures}/${MAX_FAILURE_RETRIES}: ${task.key}`, error);
        } else {
            console.warn(`[AIBackgroundWork] background task exhausted retries: ${task.key}`, error);
            settleTask(task, error);
        }
    } finally {
        task.controller = null;
        activeTask = null;
        scheduleNext(retryDelay);
    }
}

/** Queue low-priority work and run it only after the AI has been idle for a while. */
export function queueAIBackgroundWork(key: string, run: AIBackgroundTask): Promise<void> {
    const existing = tasksByKey.get(key);
    if (existing) {
        existing.run = run;
        if (existing === activeTask) existing.rerunAfterCurrent = true;
        const promise = new Promise<void>((resolve, reject) => existing.waiters.push({ resolve, reject }));
        return promise;
    }

    const task: QueuedTask = {
        key,
        run,
        controller: null,
        rerunAfterCurrent: false,
        failures: 0,
        waiters: [],
    };
    const promise = new Promise<void>((resolve, reject) => task.waiters.push({ resolve, reject }));
    tasksByKey.set(key, task);
    pendingTasks.push(task);
    scheduleNext();
    return promise;
}

/** Reserve foreground priority while a channel request is being prepared or answered. */
export function beginAIRequestPriority(): () => void {
    activeForegroundRequests += 1;
    clearIdleTimer();
    activeTask?.controller?.abort(new Error('A foreground AI request took priority over background work.'));
    let released = false;
    return () => {
        if (released) return;
        released = true;
        activeForegroundRequests = Math.max(0, activeForegroundRequests - 1);
        scheduleNext();
    };
}

/** Foreground model requests preempt in-flight background memory generation. */
export async function runAIRequestWithPriority<T>(
    priority: AIRequestPriority | undefined,
    run: () => Promise<T>,
): Promise<T> {
    if (priority === 'background') return run();

    const releasePriority = beginAIRequestPriority();
    try {
        return await run();
    } finally {
        releasePriority();
    }
}
