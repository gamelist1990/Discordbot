import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder,
    type APIEmbed, type ButtonInteraction, type StringSelectMenuInteraction,
} from 'discord.js';
import { database } from '../../../core/persistence/Database.js';
import type { StaffAIStreamState } from './StaffAIStreamState.js';

export type StaffAIProgressEntry = {
    kind: 'tool' | 'thinking'; name: string; value: string; needsAttention: boolean;
};
export type StaffAIProgressDetails = { summary: APIEmbed; entries: StaffAIProgressEntry[] };
type SavedProgress = StaffAIProgressDetails & { version: 1; channelId: string };
type ProgressStorage = Pick<typeof database, 'get' | 'set'>;
type View = 'overview' | 'tools' | 'timeline' | 'attention' | 'thinking';
const PREFIX = 'staff-ai-progress:';
const PAGE_SIZE = 6;
const VIEWS: Record<View, string> = {
    overview: '概要（折りたたむ）', tools: 'ツール履歴', timeline: 'Thinkingとツールの時系列',
    attention: '失敗・未完了', thinking: 'Thinkingの概要',
};

function components(id: string, view: View, page: number, pages: number, privateView: boolean) {
    const select = new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}${id}:${privateView ? 'view' : 'open'}:select`)
        .setPlaceholder(privateView ? '表示する詳細を選択' : '処理の詳細を見る（自分だけに表示）')
        .addOptions(Object.entries(VIEWS).map(([value, label]) => ({label, value,
            ...(privateView ? {default: value === view} : {})})));
    const rows: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    ];
    if (privateView && view !== 'overview') {
        const buttons = new ActionRowBuilder<ButtonBuilder>();
        if (pages > 1) buttons.addComponents(
            new ButtonBuilder().setCustomId(`${PREFIX}${id}:view:${view}:${page - 1}`)
                .setLabel('前へ').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`${PREFIX}${id}:view:${view}:${page + 1}`)
                .setLabel('次へ').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
        );
        buttons.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}${id}:view:overview:0`)
            .setLabel('折りたたむ').setStyle(ButtonStyle.Secondary));
        rows.push(buttons);
    }
    return rows;
}

export function buildStaffAIProgressView(details: StaffAIProgressDetails, id: string,
    view: View = 'overview', requestedPage = 0, privateView = false) {
    const entries = details.entries.filter(entry => view === 'timeline'
        || view === 'tools' && entry.kind === 'tool'
        || view === 'thinking' && entry.kind === 'thinking'
        || view === 'attention' && entry.needsAttention);
    const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    const page = Number.isFinite(requestedPage) ? Math.max(0, Math.min(pages - 1, Math.trunc(requestedPage))) : 0;
    const summary = {...details.summary, fields: []};
    // Never edit the answer body or its attachments when navigating details.
    const embed: APIEmbed = view === 'overview'
        ? {...summary, description: [summary.description, '処理の詳細はメニューから確認できます。'].filter(Boolean).join('\n')}
        : {...summary, title: VIEWS[view],
            description: `${entries.length}件 · ${page + 1}/${pages}ページ${entries.length ? '' : '\n該当する履歴はありません。'}`,
            fields: entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(entry => ({
                name: entry.name.slice(0, 256), value: entry.value.slice(0, 700) || '詳細なし', inline: false,
            }))};
    return {embeds: [embed], components: components(id, view, page, pages, privateView), allowedMentions: {parse: [] as []}};
}

/** Persist only public display metadata. Raw arguments, reasoning text and the answer are excluded. */
export async function completedStaffAIReply(state: StaffAIStreamState,
    context: {id: string; guildId: string | null; channelId: string}, answer = state.content,
    storage: ProgressStorage = database) {
    const payload = state.renderDiscord(true, answer);
    const details = state.completedProgressDetails();
    if (!details) return {...payload, components: []};
    try {
        await storage.set<SavedProgress>(context.guildId || 'global', `staff-ai-progress-${context.id}`,
            {...details, version: 1, channelId: context.channelId});
        return {...payload, ...buildStaffAIProgressView(details, context.id)};
    } catch (error) {
        console.warn('[StaffAIProgress] Could not save details; keeping inline progress:', error);
        return {...payload, components: []};
    }
}

export async function handleStaffAIProgressInteraction(
    interaction: StringSelectMenuInteraction | ButtonInteraction, storage: ProgressStorage = database,
): Promise<void> {
    if (interaction.replied || interaction.deferred) return;
    const match = /^staff-ai-progress:(\d{17,20}):(open|view):(select|overview|tools|timeline|attention|thinking)(?::(-?\d+))?$/.exec(interaction.customId);
    if (!match) {
        await interaction.reply({content: '処理履歴の参照情報が正しくありません。', flags: MessageFlags.Ephemeral});
        return;
    }
    const [, id, action, selection, page] = match;
    // Public menus open an ephemeral panel. Pagination only updates that private panel.
    if (action === 'open') await interaction.deferReply({flags: MessageFlags.Ephemeral});
    else if (!interaction.message.flags.has(MessageFlags.Ephemeral)) {
        await interaction.reply({content: '元の回答のメニューから詳細を開いてください。', flags: MessageFlags.Ephemeral});
        return;
    } else await interaction.deferUpdate();
    try {
        const details = await storage.get<SavedProgress>(interaction.guildId || 'global', `staff-ai-progress-${id}`);
        if (!details || details.version !== 1 || details.channelId !== interaction.channelId) {
            await interaction.editReply({content: 'この処理履歴は見つかりませんでした。', embeds: [], components: []});
            return;
        }
        const selected = selection === 'select' && interaction.isStringSelectMenu() ? interaction.values[0] : selection;
        const view: View = Object.hasOwn(VIEWS, selected) ? selected as View : 'overview';
        await interaction.editReply({content: '', ...buildStaffAIProgressView(details, id, view, Number(page || 0), true)});
    } catch (error) {
        console.warn('[StaffAIProgress] Could not open details:', error);
        await interaction.editReply({content: '処理履歴を開けませんでした。元のメニューからもう一度お試しください。', embeds: [], components: []}).catch(() => {});
    }
}
