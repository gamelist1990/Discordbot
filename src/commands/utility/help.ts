import { PermissionLevel, DynamicCommandOptions, CommandBuilderCallback } from '../../types/enhanced-command.js';
import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { CommandRegistry } from '../../core/CommandRegistry.js';
import { SlashCommand } from '../../types/command.js';

const COMMANDS_PER_PAGE = 5;

const command: DynamicCommandOptions = {
    name: 'help',
    description: 'コマンド一覧を表示します',
    permissionLevel: PermissionLevel.ANY,
    
    builder: ((eb: SlashCommandBuilder) => {
        return eb.addIntegerOption(option =>
            option
                .setName('page')
                .setDescription('表示するページ番号')
                .setRequired(false)
                .setMinValue(1)
        );
    }) as CommandBuilderCallback,
    
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const requestedPage = interaction.options.getInteger('page') ?? 1;
        
        // CommandRegistry からコマンド一覧を取得
        const registry = CommandRegistry.getInstance();
        const commands = Array.from(registry.getCommands().values());
        
        if (commands.length === 0) {
            await interaction.reply({ 
                content: '❌ 登録されているコマンドがありません。', 
                flags: MessageFlags.Ephemeral 
            });
            return;
        }

        // 権限レベルでグループ化
        const groupedCommands: Record<PermissionLevel, SlashCommand[]> = {
            [PermissionLevel.ANY]: [],
            [PermissionLevel.STAFF]: [],
            [PermissionLevel.ADMIN]: [],
            [PermissionLevel.OP]: [],
        };

        commands.forEach(cmd => {
            const level = cmd.permissionLevel || PermissionLevel.ANY;
            groupedCommands[level].push(cmd);
        });

        // ページネーション用にフラット化
        const sortedCommands: Array<{ cmd: SlashCommand, level: PermissionLevel }> = [];
        
        for (const [level, cmds] of Object.entries(groupedCommands)) {
            cmds.forEach(cmd => {
                sortedCommands.push({ cmd, level: level as PermissionLevel });
            });
        }

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

        // 権限レベルの絵文字マッピング
        const levelEmoji: Record<PermissionLevel, string> = {
            [PermissionLevel.ANY]: '🌐',
            [PermissionLevel.STAFF]: '👔',
            [PermissionLevel.ADMIN]: '🛡️',
            [PermissionLevel.OP]: '👑',
        };

        const levelName: Record<PermissionLevel, string> = {
            [PermissionLevel.ANY]: '誰でも',
            [PermissionLevel.STAFF]: 'スタッフ',
            [PermissionLevel.ADMIN]: '管理者',
            [PermissionLevel.OP]: 'サーバー管理者',
        };

        // ページ内のコマンドを追加
        pageCommands.forEach(({ cmd, level }) => {
            const cooldownText = cmd.cooldown ? ` (クールダウン: ${cmd.cooldown}秒)` : '';
            const guildOnlyText = cmd.guildOnly ? ' 🏠' : '';
            
            embed.addFields({
                name: `${levelEmoji[level]} \`/${cmd.data.name}\` ${guildOnlyText}`,
                value: `${cmd.data.description}\n**必要権限:** ${levelName[level]}${cooldownText}`,
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

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};

export default command;
