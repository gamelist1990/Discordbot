import { ChannelType, type Channel } from 'discord.js';

/** Validate both the requesting member and the bot against current destination permissions. */
export async function staffScheduleChannelError(channel: Channel | null, guildId: string, userId: string): Promise<string | null> {
    if (!channel || !('guild' in channel) || channel.guildId !== guildId || !channel.isSendable()) {
        return '通知先はこのサーバー内の送信可能なチャンネルを指定してください';
    }
    const guild = channel.guild;
    const member = await guild.members.fetch(userId).catch(() => null);
    const bot = guild.members.me ?? await guild.members.fetchMe();
    const sendPermission = channel.isThread() ? 'SendMessagesInThreads' : 'SendMessages';
    for (const [actor, label] of [[member, '本人'], [bot, 'Bot']] as const) {
        const permissions = actor && channel.permissionsFor(actor);
        if (!permissions?.has('ViewChannel') || !permissions.has(sendPermission)) {
            return `${label}に通知先チャンネルの閲覧・送信権限がありません`;
        }
        if (channel.type === ChannelType.PrivateThread && !permissions.has('ManageThreads')) {
            const membership = await channel.members.fetch(actor!.id).catch(() => null);
            if (!membership) return `${label}は通知先のプライベートスレッドに参加していません`;
        }
    }
    return null;
}
