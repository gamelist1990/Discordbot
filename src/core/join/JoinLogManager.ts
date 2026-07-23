import {
    ChannelType,
    Colors,
    EmbedBuilder,
    GuildMember,
    PartialGuildMember,
    TextChannel
} from 'discord.js';
import { database } from '../persistence/Database.js';
import { Logger } from '../../utils/Logger.js';

export interface JoinLogSettings {
    enabled: boolean;
    channelId: string | null;
    logBots: boolean;
    joinTitle: string;
    joinDescription: string;
    leaveTitle: string;
    leaveDescription: string;
    joinColor: number;
    leaveColor: number;
}

const SETTINGS_KEY = 'join-log/settings';

export const DEFAULT_JOIN_LOG_SETTINGS: JoinLogSettings = {
    enabled: false,
    channelId: null,
    logBots: false,
    joinTitle: 'Member joined',
    joinDescription: '{mention} joined {server}\n\n**Roles:** {roles}\nID: {id}',
    leaveTitle: 'Member left',
    leaveDescription: '{mention} joined {joined_duration} ago\n\n**Roles:** {roles}\nID: {id}',
    joinColor: Colors.Green,
    leaveColor: Colors.Red
};

export class JoinLogManager {
    async getSettings(guildId: string): Promise<JoinLogSettings> {
        const saved = await database.get<Partial<JoinLogSettings>>(guildId, SETTINGS_KEY, {});
        return { ...DEFAULT_JOIN_LOG_SETTINGS, ...(saved || {}) };
    }

    async saveSettings(guildId: string, settings: JoinLogSettings): Promise<void> {
        await database.set(guildId, SETTINGS_KEY, settings);
    }

    async updateSettings(guildId: string, patch: Partial<JoinLogSettings>): Promise<JoinLogSettings> {
        const settings = { ...(await this.getSettings(guildId)), ...patch };
        await this.saveSettings(guildId, settings);
        return settings;
    }

    async handleMemberJoin(member: GuildMember): Promise<void> {
        await this.sendMemberLog(member, 'join');
    }

    async handleMemberLeave(member: GuildMember | PartialGuildMember): Promise<void> {
        await this.sendMemberLog(member, 'leave');
    }

    private async sendMemberLog(member: GuildMember | PartialGuildMember, type: 'join' | 'leave'): Promise<void> {
        try {
            const settings = await this.getSettings(member.guild.id);
            if (!settings.enabled || !settings.channelId) return;
            if (member.user.bot && !settings.logBots) return;

            const channel = await member.guild.channels.fetch(settings.channelId).catch(() => null);
            if (!channel || channel.type !== ChannelType.GuildText) {
                Logger.warn(`参加・退出ログの送信先が見つかりません: ${member.guild.id}/${settings.channelId}`);
                return;
            }

            const title = type === 'join' ? settings.joinTitle : settings.leaveTitle;
            const descriptionTemplate = type === 'join'
                ? settings.joinDescription
                : settings.leaveDescription;
            const color = type === 'join' ? settings.joinColor : settings.leaveColor;

            const embed = new EmbedBuilder()
                .setAuthor({
                    name: member.guild.name,
                    iconURL: member.guild.iconURL() || undefined
                })
                .setTitle(this.formatTemplate(title, member))
                .setDescription(this.formatTemplate(descriptionTemplate, member))
                .setColor(color)
                .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
                .setFooter({ text: `ID: ${member.id}` })
                .setTimestamp();

            await (channel as TextChannel).send({
                embeds: [embed],
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            Logger.error(`参加・退出ログの送信に失敗しました (${type}):`, error);
        }
    }

    private formatTemplate(template: string, member: GuildMember | PartialGuildMember): string {
        const roles = member.roles.cache
            .filter((role) => role.id !== member.guild.id)
            .sort((left, right) => right.position - left.position)
            .map((role) => `<@&${role.id}>`)
            .join(' ') || 'なし';

        const joinedDuration = member.joinedTimestamp
            ? this.formatDuration(Math.max(0, Date.now() - member.joinedTimestamp))
            : '不明な期間';

        const replacements: Record<string, string> = {
            '{user}': member.user.username,
            '{display_name}': member.displayName,
            '{tag}': member.user.tag,
            '{mention}': `<@${member.id}>`,
            '{id}': member.id,
            '{server}': member.guild.name,
            '{member_count}': String(member.guild.memberCount),
            '{roles}': roles,
            '{joined_duration}': joinedDuration,
            '{account_created}': `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`
        };

        return Object.entries(replacements).reduce(
            (result, [placeholder, value]) => result.split(placeholder).join(value),
            template
        );
    }

    private formatDuration(milliseconds: number): string {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const parts: string[] = [];

        if (days > 0) parts.push(`${days}日`);
        if (hours > 0) parts.push(`${hours}時間`);
        if (minutes > 0) parts.push(`${minutes}分`);
        parts.push(`${seconds}秒`);
        return parts.join(' ');
    }
}

export const joinLogManager = new JoinLogManager();
