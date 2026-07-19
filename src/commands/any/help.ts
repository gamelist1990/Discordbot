import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { CommandRegistry } from '../../core/commands/CommandRegistry.js';
import { SlashCommand } from '../../types/command.js';
import { PermissionLevel } from '../../web/types/permission.js';

const COMMANDS_PER_PAGE = 5;

/**
 * /help コマンド
 * コマンド一覧を表示します
 */
const helpCommand: SlashCommand = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('コマンド一覧を表示します')
        .addIntegerOption(option =>
            option
                .setName('page')
                .setDescription('表示するページ番号')
                .setRequired(false)
                .setMinValue(1)
        ) as SlashCommandBuilder,
    permissionLevel: PermissionLevel.ANY,
    
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const requestedPage = interaction.options.getInteger('page') ?? 1;
        
        // CommandRegistry からコマンド一覧を取得
        const registry = CommandRegistry.getInstance();
        const commands = Array.from(registry.getCommands().values());
        
        if (commands.length === 0) {
            await interaction.reply({ 
                content: '❌ 登録されているコマンドがありません。', 
                ephemeral: true 
            });
            return;
        }

        // コマンド名でソート
        const sortedCommands = commands.sort((a, b) => a.data.name.localeCompare(b.data.name));

        const totalPages = Math.ceil(sortedCommands.length / COMMANDS_PER_PAGE);
        const page = Math.max(1, Math.min(requestedPage, totalPages));
        const startIndex = (page - 1) * COMMANDS_PER_PAGE;
        const endIndex = Math.min(startIndex + COMMANDS_PER_PAGE, sortedCommands.length);
        const pageCommands = sortedCommands.slice(startIndex, endIndex);

        // Embedを作成
        const embed = new EmbedBuilder()
            .setColor('#00aaff')
            .setTitle('📚 コマンド一覧')
            .setDescription(`全 ${sortedCommands.length} 個のコマンドが登録されています\nページ ${page}/${totalPages}`)
            .setTimestamp()
            .setFooter({ text: `/help <ページ番号> で他のページを表示` });

        // ページ内のコマンドを追加
        pageCommands.forEach((cmd) => {
            const guildOnlyText = cmd.guildOnly ? ' 🏠' : '';
            const adminText = cmd.data.default_member_permissions ? ' 🛡️' : '';
            
            embed.addFields({
                name: `\`/${cmd.data.name}\`${guildOnlyText}${adminText}`,
                value: cmd.data.description,
                inline: false
            });
        });

        // ページナビゲーション情報
        if (totalPages > 1) {
            const navInfo: string[] = [];
            if (page > 1) navInfo.push(`⬅️ \`/help ${page - 1}\``);
            if (page < totalPages) navInfo.push(`➡️ \`/help ${page + 1}\``);
            
            if (navInfo.length > 0) {
                embed.addFields({
                    name: '📖 ページ移動',
                    value: navInfo.join(' | '),
                    inline: false
                });
            }
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};

export default helpCommand;
