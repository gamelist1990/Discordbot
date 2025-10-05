import { PermissionLevel, DynamicCommandOptions, CommandBuilderCallback } from '../../types/enhanced-command.js';
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

const command: DynamicCommandOptions = {
    name: 'userinfo',
    description: 'ユーザー情報を表示します',
    permissionLevel: PermissionLevel.ANY,
    guildOnly: true,
    
    builder: ((eb: SlashCommandBuilder) => {
        return eb.addUserOption(option =>
            option
                .setName('user')
                .setDescription('情報を表示するユーザー')
                .setRequired(false)
        );
    }) as CommandBuilderCallback,
    
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ 
                content: 'このコマンドはサーバー内でのみ使用できます。', 
                ephemeral: true 
            });
            return;
        }

        const targetUser = interaction.options.getUser('user') ?? interaction.user;
        const member = interaction.guild.members.cache.get(targetUser.id);

        if (!member) {
            await interaction.reply({ 
                content: 'ユーザー情報を取得できませんでした。', 
                ephemeral: true 
            });
            return;
        }

        const accountCreatedTimestamp = Math.floor(targetUser.createdTimestamp / 1000);
        const joinedTimestamp = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : 0;

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`👤 ${targetUser.tag} の情報`)
            .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: 'ユーザーID', value: targetUser.id, inline: true },
                { name: 'ニックネーム', value: member.nickname ?? 'なし', inline: true },
                { name: 'アカウント作成日', value: `<t:${accountCreatedTimestamp}:F>`, inline: false },
                { name: 'サーバー参加日', value: joinedTimestamp ? `<t:${joinedTimestamp}:F>` : '不明', inline: false },
                { name: 'ロール数', value: `${member.roles.cache.size - 1}`, inline: true },
                { name: 'Bot', value: targetUser.bot ? 'はい' : 'いいえ', inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};

export default command;
