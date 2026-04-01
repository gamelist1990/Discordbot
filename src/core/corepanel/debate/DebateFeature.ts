import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    Client,
    Guild,
    Message,
    ModalBuilder,
    ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { DebateService } from './DebateService.js';
import { parseStance, truncateText } from '../helpers.js';
import { CoreFeatureApi, CoreFeatureModule } from '../registry.js';
import { CoreFeaturePanelKind, DebateOpponentType } from '../types.js';
import { isStaffMember } from '../guildUtils.js';

export class DebateFeature implements CoreFeatureModule {
    private static readonly ENTRY_TOKEN_TTL_MS = 10 * 60 * 1000;

    readonly key = 'debate';
    readonly order = 20;
    private readonly service = new DebateService();
    private api: CoreFeatureApi | null = null;
    private readonly entryTokens = new Map<string, {
        userId: string;
        guildId: string;
        expiresAt: number;
        timeout: ReturnType<typeof setTimeout>;
    }>();

    register(api: CoreFeatureApi): void {
        this.api = api;
        for (const panelKind of ['combined', 'debate'] as CoreFeaturePanelKind[]) {
            for (const opponentType of ['ai', 'king', 'ai_vs_ai'] as DebateOpponentType[]) {
                api.registerModalRoute(`corefeature:debate:create:${panelKind}:${opponentType}`, async (interaction) => {
                    await this.handleCreateModal(interaction, panelKind, opponentType);
                });
            }
        }
    }

    setClient(client: Client): void {
        this.service.setClient(client);
    }

