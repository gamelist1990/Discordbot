import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';

/**
 * スタッフコマンドのヘルプ情報
 */
interface StaffCommandInfo {
    name: string;
    description: string;
    usage: string;
    examples?: string[];
}

const STAFF_COMMANDS: StaffCommandInfo[] = [
    {
        name: 'help',
        description: 'スタッフコマンドのヘルプを表示します',
        usage: '/staff help [page]',
        examples: [
            '/staff help',
            '/staff help 2'
        ]
    },
    {
        name: 'privatechat',
        description: 'プライベートチャット機能を管理します（Web UIで操作）',
        usage: '/staff privatechat',
        examples: [
            '/staff privatechat'
        ]
    }
];

const ITEMS_PER_PAGE = 3;

/**
 * /staff help サブコマンドを処理
 */
export async function handleHelpSubcommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const requestedPage = interaction.options.getInteger('page') ?? 1;
    
    const totalPages = Math.ceil(STAFF_COMMANDS.length / ITEMS_PER_PAGE);
    const page = Math.max(1, Math.min(requestedPage, totalPages));
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, STAFF_COMMANDS.length);
    const pageCommands = STAFF_COMMANDS.slice(startIndex, endIndex);

    // Embed を作成
    const embed = new EmbedBuilder()
        .setColor('#ffa500')
        .setTitle('🛠️ スタッフコマンド ヘルプ')
        .setDescription(
            `スタッフ向けの管理機能コマンド一覧\n` +
            `ページ ${page}/${totalPages} | 全 ${STAFF_COMMANDS.length} コマンド`
        )
        .setTimestamp()
        .setFooter({ text: `/staff help <ページ番号> で他のページを表示` });

    // ページ内のコマンドを追加
    pageCommands.forEach((cmd) => {
        let fieldValue = `📝 ${cmd.description}\n\n**使用方法:**\n\`${cmd.usage}\``;
        
        if (cmd.examples && cmd.examples.length > 0) {
            fieldValue += `\n\n**例:**\n${cmd.examples.map(ex => `\`${ex}\``).join('\n')}`;
        }

        embed.addFields({
            name: `📌 ${cmd.name}`,
            value: fieldValue,
            inline: false
        });
    });

    // ページナビゲーション情報
    if (totalPages > 1) {
        const navInfo: string[] = [];
        if (page > 1) navInfo.push(`⬅️ \`/staff help page:${page - 1}\``);
        if (page < totalPages) navInfo.push(`➡️ \`/staff help page:${page + 1}\``);
        
        if (navInfo.length > 0) {
            embed.addFields({
                name: '📖 ページ移動',
                value: navInfo.join(' | '),
                inline: false
            });
        }
    }

    // アクセス権限についての注意
    embed.addFields({
        name: 'ℹ️ アクセス権限',
        value: 'これらのコマンドは「サーバー管理」権限を持つユーザーのみ使用できます。',
        inline: false
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export default null;
