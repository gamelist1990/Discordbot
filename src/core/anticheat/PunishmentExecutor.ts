import { GuildMember, TextChannel } from 'discord.js';
import { Logger } from '../../utils/Logger.js';
import { PunishmentAction } from './types.js';

/**
 * Executes punishments (timeout, kick, ban) and handles revocation
 */
export class PunishmentExecutor {
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
                        await logChannel.send(
                            `🔇 **User Timed Out**\n` +
                            `User: ${member.user.tag} (${member.id})\n` +
                            `Duration: ${action.durationSeconds}s\n` +
                            `Reason: ${reason}`
                        );
                    }
                    break;

                case 'kick':
                    await member.kick(reason);
                    Logger.info(`👢 Kicked user ${member.user.tag}`);
                    
                    if (action.notify && logChannel) {
                        await logChannel.send(
                            `👢 **User Kicked**\n` +
                            `User: ${member.user.tag} (${member.id})\n` +
                            `Reason: ${reason}`
                        );
                    }
                    break;

                case 'ban':
                    await member.ban({ 
                        reason,
                        deleteMessageSeconds: action.durationSeconds || 0
                    });
                    Logger.info(`🔨 Banned user ${member.user.tag}`);
                    
                    if (action.notify && logChannel) {
                        await logChannel.send(
                            `🔨 **User Banned**\n` +
                            `User: ${member.user.tag} (${member.id})\n` +
                            `Reason: ${reason}`
                        );
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
                await logChannel.send(
                    `✅ **Timeout Revoked**\n` +
                    `User: ${member.user.tag} (${member.id})`
                );
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
