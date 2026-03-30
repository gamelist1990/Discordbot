import { ButtonBuilder, ButtonInteraction, ButtonStyle, Client, Guild, Message } from 'discord.js';
import { PersonalityService } from './PersonalityService.js';
import { CoreFeatureModule } from '../registry.js';
import { CoreFeaturePanelKind } from '../types.js';

export class PersonalityFeature implements CoreFeatureModule {
    readonly key = 'personality';
    readonly order = 10;
    private readonly service = new PersonalityService();

    setClient(client: Client): void {
        this.service.setClient(client);
    }

    buildPanelButton(guildId: string, panelKind: CoreFeaturePanelKind): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(`corefeature:${guildId}:${panelKind}:${this.key}:entry`)
            .setLabel('性格診断')
            .setEmoji('🧠')
            .setStyle(ButtonStyle.Primary);
    }

    async handleButtonInteraction(interaction: ButtonInteraction, _panelKind: CoreFeaturePanelKind, action: string): Promise<boolean> {
        if (action !== 'entry' || !interaction.guild) {
            return false;
        }

        await interaction.deferReply({ ephemeral: true });
        const session = await this.service.startSession(interaction.guild, interaction.user.id);
        await interaction.editReply(`✅ 性格診断室を作成しました: <#${session.channelId}>`);
        return true;
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
}
