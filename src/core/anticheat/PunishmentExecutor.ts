import { GuildMember, TextChannel, EmbedBuilder, Colors } from 'discord.js';
import { Logger } from '../../utils/Logger.js';
import { PunishmentAction } from './types.js';

/**
 * Executes punishments (timeout, kick, ban) and handles revocation
 */
export class PunishmentExecutor {
    /**
     * Create a rich embed for punishment notifications
     */
    private static createPunishmentEmbed(
        title: string,
        member: GuildMember,
        color: number,
        fields: Array<{ name: string; value: string; inline?: boolean }>
    ): EmbedBuilder {
        const embed = new EmbedBuilder()
            .setTitle(`🛡️ ${title}`)
            .setColor(color)
            .setTimestamp()
            .setFooter({
                text: 'AntiCheat System',
                iconURL: member.guild.iconURL() || undefined
            });

        // Add user info
        embed.addFields(
            {
                name: '👤 ユーザー',
                value: `${member.user.tag}\n${member.user.toString()}`,
                inline: true
            },
            {
                name: '🆔 ユーザーID',
                value: `\`${member.id}\``,
                inline: true
            },
            {
                name: '🏠 サーバー',
                value: member.guild.name,
                inline: true
            }
        );

        // Add custom fields
        embed.addFields(...fields);

        return embed;
    }
    /**
     * Execute a punishment action on a guild member
     * @param member The guild member to punish
     * @param action The punishment action to execute
     * @param logChannel Optional channel to log the action
     */
    static async execute(
        member: GuildMember,
        action: PunishmentAction,
        logChannel?: TextChannel | null
    ): Promise<boolean> {
        try {
            const reason = this.formatReason(action.reasonTemplate || 'AntiCheat violation detected', member);

            switch (action.type) {
                case 'timeout':
                    if (!action.durationSeconds) {
                        Logger.warn(`Timeout action requires durationSeconds for user ${member.id}`);
                        return false;
                    }
                    await member.timeout(action.durationSeconds * 1000, reason);
                    Logger.info(`⏱️ Timed out user ${member.user.tag} for ${action.durationSeconds}s`);
                    
                    if (action.notify && logChannel) {
                        const embed = this.createPunishmentEmbed(
                            'ユーザーをタイムアウト',
                            member,
                            Colors.Orange,
                            [
                                {
                                    name: '⏰ タイムアウト時間',
                                    value: `${action.durationSeconds}秒`,
                                    inline: true
                                },
                                {
                                    name: '📝 理由',
                                    value: reason,
                                    inline: false
                                }
                            ]
                        );
                        await logChannel.send({ embeds: [embed] });
                    }
                    break;

                case 'kick':
                    await member.kick(reason);
                    Logger.info(`👢 Kicked user ${member.user.tag}`);
                    
                    if (action.notify && logChannel) {
                        const embed = this.createPunishmentEmbed(
                            'ユーザーをキック',
                            member,
                            Colors.Red,
                            [
                                {
                                    name: '📝 理由',
                                    value: reason,
                                    inline: false
                                }
                            ]
                        );
                        await logChannel.send({ embeds: [embed] });
                    }
                    break;

                case 'ban':
                    await member.ban({ 
                        reason,
                        deleteMessageSeconds: action.durationSeconds || 0
                    });
                    Logger.info(`🔨 Banned user ${member.user.tag}`);
                    
                    if (action.notify && logChannel) {
                        const embed = this.createPunishmentEmbed(
                            'ユーザーをBAN',
                            member,
                            Colors.DarkRed,
                            [
                                {
                                    name: '🗑️ メッセージ削除',
                                    value: action.durationSeconds ? `${action.durationSeconds}秒分のメッセージを削除` : 'なし',
                                    inline: true
                                },
                                {
                                    name: '📝 理由',
                                    value: reason,
                                    inline: false
                                }
                            ]
                        );
                        await logChannel.send({ embeds: [embed] });
                    }
                    break;

                default:
                    Logger.warn(`Unknown punishment type: ${(action as any).type}`);
                    return false;
            }

            return true;
        } catch (error) {
            Logger.error(`Failed to execute punishment ${action.type} on ${member.id}:`, error);
            return false;
        }
    }

    /**
     * Revoke a timeout from a guild member
     * @param member The guild member to remove timeout from
     * @param logChannel Optional channel to log the action
     */
    static async revokeTimeout(
        member: GuildMember,
        logChannel?: TextChannel | null
    ): Promise<boolean> {
        try {
            await member.timeout(null, 'AntiCheat timeout revoked by staff');
            Logger.info(`✅ Revoked timeout for user ${member.user.tag}`);

            if (logChannel) {
                const embed = this.createPunishmentEmbed(
                    'タイムアウトを解除',
                    member,
                    Colors.Green,
                    [
                        {
                            name: '📝 理由',
                            value: 'スタッフによるタイムアウト解除',
                            inline: false
                        }
                    ]
                );
                await logChannel.send({ embeds: [embed] });
            }

            return true;
        } catch (error) {
            Logger.error(`Failed to revoke timeout for ${member.id}:`, error);
            return false;
        }
    }

    /**
     * Format a reason template with variables
     * @param template The reason template (supports {user}, {userId}, {tag})
     * @param member The guild member
     * @returns Formatted reason string
     */
    private static formatReason(template: string, member: GuildMember): string {
        return template
            .replace(/{user}/g, member.user.username)
            .replace(/{userId}/g, member.id)
            .replace(/{tag}/g, member.user.tag);
    }
}