    buildPanelButton(guildId: string, panelKind: CoreFeaturePanelKind): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(`corefeature:${guildId}:${panelKind}:${this.key}:entry`)
            .setLabel('レスバ')
            .setEmoji('⚔️')
            .setStyle(ButtonStyle.Danger);
    }

    async handleButtonInteraction(interaction: ButtonInteraction, panelKind: CoreFeaturePanelKind, action: string, parts: string[]): Promise<boolean> {
        if (!interaction.guild) {
            return false;
        }

        if (action === 'entry') {
            const staff = await isStaffMember(interaction.guild, interaction.user.id);
            const token = this.issueEntryToken(interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: staff
                    ? '対戦形式を選んでください。スタッフは AI vs AI の観戦用マッチも作成できます。'
                    : '対戦形式を選んでください。AI 対戦は誰でも、論破王対戦は論破王のみ作成できます。',
                components: this.buildModeRows(interaction.guild.id, panelKind, staff, token),
                ephemeral: true
            });
            return true;
        }

        if (action === 'choose') {
            const token = parts[0];
            const opponentType = parts[1] as DebateOpponentType;
            if (!this.consumeEntryToken(token, interaction.guild.id, interaction.user.id)) {
                throw new Error('この対戦選択メニューは期限切れか、すでに使用済みです。もう一度「レスバ」ボタンを押してください。');
            }

            if (!['ai', 'king', 'ai_vs_ai'].includes(opponentType)) {
                throw new Error('不明な対戦形式です。');
            }

            if (opponentType === 'ai_vs_ai' && !(await isStaffMember(interaction.guild, interaction.user.id))) {
                throw new Error('AI vs AI のレスバはスタッフのみ作成できます。');
            }

            await interaction.showModal(this.buildSetupModal(panelKind, opponentType));
            return true;
        }

        if (action === 'join') {
            const sessionId = parts[0];
            if (!sessionId) {
                throw new Error('セッションIDがありません。');
            }

            await this.service.joinKingDebate(interaction as any, sessionId);
            return true;
        }

        return false;
    }

    async handleMessage(message: Message): Promise<boolean> {
        return this.service.onMessage(message);
    }

    async closeSessions(guild: Guild, options: { channelId?: string; reason: string }) {
        const closed = await this.service.closeSessions(guild, options);
        return closed.map((entry) => ({
            featureKey: this.key,
            sessionId: entry.sessionId,
            channelId: entry.channelId,
            summary: entry.summary
        }));
    }

    async resetUserData(guild: Guild, userId: string, reason: string) {
        const result = await this.service.resetUserData(guild, userId, reason);
        if (!result) {
            return null;
        }
        return {
            featureKey: this.key,
            summary: result.summary
        };
    }

    private buildModeRows(guildId: string, panelKind: CoreFeaturePanelKind, includeStaffModes: boolean, token: string): ActionRowBuilder<ButtonBuilder>[] {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`corefeature:${guildId}:${panelKind}:debate:choose:${token}:ai`)
                .setLabel('AIと対戦')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`corefeature:${guildId}:${panelKind}:debate:choose:${token}:king`)
                .setLabel('論破王と対戦')
                .setStyle(ButtonStyle.Secondary)
        );

        if (includeStaffModes) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`corefeature:${guildId}:${panelKind}:debate:choose:${token}:ai_vs_ai`)
                    .setLabel('AI vs AI')
                    .setStyle(ButtonStyle.Success)
            );
        }

        return [row];
    }

    private buildSetupModal(panelKind: CoreFeaturePanelKind, opponentType: DebateOpponentType): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(`corefeature:debate:create:${panelKind}:${opponentType}`)
            .setTitle(
                opponentType === 'ai'
                    ? 'AIレスバ作成'
                    : opponentType === 'king'
                        ? '論破王レスバ作成'
                        : 'AI vs AI レスバ作成'
            );

        const topicInput = new TextInputBuilder()
            .setCustomId('topic')
            .setLabel('お題')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('例: 学校の制服は必要か')
            .setRequired(true)
            .setMaxLength(300);

        const stanceInput = new TextInputBuilder()
            .setCustomId('stance')
            .setLabel(opponentType === 'ai_vs_ai' ? '先行AIの陣営 (賛成 / 反対)' : '自分の陣営 (賛成 / 反対)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('賛成 もしくは 反対')
            .setRequired(true)
            .setMaxLength(20);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(topicInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(stanceInput)
        );

        return modal;
    }

    private issueEntryToken(guildId: string, userId: string): string {
        const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        const timeout = setTimeout(() => {
            this.entryTokens.delete(token);
        }, DebateFeature.ENTRY_TOKEN_TTL_MS);

        timeout.unref?.();
        this.entryTokens.set(token, {
            userId,
            guildId,
            expiresAt: Date.now() + DebateFeature.ENTRY_TOKEN_TTL_MS,
            timeout
        });
        return token;
    }

    private consumeEntryToken(token: string | undefined, guildId: string, userId: string): boolean {
        if (!token) {
            return false;
        }

        const record = this.entryTokens.get(token);
        if (!record) {
            return false;
        }

        clearTimeout(record.timeout);
        this.entryTokens.delete(token);
        return (
            record.guildId === guildId
            && record.userId === userId
            && record.expiresAt > Date.now()
        );
    }

    private async handleCreateModal(interaction: ModalSubmitInteraction, panelKind: CoreFeaturePanelKind, opponentType: DebateOpponentType): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: '❌ サーバー内でのみ使えます。', ephemeral: true });
            return;
        }

        if (opponentType === 'ai_vs_ai' && !(await isStaffMember(interaction.guild, interaction.user.id))) {
            await interaction.reply({
                content: '❌ AI vs AI のレスバはスタッフのみ作成できます。',
                ephemeral: true
            });
            return;
        }

        const topic = truncateText(interaction.fields.getTextInputValue('topic'), 280);
        const stance = parseStance(interaction.fields.getTextInputValue('stance'));

        if (!stance) {
            await interaction.reply({
                content: '❌ 陣営は「賛成」か「反対」で入力してください。',
                ephemeral: true
            });
            return;
        }

        try {
            const panelConfig = this.api ? await this.api.getPanelConfig(interaction.guild.id, panelKind) : null;
            const session = await this.service.createSession(
                interaction.guild,
                interaction.user.id,
                opponentType,
                topic,
                stance,
                panelConfig?.spectatorRoleId || null
            );

            await interaction.reply({
                content: `✅ レスバ部屋を作成しました: <#${session.channelId}>`,
                ephemeral: true
            });
        } catch (error) {
            await interaction.reply({
                content: `❌ ${error instanceof Error ? error.message : 'レスバ部屋の作成に失敗しました。'}`,
                ephemeral: true
            });
        }
    }
}
