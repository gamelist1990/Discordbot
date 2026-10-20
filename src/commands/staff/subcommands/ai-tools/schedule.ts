import type { ChatInputCommandInteraction } from 'discord.js';
import type { OpenAITool, ToolHandler } from '../../../../types/openai.js';
import { loadStaffSchedules, saveStaffSchedules, newStaffSchedule, withStaffScheduleLock } from '../../../../core/ai/StaffAIScheduler.js';

export const staffScheduleDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'manage_schedule',
        description: '一回限りの通知またはAIの動作を予約(create)、一覧確認(list)、取消(cancel)する。mode=reminderは指定本文の通知、mode=taskは指定時刻にAIがtaskを実行し結果を元のチャンネルで本人にメンション通知する。taskで使える動作はWeb検索・公開ページ取得・天気確認・文章作成や要約。予約時には調査を先に実行せず、対象や条件を自己完結したtaskに保存する。予約・取消は本人の依頼時だけ。日時はシステムメッセージの現在日時を基準に解釈し、再確認時はget_timeを使う。標準は日本時間。曖昧な時刻は確認、過去時刻を翌日に変更しない。保存成功後だけ予約済みと伝える。',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'list', 'cancel'] },
                mode: { type: 'string', enum: ['reminder', 'task'], description: 'create時の動作。通知だけならreminder（既定）、指定時刻に調査・作成するならtask。' },
                task: { type: 'string', description: 'mode=task時に必須。実行する依頼文（1〜4000文字）。対象、地域、URL、条件などを含める。例: 東京の実行時点の天気予報を調べ、出典付きで教えて。' },
                run_at: { type: 'string', description: 'create時の未来の日時。タイムゾーン必須のISO 8601。例: 2026-10-20T15:00:00+09:00' },
                message: { type: 'string', description: '通知本文（1〜1500文字）。reminder時は必須。task時は省略可の見出し。例: 起きる時間です！' },
                id: { type: 'string', description: 'cancel時の予約ID。list結果から取得する。' },
            },
            required: ['action'], additionalProperties: false,
        },
    },
};

/** Strict ISO parsing: reject missing offsets and normalized invalid calendar dates. */
export function parseScheduleTime(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return null;
    const [, year, month, day, hour, minute, second, offset] = match;
    const time = Date.parse(value);
    const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    if (!Number.isFinite(time) || Number(month) < 1 || Number(month) > 12 || Number(day) < 1
        || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59
        || (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))) return null;
    return time;
}

export const staffScheduleHandler: ToolHandler = async (args: Record<string, unknown>, context?: unknown) => {
    const interaction = context as ChatInputCommandInteraction | undefined;
    if (!interaction?.guildId || !interaction.channelId || !interaction.user?.id) {
        return { error: 'スケジュールはサーバー内でのみ利用できます' };
    }
    const scope = { guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user.id };
    try {
        return await withStaffScheduleLock(scope.guildId, async () => {
            const schedules = await loadStaffSchedules(scope.guildId);
            const own = schedules.filter(item => item.userId === scope.userId);
            if (args.action === 'list') {
                return { timezone: 'Asia/Tokyo', schedules: own.filter(item => item.status !== 'sent')
                    .sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt)) };
            }
            if (args.action === 'cancel') {
                const target = own.find(item => item.id === args.id && item.status !== 'sent');
                if (!target) return { error: '本人の未送信の予約が見つかりません。listでIDを確認してください' };
                await saveStaffSchedules(scope.guildId, schedules.filter(item => item.id !== target.id));
                return { success: true, cancelledId: target.id };
            }
            if (args.action !== 'create') return { error: 'actionはcreate/list/cancelを指定してください' };
            const time = parseScheduleTime(args.run_at);
            if (time === null) return { error: 'run_atにタイムゾーン付きの有効なISO 8601日時を指定してください' };
            if (time <= Date.now()) return { error: '指定時刻は既に過ぎています。未来の日時を本人に確認してください' };
            const mode = args.mode ?? (typeof args.task === 'string' && args.task.trim() ? 'task' : 'reminder');
            if (mode !== 'task' && mode !== 'reminder') return { error: 'modeはreminder/taskを指定してください' };
            const task = typeof args.task === 'string' ? args.task.trim() : '';
            if (mode === 'task' && (!task || task.length > 4000)) return { error: '実行する依頼文taskは1〜4000文字で指定してください' };
            if (mode === 'reminder' && task) return { error: '動作を実行する場合はmode=taskを指定してください' };
            const message = typeof args.message === 'string' ? args.message.trim() : mode === 'task' ? task.slice(0, 1500) : '';
            if (!message || message.length > 1500) return { error: '通知本文は1〜1500文字で指定してください' };
            const runAt = new Date(time).toISOString();
            const duplicate = own.find(item => item.status === 'pending' && item.runAt === runAt
                && item.message === message && item.channelId === scope.channelId
                && (item.mode ?? 'reminder') === mode && (item.task ?? '') === task);
            if (duplicate) return { success: true, schedule: duplicate, alreadyExists: true };
            if (own.filter(item => item.status === 'pending').length >= 50) return { error: '予約は一人50件までです' };
            const channel = await interaction.client.channels.fetch(scope.channelId);
            const bot = interaction.guild?.members.me;
            if (!channel || !channel.isSendable() || !bot || !('permissionsFor' in channel)) {
                return { error: 'このチャンネルには通知を送信できません' };
            }
            const permissions = channel.permissionsFor(bot);
            if (!permissions?.has('ViewChannel') || !permissions.has(channel.isThread() ? 'SendMessagesInThreads' : 'SendMessages')) {
                return { error: 'Botにこのチャンネルの閲覧・送信権限がありません' };
            }
            const schedule = newStaffSchedule(scope, message, runAt);
            schedule.mode = mode;
            if (mode === 'task') schedule.task = task;
            await saveStaffSchedules(scope.guildId, [...schedules, schedule]);
            return { success: true, schedule, timezone: 'Asia/Tokyo',
                localTime: new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'long' }).format(new Date(time)) };
        });
    } catch (error) {
        console.error('[StaffAI schedule] tool failed:', error);
        return { error: 'スケジュールの処理に失敗しました。予約済みとは案内せず、再確認してください' };
    }
};
