import { ButtonBuilder, ButtonInteraction, ButtonStyle, Client, Message } from 'discord.js';
import { PersonalityService } from './PersonalityService.js';
import { CoreFeatureModule } from '../registry.js';

export class PersonalityFeature implements CoreFeatureModule {
    readonly key = 'personality';
    readonly order = 10;
    private readonly service = new PersonalityService();

    setClient(client: Client): void {
        this.service.setClient(client);
    }

    buildPanelButton(guildId: string): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(`corefeature:${guildId}:${this.key}:entry`)
            .setLabel('性格診断')
            .setEmoji('🧠')
            .setStyle(ButtonStyle.Primary);
    }

    async handleButtonInteraction(interaction: ButtonInteraction, action: string): Promise<boolean> {
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
}
