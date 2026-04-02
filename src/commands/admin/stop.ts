import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { SlashCommand } from '../../types/command.js';
import { PermissionLevel } from '../../web/types/permission.js';
import config from '../../config.js';

const TARGET_GUILD_ID = (config as any).STOP_COMMAND_GUILD_ID || '890315487962095637';
const SHUTDOWN_DELAY_MS = 500;

const stopCommand: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Botプロセスを停止します（対象サーバーのオーナー専用）')
        .setDMPermission(false),
    permissionLevel: PermissionLevel.OWNER,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ このコマンドはサーバー内でのみ使用できます。',
                ephemeral: true
            });
            return;
        }

        if (interaction.guild.id !== TARGET_GUILD_ID) {
            await interaction.reply({
                content: '❌ このコマンドは指定サーバーでのみ使用できます。',
                ephemeral: true
            });
            return;
        }

        if (interaction.user.id !== interaction.guild.ownerId) {
            await interaction.reply({
                content: '❌ このコマンドは対象サーバーのオーナーのみ実行できます。',
                ephemeral: true
            });
            return;
        }

        await interaction.reply({
            content: '🛑 シャットダウンを開始します。',
            ephemeral: true
        });

        setTimeout(() => process.exit(0), SHUTDOWN_DELAY_MS);
    }
};

export default stopCommand;
