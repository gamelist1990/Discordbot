import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChannelType,
    Client,
    EmbedBuilder,
    Guild,
    Message,
    ModalBuilder,
    ModalSubmitInteraction,
    TextChannel,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { CoreFeatureApi, CoreFeatureModule } from '../registry.js';
import { CoreFeaturePanelKind } from '../types.js';
import { isStaffMember } from '../guildUtils.js';
import { requestCoreFeatureModelText } from '../model.js';
import { database } from '../../Database.js';

type RequestStatus = 'undecided' | 'planned' | 'working' | 'done' | 'closed';
type RequestItem = {
    id: string;
    guildId: string;
    panelKind: CoreFeaturePanelKind;
    channelId: string;
    authorId: string;
    title: string;
    body: string;
    label: string;
    status: RequestStatus;
    summary: string;
    createdAt: string;
    updatedAt: string;
};

function getRequestsKey(guildId: string): string {
    return `Guild/${guildId}/corefeature/request/items`;
}

function generateRequestId(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export class RequestFeature implements CoreFeatureModule {
    readonly key = 'request';
    readonly order = 30;
    private api: CoreFeatureApi | null = null;

    register(api: CoreFeatureApi): void {
        this.api = api;
    }

    setClient(client: Client): void {
        void client;
    }

    buildPanelButton(guildId: string, panelKind: CoreFeaturePanelKind): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(`corefeature:${guildId}:${panelKind}:${this.key}:entry`)
            .setLabel('Request')
            .setEmoji('📝')
            .setStyle(ButtonStyle.Secondary);
    }

    async handleButtonInteraction(interaction: ButtonInteraction, panelKind: CoreFeaturePanelKind, action: string, parts: string[]): Promise<boolean> {
        if (!interaction.guild) return false;
        if (action === 'entry') {
            const modal = new ModalBuilder()
                .setCustomId(`corefeature:request:create:${panelKind}`)
                .setTitle('Request を作成');
            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder().setCustomId('label').setLabel('ラベル').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('機能リクエスト / バグ修正 / その他')
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder().setCustomId('title').setLabel('件名').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder().setCustomId('body').setLabel('内容').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1800)
                )
            );
            await interaction.showModal(modal);
            return true;
        }

        if (action === 'status') {
            const itemId = parts[0];
            const nextStatus = (parts[1] || 'undecided') as RequestStatus;
            const guild = interaction.guild;
            if (!(await isStaffMember(guild, interaction.user.id))) {
                return true;
            }
            const items = await this.getItems(guild.id);
            const item = items.find((entry) => entry.id === itemId);
            if (!item) {
                await interaction.reply({ content: '❌ Request が見つかりません。', ephemeral: true });
                return true;
            }
            item.status = nextStatus;
            item.updatedAt = new Date().toISOString();
            await this.saveItems(guild.id, items);

            if (nextStatus === 'done') {
                const modal = new ModalBuilder()
                    .setCustomId(`corefeature:request:done:${item.id}`)
                    .setTitle('完了報告');
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder().setCustomId('title').setLabel('タイトル').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120)
                    ),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder().setCustomId('body').setLabel('内容').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1800)
                    )
                );
                await interaction.showModal(modal);
                return true;
            }

            await interaction.reply({ content: `✅ ステータスを ${nextStatus} に更新しました。`, ephemeral: true });
            return true;
        }

        return false;
    }

    async handleModalSubmit(interaction: ModalSubmitInteraction, customId: string): Promise<boolean> {
        if (!interaction.guild) {
            return false;
        }

        if (customId.startsWith('corefeature:request:create:')) {
            const panelKind = (customId.split(':')[3] || 'combined') as CoreFeaturePanelKind;
            const label = interaction.fields.getTextInputValue('label').trim();
            const title = interaction.fields.getTextInputValue('title').trim();
            const body = interaction.fields.getTextInputValue('body').trim();
            const safe = await this.isRequestSafe(label, title, body);
            if (!safe) {
                await interaction.reply({ content: '❌ この request は安全性チェックで拒否されました。', ephemeral: true });
                return true;
            }

            const summary = await this.summarizeRequestTitle(title, body);
            const id = generateRequestId();
            const item: RequestItem = {
                id,
                guildId: interaction.guild.id,
                panelKind,
                channelId: '',
                authorId: interaction.user.id,
                title,
                body,
                label,
                status: 'undecided',
                summary,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const config = this.api ? await this.api.getPanelConfig(interaction.guild.id, panelKind) : null;
            const categoryName = config?.requestCategoryName || 'Request';
            let category = interaction.guild.channels.cache.find((ch) => ch.type === ChannelType.GuildCategory && ch.name === categoryName);
            if (!category) {
                category = await interaction.guild.channels.create({
                    name: categoryName,
                    type: ChannelType.GuildCategory
                });
            }
            const categoryId = category.id;
            const requestChannel = await interaction.guild.channels.create({
                name: `${summary || 'request'}-${id}`.slice(0, 90),
                type: ChannelType.GuildText,
                parent: categoryId
            });
            item.channelId = requestChannel.id;

            const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`corefeature:${interaction.guild.id}:${panelKind}:request:status:${id}:closed`).setLabel('Close').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`corefeature:${interaction.guild.id}:${panelKind}:request:status:${id}:undecided`).setLabel('Todo:未定').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`corefeature:${interaction.guild.id}:${panelKind}:request:status:${id}:planned`).setLabel('Todo:計画').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`corefeature:${interaction.guild.id}:${panelKind}:request:status:${id}:working`).setLabel('Todo:作業中').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`corefeature:${interaction.guild.id}:${panelKind}:request:status:${id}:done`).setLabel('Todo:完了').setStyle(ButtonStyle.Success)
            );

            const embed = new EmbedBuilder()
                .setTitle(`Request #${id}`)
                .setDescription(`**ラベル:** ${label}\n**件名:** ${title}\n\n${body}`)
                .setFooter({ text: 'スタッフが対応状態を更新します。' })
                .setTimestamp();

            const posted = await (requestChannel as TextChannel).send({ embeds: [embed], components: [actionRow] });
            await posted.pin().catch(() => null);

            const items = await this.getItems(interaction.guild.id);
            items.push(item);
            await this.saveItems(interaction.guild.id, items);

            await interaction.reply({ content: `✅ Request を作成しました: <#${requestChannel.id}> (ID: ${id})`, ephemeral: true });
            return true;
        }

        if (customId.startsWith('corefeature:request:done:')) {
            const itemId = customId.split(':')[3];
            const items = await this.getItems(interaction.guild.id);
            const item = items.find((entry) => entry.id === itemId);
            if (!item) {
                await interaction.reply({ content: '❌ Request が見つかりません。', ephemeral: true });
                return true;
            }
            const reportTitle = interaction.fields.getTextInputValue('title').trim();
            const reportBody = interaction.fields.getTextInputValue('body').trim();
            item.status = 'done';
            item.updatedAt = new Date().toISOString();
            await this.saveItems(interaction.guild.id, items);

            const config = this.api ? await this.api.getPanelConfig(interaction.guild.id, item.panelKind) : null;
            if (config?.requestDoneChannelId) {
                const doneCh = await interaction.guild.channels.fetch(config.requestDoneChannelId).catch(() => null);
                if (doneCh && doneCh.type === ChannelType.GuildText) {
                    const polished = await this.polishDoneMessage(reportTitle, reportBody, item);
                    await (doneCh as TextChannel).send(polished);
                }
            }

            await interaction.reply({ content: '✅ 完了報告を保存しました。', ephemeral: true });
            return true;
        }

        return false;
    }

    async handleMessage(_message: Message): Promise<boolean> {
        return false;
    }

    async closeSessions(_guild: Guild, _options: { channelId?: string; reason: string }) {
        return [];
    }

    private async getItems(guildId: string): Promise<RequestItem[]> {
        return await database.get<RequestItem[]>(guildId, getRequestsKey(guildId), []) || [];
    }

    private async saveItems(guildId: string, items: RequestItem[]): Promise<void> {
        await database.set(guildId, getRequestsKey(guildId), items);
    }

    private async isRequestSafe(label: string, title: string, body: string): Promise<boolean> {
        try {
            const raw = await requestCoreFeatureModelText([
                { role: 'system', content: '次の投稿が荒らし・スパム・違法・危険目的かを判定してください。JSONのみで {"safe": true/false} を返してください。' },
                { role: 'user', content: `label=${label}\ntitle=${title}\nbody=${body}` }
            ], 120, 0.1, { requestLabel: 'corepanel-request-safety' });
            const parsed = JSON.parse(raw) as { safe?: unknown };
            return parsed.safe === true;
        } catch {
            return true;
        }
    }

    private async summarizeRequestTitle(title: string, body: string): Promise<string> {
        try {
            const raw = await requestCoreFeatureModelText([
                { role: 'system', content: '件名を15文字程度で短く要約して返してください。JSONのみで {"summary":"..."}。' },
                { role: 'user', content: `title=${title}\nbody=${body}` }
            ], 80, 0.2, { requestLabel: 'corepanel-request-summary' });
            const parsed = JSON.parse(raw) as { summary?: unknown };
            if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
                return parsed.summary.trim().slice(0, 20);
            }
        } catch {
            // fallback
        }
        return title.slice(0, 15);
    }

    private async polishDoneMessage(title: string, body: string, item: RequestItem): Promise<string> {
        try {
            const raw = await requestCoreFeatureModelText([
                { role: 'system', content: '完了報告を読みやすい日本語に整えてください。' },
                { role: 'user', content: `request=${item.title}\nlabel=${item.label}\nreportTitle=${title}\nreportBody=${body}` }
            ], 350, 0.4, { requestLabel: 'corepanel-request-done-post' });
            const text = raw.trim();
            if (text.length > 0) {
                return `✅ **Request 完了 #${item.id}**\n${text}`;
            }
        } catch {
            // fallback
        }
        return `✅ **Request 完了 #${item.id}**\n**${title}**\n${body}`;
    }
}
