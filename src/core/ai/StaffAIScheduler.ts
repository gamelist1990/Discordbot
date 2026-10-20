import { randomUUID } from 'node:crypto';
import type { Client } from 'discord.js';
import { database } from '../persistence/Database.js';
import { staffScheduleChannelError } from './StaffAIScheduleChannel.js';

export type StaffAISchedule = {
    id: string; guildId: string; channelId: string; userId: string;
    message: string; runAt: string; createdAt: string;
    mode?: 'reminder' | 'task'; task?: string; result?: string;
    status: 'pending' | 'sent' | 'failed'; attempts: number;
    nextAttemptAt?: string; sentAt?: string;
};
const key = (guildId: string) => `Guild/${guildId}/staff-ai-schedules`;
const locks = new Map<string, Promise<void>>();
const inFlight = new Set<string>();

export type ScheduledTaskRunner = (schedule: StaffAISchedule, now: number) => Promise<string>;
const defaultTaskRunner: ScheduledTaskRunner = async (schedule, now) => {
    const { executeStaffScheduledTask } = await import('./StaffAIScheduledTask.js');
    return executeStaffScheduledTask(schedule, now);
};

// Serialize tool calls and delivery, including read/modify/write across awaits.
export async function withStaffScheduleLock<T>(guildId: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(guildId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    locks.set(guildId, tail);
    await previous;
    try { return await action(); }
    finally {
        release();
        if (locks.get(guildId) === tail) locks.delete(guildId);
    }
}

export async function loadStaffSchedules(guildId: string): Promise<StaffAISchedule[]> {
    // Database caches object references: never mutate the cached value before a successful write.
    return structuredClone(await database.get<StaffAISchedule[]>(guildId, key(guildId), []) ?? []);
}

export async function saveStaffSchedules(guildId: string, schedules: StaffAISchedule[]): Promise<void> {
    const pending = schedules.filter(item => item.status === 'pending');
    const history = schedules.filter(item => item.status !== 'pending').slice(-200);
    await database.set(guildId, key(guildId), [...history, ...pending]);
}

export function newStaffSchedule(scope: { guildId: string; channelId: string; userId: string },
    message: string, runAt: string): StaffAISchedule {
    return { ...scope, id: randomUUID().replaceAll('-', '').slice(0, 25), message, runAt,
        createdAt: new Date().toISOString(), status: 'pending', attempts: 0 };
}

/** Runs once on startup, then every five seconds. Overdue reminders survive restarts. */
export async function deliverDueStaffSchedules(client: Client, now = Date.now(), runTask = defaultTaskRunner): Promise<void> {
    for (const guildId of client.guilds.cache.keys()) {
        try {
            const due = await withStaffScheduleLock(guildId, () => loadStaffSchedules(guildId));
            for (const schedule of due) {
                if (schedule.status !== 'pending' || Date.parse(schedule.runAt) > now
                    || Date.parse(schedule.nextAttemptAt ?? schedule.runAt) > now) continue;
                const flightKey = `${guildId}/${schedule.id}`;
                if (inFlight.has(flightKey)) continue;
                inFlight.add(flightKey);
                try {
                    const latest = await withStaffScheduleLock(guildId, async () =>
                        (await loadStaffSchedules(guildId)).find(item => item.id === schedule.id && item.status === 'pending'));
                    if (!latest || Date.parse(latest.nextAttemptAt ?? latest.runAt) > now) continue;
                    Object.assign(schedule, latest);
                    const channel = await client.channels.fetch(schedule.channelId);
                    const channelError = await staffScheduleChannelError(channel, guildId, schedule.userId);
                    if (channelError) throw new Error(channelError);
                    if (!channel || !('guildId' in channel) || channel.guildId !== guildId || !channel.isSendable()) {
                        throw new Error('通知先のチャンネルに送信できません');
                    }
                    if (schedule.mode === 'task' && !schedule.result) {
                        // Do not hold the guild lock during inference: users can list/cancel meanwhile.
                        const result = (await runTask(schedule, Math.max(now, Date.now()))).trim();
                        if (!result) throw new Error('予約したAI処理の結果が空です');
                        await withStaffScheduleLock(guildId, async () => {
                            const schedules = await loadStaffSchedules(guildId);
                            const target = schedules.find(item => item.id === schedule.id && item.status === 'pending');
                            if (!target) return;
                            target.result = result;
                            await saveStaffSchedules(guildId, schedules);
                        });
                    }
                    await withStaffScheduleLock(guildId, async () => {
                        const schedules = await loadStaffSchedules(guildId);
                        const target = schedules.find(item => item.id === schedule.id && item.status === 'pending');
                        if (!target) return; // Cancelled while AI was working.
                        const permissionError = await staffScheduleChannelError(channel, guildId, target.userId);
                        if (permissionError) throw new Error(permissionError);
                        const text = `<@${target.userId}> ⏰ ${target.result ?? target.message}`;
                        await channel.send({
                            content: text.length <= 2000 ? text : `<@${target.userId}> ⏰ 予約した処理が完了しました。結果を添付します。`,
                            ...(text.length > 2000 ? { files: [{ attachment: Buffer.from(target.result ?? target.message, 'utf8'), name: 'scheduled-result.txt' }] } : {}),
                            allowedMentions: { parse: [], users: [schedule.userId], repliedUser: false },
                            // Discord deduplicates recent retries after an uncertain send result.
                            nonce: schedule.id, enforceNonce: true,
                        });
                        target.status = 'sent';
                        target.sentAt = new Date().toISOString();
                        delete target.nextAttemptAt;
                        await saveStaffSchedules(guildId, schedules);
                    });
                } catch (error) {
                    await withStaffScheduleLock(guildId, async () => {
                        const schedules = await loadStaffSchedules(guildId);
                        const target = schedules.find(item => item.id === schedule.id && item.status === 'pending');
                        if (!target) return;
                        target.attempts++;
                        target.nextAttemptAt = new Date(Math.max(now, Date.now()) + 60_000 * 2 ** (target.attempts - 1)).toISOString();
                        if (target.attempts >= 5) target.status = 'failed';
                        await saveStaffSchedules(guildId, schedules);
                    });
                    console.error(`[StaffAI schedule] delivery failed (${schedule.id}):`, error);
                } finally {
                    inFlight.delete(flightKey);
                }
            }
        } catch (error) {
            console.error(`[StaffAI schedule] guild processing failed (${guildId}):`, error);
        }
    }
}

export function startStaffAIScheduler(client: Client): () => Promise<void> {
    let running: Promise<void> | undefined;
    const tick = () => {
        if (!running) running = deliverDueStaffSchedules(client).finally(() => { running = undefined; });
    };
    const timer = setInterval(tick, 5_000);
    timer.unref();
    tick();
    return async () => { clearInterval(timer); await running; };
}
