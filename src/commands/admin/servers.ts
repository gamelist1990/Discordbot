import { PermissionLevel, DynamicCommandOptions } from '../../types/enhanced-command.js';
import { ChatInputCommandInteraction, EmbedBuilder, Client, Guild } from 'discord.js';

const MAX_GUILDS = 50;

const command: DynamicCommandOptions = {
    name: 'servers',
    description: 'Bot が参加しているサーバー一覧を表示します',
    permissionLevel: PermissionLevel.OP,
    
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const client: Client = interaction.client;
        const guilds: Guild[] = Array.from(client.guilds.cache.values());

        // サーバーリストを作成
        const guildList = guilds
            .sort((a: Guild, b: Guild) => b.memberCount - a.memberCount)
            .map((guild: Guild, index: number) => {
                return `${index + 1}. **${guild.name}** (${guild.memberCount.toLocaleString()} メンバー)`;
            })
            .join('\n');

        const totalMembers = guilds.reduce((sum: number, g: Guild) => sum + g.memberCount, 0);

        const embed = new EmbedBuilder()
            .setColor(guilds.length >= MAX_GUILDS ? '#ff0000' : '#00ff00')
            .setTitle('📊 サーバー一覧')
            .setDescription(guildList || 'サーバーに参加していません')
            .addFields(
                { name: '現在のサーバー数', value: `${guilds.length}/${MAX_GUILDS}`, inline: true },
                { name: '合計メンバー数', value: totalMembers.toLocaleString(), inline: true },
                { name: '残り枠', value: `${Math.max(0, MAX_GUILDS - guilds.length)}`, inline: true }
            )
            .setFooter({ 
                text: guilds.length >= MAX_GUILDS 
                    ? '⚠️ サーバー上限に達しています' 
                    : `あと ${MAX_GUILDS - guilds.length} サーバー追加できます` 
            })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};

export default command;
