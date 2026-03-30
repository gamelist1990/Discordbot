import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    Client,
    ModalSubmitInteraction,
    Message
} from 'discord.js';
import { CoreFeaturePanelConfig } from './types.js';

export interface CoreFeatureApi {
    getClient(): Client | null;
    getPanelConfig(guildId: string): Promise<CoreFeaturePanelConfig | null>;
    savePanelConfig(guildId: string, config: CoreFeaturePanelConfig): Promise<void>;
    registerModalRoute(customId: string, handler: (interaction: ModalSubmitInteraction) => Promise<void>): void;
}

export interface CoreFeatureModule {
    key: string;
    order?: number;
    register?(api: CoreFeatureApi): void | Promise<void>;
    setClient?(client: Client): void;
    buildPanelButton(guildId: string): ButtonBuilder;
    handleButtonInteraction?(interaction: ButtonInteraction, action: string, parts: string[]): Promise<boolean>;
    handleMessage?(message: Message): Promise<boolean>;
}

export function buildPanelRowsFromFeatures(
    guildId: string,
    features: CoreFeatureModule[]
): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();

    const sorted = features
        .slice()
        .sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.key.localeCompare(right.key));

    for (const feature of sorted) {
        if (currentRow.components.length >= 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder<ButtonBuilder>();
        }

        currentRow.addComponents(feature.buildPanelButton(guildId));
    }

    if (currentRow.components.length > 0) {
        rows.push(currentRow);
    }

    return rows;
}
