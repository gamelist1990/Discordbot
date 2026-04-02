import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    Client,
    Guild,
    ModalSubmitInteraction,
    Message,
    StringSelectMenuInteraction
} from 'discord.js';
import { CoreFeaturePanelConfig, CoreFeaturePanelKind } from './types.js';

export interface CoreFeatureApi {
    getClient(): Client | null;
    getPanelConfig(guildId: string, panelKind?: CoreFeaturePanelKind): Promise<CoreFeaturePanelConfig | null>;
    listPanelConfigs(guildId: string): Promise<Partial<Record<CoreFeaturePanelKind, CoreFeaturePanelConfig>>>;
    savePanelConfig(guildId: string, config: CoreFeaturePanelConfig, panelKind?: CoreFeaturePanelKind): Promise<void>;
    registerModalRoute(customId: string, handler: (interaction: ModalSubmitInteraction) => Promise<void>): void;
}

export interface CoreFeatureCloseResult {
    featureKey: string;
    sessionId: string;
    channelId: string;
    summary: string;
}

export interface CoreFeatureResetResult {
    featureKey: string;
    summary: string;
}

export interface CoreFeatureModule {
    key: string;
    order?: number;
    register?(api: CoreFeatureApi): void | Promise<void>;
    setClient?(client: Client): void;
    buildPanelButton(guildId: string, panelKind: CoreFeaturePanelKind): ButtonBuilder;
    closeSessions?(guild: Guild, options: { channelId?: string; reason: string }): Promise<CoreFeatureCloseResult[]>;
    resetUserData?(guild: Guild, userId: string, reason: string): Promise<CoreFeatureResetResult | null>;
    handleButtonInteraction?(interaction: ButtonInteraction, panelKind: CoreFeaturePanelKind, action: string, parts: string[]): Promise<boolean>;
    handleSelectMenuInteraction?(interaction: StringSelectMenuInteraction, panelKind: CoreFeaturePanelKind, action: string, parts: string[]): Promise<boolean>;
    handleMessage?(message: Message): Promise<boolean>;
    handleModalSubmit?(interaction: ModalSubmitInteraction, customId: string): Promise<boolean>;
}

export function buildPanelRowsFromFeatures(
    guildId: string,
    panelKind: CoreFeaturePanelKind,
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

        currentRow.addComponents(feature.buildPanelButton(guildId, panelKind));
    }

    if (currentRow.components.length > 0) {
        rows.push(currentRow);
    }

    return rows;
}
