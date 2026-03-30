import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    Client,
    Message,
    ModalBuilder,
    ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { DebateService } from './DebateService.js';
import { parseStance, truncateText } from '../helpers.js';
import { CoreFeatureApi, CoreFeatureModule } from '../registry.js';
import { DebateOpponentType } from '../types.js';
import { isStaffMember } from '../guildUtils.js';

export class DebateFeature implements CoreFeatureModule {
    readonly key = 'debate';
    readonly order = 20;
    private readonly service = new DebateService();
    private api: CoreFeatureApi | null = null;

    register(api: CoreFeatureApi): void {
        this.api = api;
        api.registerModalRoute('corefeature:debate:create:ai', async (interaction) => {
            await this.handleCreateModal(interaction, 'ai');
        });
        api.registerModalRoute('corefeature:debate:create:king', async (interaction) => {
            await this.handleCreateModal(interaction, 'king');
        });
        api.registerModalRoute('corefeature:debate:create:ai_vs_ai', async (interaction) => {
            await this.handleCreateModal(interaction, 'ai_vs_ai');
        });
    }

    setClient(client: Client): void {
        this.service.setClient(client);
    }

    buildPanelButton(guildId: string): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(`corefeature:${guildId}:${this.key}:entry`)
            .setLabel('れすば')
            .setEmoji('⚔️')
            .setStyle(ButtonStyle.Danger);
    }

    async handleButtonInteraction(interaction: ButtonInteraction, action: string, parts: string[]): Promise<boolean> {
        if (!interaction.guild) {
            return false;
        }

        if (action === 'entry') {
            const staff = await isStaffMember(interaction.guild, interaction.user.id);
            await interaction.reply({
                content: staff
                    ? '対戦形式を選んでください。スタッフは AI vs AI の観戦用マッチも作成できます。'
                    : '対戦形式を選んでください。AI 対戦は誰でも、論破王対戦は論破王のみ作成できます。',
                components: this.buildModeRows(interaction.guild.id, staff),
                ephemeral: true
            });
            return true;
        }

        if (action === 'choose') {
            const opponentType = parts[0] as DebateOpponentType;
            if (!['ai', 'king', 'ai_vs_ai'].includes(opponentType)) {
                throw new Error('不明な対戦形式です。');
            }

            if (opponentType === 'ai_vs_ai' && !(await isStaffMember(interaction.guild, interaction.user.id))) {
                throw new Error('AI vs AI のれすばはスタッフのみ作成できます。');
            }

            await interaction.showModal(this.buildSetupModal(opponentType));
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

    private buildModeRows(guildId: string, includeStaffModes: boolean): ActionRowBuilder<ButtonBuilder>[] {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`corefeature:${guildId}:debate:choose:ai`)
                .setLabel('AIと対戦')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`corefeature:${guildId}:debate:choose:king`)
                .setLabel('論破王と対戦')
                .setStyle(ButtonStyle.Secondary)
        );

        if (includeStaffModes) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`corefeature:${guildId}:debate:choose:ai_vs_ai`)
                    .setLabel('AI vs AI')
                    .setStyle(ButtonStyle.Success)
            );
        }

        return [row];
    }

    private buildSetupModal(opponentType: DebateOpponentType): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(`corefeature:debate:create:${opponentType}`)
            .setTitle(
                opponentType === 'ai'
                    ? 'AIれすば作成'
                    : opponentType === 'king'
                        ? '論破王れすば作成'
                        : 'AI vs AI れすば作成'
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

    private async handleCreateModal(interaction: ModalSubmitInteraction, opponentType: DebateOpponentType): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: '❌ サーバー内でのみ使えます。', ephemeral: true });
            return;
        }

        if (opponentType === 'ai_vs_ai' && !(await isStaffMember(interaction.guild, interaction.user.id))) {
            await interaction.reply({
                content: '❌ AI vs AI のれすばはスタッフのみ作成できます。',
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
            const panelConfig = this.api ? await this.api.getPanelConfig(interaction.guild.id) : null;
            const session = await this.service.createSession(
                interaction.guild,
                interaction.user.id,
                opponentType,
                topic,
                stance,
                panelConfig?.spectatorRoleId || null
            );

            await interaction.reply({
                content: `✅ れすば部屋を作成しました: <#${session.channelId}>`,
                ephemeral: true
            });
        } catch (error) {
            await interaction.reply({
                content: `❌ ${error instanceof Error ? error.message : 'れすば部屋の作成に失敗しました。'}`,
                ephemeral: true
            });
        }
    }
}
