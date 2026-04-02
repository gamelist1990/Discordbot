import {
    ActionRowBuilder,
    EmbedBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    StringSelectMenuOptionBuilder
} from 'discord.js';
import { getTodoBoardByChannel, TodoBoardSnapshot, TodoItem, TodoItemPriority, TodoItemStatus } from './TodoStorage.js';

const STATUS_META: Record<TodoItemStatus, { label: string; emoji: string; color: number }> = {
    todo: { label: 'Todo', emoji: '📝', color: 0x64748b },
    doing: { label: '進行中', emoji: '🚧', color: 0x2563eb },
    review: { label: '確認待ち', emoji: '🧪', color: 0xd97706 },
    blocked: { label: '停止中', emoji: '⛔', color: 0xdc2626 },
    done: { label: '完了', emoji: '✅', color: 0x16a34a }
};

const PRIORITY_META: Record<TodoItemPriority, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical'
};

export function buildTodoMessagePayload(board: TodoBoardSnapshot, context: {
    guildName: string;
    channelName: string;
}) {
    return {
        content: '',
        embeds: buildBoardEmbeds(board, context),
        components: buildBoardComponents(board)
    };
}

export async function handleTodoSelectInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    if (interaction.replied || interaction.deferred) {
        return;
    }

    const [, , guildId, channelId] = interaction.customId.split(':');
    if (!guildId || !channelId) {
        await interaction.reply({ content: '❌ Todo 参照情報が壊れています。', ephemeral: true });
        return;
    }

    const board = await getTodoBoardByChannel(guildId, channelId);
    if (!board) {
        await interaction.reply({ content: '❌ Todo データが見つかりませんでした。', ephemeral: true });
        return;
    }

    const item = board.items.find((entry) => entry.id === interaction.values[0]);
    if (!item) {
        await interaction.reply({ content: '❌ 選択した Todo 項目が見つかりませんでした。', ephemeral: true });
        return;
    }

    const status = STATUS_META[item.status];
    const embed = new EmbedBuilder()
        .setColor(status.color)
        .setTitle(`${status.emoji} ${item.title}`)
        .setDescription(item.details || item.summary || '詳細はありません。')
        .addFields(
            { name: '状態', value: status.label, inline: true },
            { name: '優先度', value: PRIORITY_META[item.priority], inline: true },
            { name: '進捗', value: `${item.progress}%`, inline: true }
        )
        .setFooter({ text: `${board.title} • 詳細ビュー` })
        .setTimestamp(new Date(item.updatedAt));

    if (item.summary.trim() && item.details.trim() !== item.summary.trim()) {
        embed.addFields({ name: '要約', value: trimForField(item.summary), inline: false });
    }
    if (item.assignee.trim()) {
        embed.addFields({ name: '担当', value: item.assignee.trim(), inline: true });
    }
    if (item.dueDate) {
        embed.addFields({ name: '期限', value: item.dueDate, inline: true });
    }
    if (item.tags.length > 0) {
        embed.addFields({ name: 'タグ', value: item.tags.map((tag) => `#${tag}`).join(' '), inline: false });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => null);
}

function buildBoardEmbeds(board: TodoBoardSnapshot, context: { guildName: string; channelName: string; }) {
    const overview = new EmbedBuilder()
        .setColor(0x2563eb)
        .setTitle(board.title)
        .setDescription(buildOverviewDescription(board))
        .setAuthor({ name: board.updatedBy })
        .addFields(
            { name: 'Todo', value: String(board.items.filter((item) => item.status === 'todo').length), inline: true },
            { name: '進行中', value: String(board.items.filter((item) => item.status === 'doing').length), inline: true },
            { name: '完了', value: String(board.items.filter((item) => item.status === 'done').length), inline: true }
        )
        .setFooter({ text: `Staff Todo • ${context.guildName} • #${context.channelName}` })
        .setTimestamp(new Date(board.updatedAt));

    const embeds = [overview];
    const chunks = chunkArray(board.items, 8);
    for (const chunk of chunks) {
        const embed = new EmbedBuilder()
            .setColor(0x0f172a)
            .setTitle('Todo List')
            .setDescription('詳細は下のドロップダウンから確認できます。');

        for (const item of chunk) {
            embed.addFields({
                name: `${STATUS_META[item.status].emoji} ${item.title}`.slice(0, 256),
                value: trimForField([
                    `状態: ${STATUS_META[item.status].label} / 優先度: ${PRIORITY_META[item.priority]} / 進捗: ${item.progress}%`,
                    item.summary.trim() || '要約なし'
                ].join('\n')),
                inline: false
            });
        }
        embeds.push(embed);
    }

    return embeds.slice(0, 10);
}

function buildBoardComponents(board: TodoBoardSnapshot) {
    if (board.items.length === 0) {
        return [];
    }

    return chunkArray(board.items, 25).slice(0, 5).map((chunk, index) => {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`todo:view:${board.guildId}:${board.channelId}:${index}`)
            .setPlaceholder(index === 0 ? 'Todo の詳細を選択' : `Todo の詳細を選択 (${index + 1})`)
            .addOptions(
                chunk.map((item) =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(item.title.slice(0, 100) || 'Untitled')
                        .setValue(item.id)
                        .setDescription(buildOptionDescription(item))
                        .setEmoji(STATUS_META[item.status].emoji)
                )
            );

        return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
    });
}

function buildOptionDescription(item: TodoItem): string {
    const base = `${STATUS_META[item.status].label} • ${item.progress}%`;
    const summary = (item.summary || '').trim().replace(/\s+/g, ' ');
    if (!summary) {
        return base.slice(0, 100);
    }
    return `${base} • ${summary}`.slice(0, 100);
}

function buildOverviewDescription(board: TodoBoardSnapshot): string {
    if (!board.summary.trim() && board.items.length === 0) {
        return 'まだ Todo 項目はありません。';
    }

    const lines: string[] = [];
    if (board.summary.trim()) {
        lines.push(board.summary.trim());
    }
    if (board.items.length > 0) {
        lines.push(`項目数: ${board.items.length}`);
        const highlighted = board.items.filter((item) => item.status !== 'done').slice(0, 5);
        if (highlighted.length > 0) {
            lines.push('');
            lines.push(...highlighted.map((item) => `${STATUS_META[item.status].emoji} ${item.title} (${item.progress}%)`));
        }
    }
    return lines.join('\n').slice(0, 4096) || 'Todo ボード';
}

function trimForField(value: string): string {
    return value.slice(0, 1024) || '-';
}

function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}
