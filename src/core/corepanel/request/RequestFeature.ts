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
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
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
type RequestConfig = {
    categoryName: string;
    doneChannelId: string | null;
    labels: string[];
    description: string;
    instructions: string;
    staffRoleId?: string | null;
    trackingChannelId?: string | null;
    cooldownSeconds?: number;
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
                    new TextInputBuilder().setCustomId('label').setLabel('ラベル').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('機能リクエスト / バグ修正 / その他').setMaxLength(10)
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
                    ),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder()
                            .setCustomId('imageUrl')
                            .setLabel('完了画像URL(任意・1枚)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setMaxLength(1000)
                    )
                );
                await interaction.showModal(modal);
                return true;
            }

            item.status = nextStatus;
            item.updatedAt = new Date().toISOString();
            await this.saveItems(guild.id, items);
            await interaction.deferReply({ ephemeral: true });
            if (nextStatus === 'closed') {
                const targetChannel = await guild.channels.fetch(item.channelId).catch(() => null);
                if (targetChannel && targetChannel.type === ChannelType.GuildText) {
                    await (targetChannel as TextChannel).send('🔒 このリクエストはクローズされました。');
                    await (targetChannel as TextChannel).permissionOverwrites.edit(item.authorId, { SendMessages: false }).catch(() => null);
                }
            }

            await interaction.editReply({ content: `✅ ステータスを ${nextStatus} に更新しました。` });
            return true;
        }

        if (action === 'summary') {
            const itemId = parts[0];
            const items = await this.getItems(interaction.guild.id);
            const item = items.find((entry) => entry.id === itemId);
            if (!item) {
                await interaction.reply({ content: '❌ Request が見つかりません。', ephemeral: true });
                return true;
            }
            const isStaff = await isStaffMember(interaction.guild, interaction.user.id);
            if (interaction.user.id !== item.authorId && !isStaff) {
                await interaction.reply({ content: '❌ この操作は作成者かスタッフのみ実行できます。', ephemeral: true });
                return true;
            }
            await interaction.deferReply({ ephemeral: true });
            const nextSummary = await this.summarizeConversation(item);
            if (nextSummary.trim() === (item.summary || '').trim()) {
                await interaction.editReply({ content: 'ℹ️ 前回要約から進展がないため、再要約はスキップしました。' });
                return true;
            }
            item.summary = nextSummary;
            item.updatedAt = new Date().toISOString();
            await this.saveItems(interaction.guild.id, items);
            await interaction.editReply({ content: `📝 要約:\n${nextSummary}` });
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
            const label = interaction.fields.getTextInputValue('label').trim().slice(0, 10);
            const title = interaction.fields.getTextInputValue('title').trim().slice(0, 120);
            const body = interaction.fields.getTextInputValue('body').trim();
            await interaction.deferReply({ ephemeral: true });

            const requestConfig = await this.getRequestConfig(interaction.guild.id);
            const cooldownMs = Math.max(30000, (requestConfig?.cooldownSeconds || 300) * 1000);
            const itemsForCooldown = await this.getItems(interaction.guild.id);
            const lastOwn = itemsForCooldown
                .filter((entry) => entry.authorId === interaction.user.id)
                .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
            if (lastOwn) {
                const elapsed = Date.now() - Date.parse(lastOwn.createdAt);
                if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < cooldownMs) {
                    const waitSec = Math.ceil((cooldownMs - elapsed) / 1000);
                    await interaction.editReply({ content: `⏳ クールダウン中です。${waitSec}秒後に再試行してください。` });
                    return true;
                }
                if (lastOwn.body.trim() === body.trim()) {
                    await interaction.editReply({ content: '❌ 前回から進展していない同一内容のため送信できません。' });
                    return true;
                }
            }

            const validLabels = (requestConfig?.labels || []).map((entry) => entry.trim().slice(0, 10)).filter(Boolean);
            const safeLabel = label.slice(0, 10);
            if (validLabels.length > 0 && !validLabels.includes(safeLabel)) {
                await interaction.editReply({ content: '❌ ラベルが無効です。管理画面で設定されたラベルを使ってください。' });
                return true;
            }

            const safe = await this.isRequestSafe(safeLabel, title, body);
            if (!safe) {
                await interaction.editReply({ content: '❌ この request は安全性チェックで拒否されました。' });
                return true;
            }

            const summary = title.slice(0, 15);
            const id = generateRequestId();
            const item: RequestItem = {
                id,
                guildId: interaction.guild.id,
                panelKind,
                channelId: '',
                authorId: interaction.user.id,
                title,
                body,
                label: safeLabel,
                status: 'undecided',
                summary,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const config = this.api ? await this.api.getPanelConfig(interaction.guild.id, panelKind) : null;
            const categoryName = requestConfig?.categoryName || config?.requestCategoryName || 'Request';
            let category = interaction.guild.channels.cache.find((ch) => ch.type === ChannelType.GuildCategory && ch.name === categoryName);
            if (!category) {
                category = await interaction.guild.channels.create({
                    name: categoryName,
                    type: ChannelType.GuildCategory
                });
            }
            const categoryId = category.id;
            const permissionOverwrites: Array<any> = [
                {
                    id: interaction.guild.id,
                    deny: ['ViewChannel']
                },
                {
                    id: interaction.user.id,
                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles']
                }
            ];
            if (requestConfig?.staffRoleId) {
                permissionOverwrites.push({
                    id: requestConfig.staffRoleId,
                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels']
                });
            }
            const requestChannel = await interaction.guild.channels.create({
                name: `${summary || 'request'}-${id}`.slice(0, 90),
                type: ChannelType.GuildText,
                parent: categoryId,
                permissionOverwrites
            });
            item.channelId = requestChannel.id;

            const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`corefeature:${interaction.guild.id}:${panelKind}:request:status:${id}:closed`).setLabel('Close').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`corefeature:${interaction.guild.id}:${panelKind}:request:summary:${id}`).setLabel('会話要約').setStyle(ButtonStyle.Secondary)
            );
            const statusRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`corefeature:${interaction.guild.id}:${panelKind}:request:statusmenu:${id}`)
                    .setPlaceholder('Todo ステータスを選択')
                    .addOptions(
                        { label: '未定', value: 'undecided' },
                        { label: '計画', value: 'planned' },
                        { label: '作業中', value: 'working' },
                        { label: '完了', value: 'done' },
                        { label: 'クローズ', value: 'closed' }
                    )
            );

            const embed = new EmbedBuilder()
                .setTitle(`Request #${id}`)
                .setDescription(`**ラベル:** ${safeLabel}\n**件名:** ${title}\n\n${body}`)
                .setFooter({ text: 'スタッフが対応状態を更新します。' })
                .setTimestamp();

            const posted = await (requestChannel as TextChannel).send({ embeds: [embed], components: [actionRow, statusRow] });
            await posted.pin().catch(() => null);

            const items = itemsForCooldown;
            items.push(item);
            await this.saveItems(interaction.guild.id, items);

            if (requestConfig?.trackingChannelId) {
                const trackingCh = await interaction.guild.channels.fetch(requestConfig.trackingChannelId).catch(() => null);
                if (trackingCh && trackingCh.type === ChannelType.GuildText) {
                    const trackingEmbed = new EmbedBuilder()
                        .setTitle(`新規 Request #${id}`)
                        .setDescription(`**件名:** ${title}\n**ラベル:** ${safeLabel}\n**作成者:** <@${interaction.user.id}>`)
                        .addFields(
                            { name: 'ステータス', value: 'undecided', inline: true },
                            { name: 'チャンネル', value: `<#${requestChannel.id}>`, inline: true },
                            { name: 'URL', value: `https://discord.com/channels/${interaction.guild.id}/${requestChannel.id}`, inline: false }
                        )
                        .setTimestamp();
                    await (trackingCh as TextChannel).send({
                        embeds: [trackingEmbed],
                        components: [
                            new ActionRowBuilder<ButtonBuilder>().addComponents(
                                new ButtonBuilder()
                                    .setStyle(ButtonStyle.Link)
                                    .setLabel('リクエストへ移動')
                                    .setURL(`https://discord.com/channels/${interaction.guild.id}/${requestChannel.id}`)
                            )
                        ]
                    }).catch(() => null);
                }
            }

            await interaction.editReply({ content: `✅ Request を作成しました: <#${requestChannel.id}> (ID: ${id})` });
            return true;
        }

        if (customId.startsWith('corefeature:request:done:')) {
            const itemId = customId.split(':')[3];
            await interaction.deferReply({ ephemeral: true });
            const items = await this.getItems(interaction.guild.id);
            const item = items.find((entry) => entry.id === itemId);
            if (!item) {
                await interaction.editReply({ content: '❌ Request が見つかりません。' });
                return true;
            }
            const reportTitle = interaction.fields.getTextInputValue('title').trim();
            const reportBody = interaction.fields.getTextInputValue('body').trim();
            const imageUrlRaw = interaction.fields.fields.has('imageUrl')
                ? interaction.fields.getTextInputValue('imageUrl').trim()
                : '';
            const imageUrl = /^https?:\/\/\S+$/i.test(imageUrlRaw) ? imageUrlRaw : null;
            item.status = 'done';
            item.updatedAt = new Date().toISOString();
            await this.saveItems(interaction.guild.id, items);

            const requestConfig = await this.getRequestConfig(interaction.guild.id);
            const config = this.api ? await this.api.getPanelConfig(interaction.guild.id, item.panelKind) : null;
            const doneChannelId = requestConfig?.doneChannelId || config?.requestDoneChannelId;
            if (doneChannelId) {
                const doneCh = await interaction.guild.channels.fetch(doneChannelId).catch(() => null);
                if (doneCh && doneCh.type === ChannelType.GuildText) {
                    const doneEmbed = new EmbedBuilder()
                        .setTitle(`Request 完了 #${item.id}`)
                        .setDescription(`**件名:** ${item.title}\n**報告タイトル:** ${reportTitle}\n\n${reportBody}`)
                        .addFields(
                            { name: 'ラベル', value: item.label || '未設定', inline: true },
                            { name: 'Request URL', value: `https://discord.com/channels/${interaction.guild.id}/${item.channelId}`, inline: false }
                        )
                        .setColor(0x2f9e44)
                        .setTimestamp();
                    if (imageUrl) {
                        doneEmbed.setImage(imageUrl);
                    }
                    await (doneCh as TextChannel).send({ embeds: [doneEmbed] });
                }
            }

            await interaction.editReply({ content: '✅ 完了報告を保存しました。' });
            return true;
        }

        return false;
    }

    async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction, panelKind: CoreFeaturePanelKind, action: string, parts: string[]): Promise<boolean> {
        if (!interaction.guild) return false;
        if (action !== 'statusmenu') return false;
        if (!(await isStaffMember(interaction.guild, interaction.user.id))) {
            await interaction.reply({ content: '❌ スタッフのみ操作できます。', ephemeral: true });
            return true;
        }
        const itemId = parts[0];
        const nextStatus = (interaction.values[0] || 'undecided') as RequestStatus;
        const handled = await this.handleButtonInteraction(
            {
                ...interaction,
                customId: `corefeature:${interaction.guild.id}:${panelKind}:request:status:${itemId}:${nextStatus}`
            } as unknown as ButtonInteraction,
            panelKind,
            'status',
            [itemId, nextStatus]
        );
        if (!handled) {
            await interaction.reply({ content: '❌ ステータス更新に失敗しました。', ephemeral: true });
        }
        return true;
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

    private async getRequestConfig(guildId: string): Promise<RequestConfig | null> {
        return await database.get(guildId, `Guild/${guildId}/corefeature/request/config`, null);
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

    private async summarizeConversation(item: RequestItem): Promise<string> {
        try {
            const raw = await requestCoreFeatureModelText([
                { role: 'system', content: '次の会話を短く要約してください。箇条書き3点以内で返してください。' },
                { role: 'user', content: `title=${item.title}\nlabel=${item.label}\nbody=${item.body}` }
            ], 220, 0.3, { requestLabel: 'corepanel-request-conversation-summary' });
            const text = raw.trim();
            if (text.length > 0) {
                return text;
            }
        } catch {
            // fallback
        }
        return `- ${item.title}\n- ${item.label}\n- ${item.body.slice(0, 100)}`;
    }
}
