import {
    ButtonInteraction,
    Client,
    Message,
    ModalSubmitInteraction
} from 'discord.js';
import { database } from '../Database.js';
import { registerModalHandler } from '../../utils/Modal.js';
import { createDebateFeature } from './debate/index.js';
import { createPersonalityFeature } from './personality/index.js';
import { buildPanelRowsFromFeatures, CoreFeatureApi, CoreFeatureModule } from './registry.js';
import { CoreFeaturePanelConfig } from './types.js';

export type { DebateOpponentType } from './types.js';

function getPanelKey(guildId: string): string {
    return `Guild/${guildId}/corefeature/panel`;
}

export class CoreFeatureManager implements CoreFeatureApi {
    private client: Client | null = null;
    private readonly features = new Map<string, CoreFeatureModule>();

    constructor() {
        this.registerFeature(createPersonalityFeature());
        this.registerFeature(createDebateFeature());
    }

    setClient(client: Client): void {
        this.client = client;
        for (const feature of this.features.values()) {
            feature.setClient?.(client);
        }
    }

    getClient(): Client | null {
        return this.client;
    }

    registerFeature(feature: CoreFeatureModule): void {
        this.features.set(feature.key, feature);
        feature.register?.(this);
        if (this.client) {
            feature.setClient?.(this.client);
        }
    }

    registerModalRoute(customId: string, handler: (interaction: ModalSubmitInteraction) => Promise<void>): void {
        registerModalHandler(customId, handler);
    }

    async getPanelConfig(guildId: string): Promise<CoreFeaturePanelConfig | null> {
        return await database.get<CoreFeaturePanelConfig | null>(guildId, getPanelKey(guildId), null);
    }

    async savePanelConfig(guildId: string, config: CoreFeaturePanelConfig): Promise<void> {
        await database.set(guildId, getPanelKey(guildId), config);
    }

    buildPanelRows(guildId: string) {
        return buildPanelRowsFromFeatures(guildId, Array.from(this.features.values()));
    }

    async handleButtonInteraction(interaction: ButtonInteraction): Promise<boolean> {
        if (!interaction.customId.startsWith('corefeature:')) {
            return false;
        }

        const parts = interaction.customId.split(':');
        const guildId = parts[1];
        const featureKey = parts[2];
        const action = parts[3] || '';
        const rest = parts.slice(4);

        if (!interaction.guild || interaction.guild.id !== guildId) {
            await interaction.reply({
                content: '❌ このパネルは別のサーバー用です。',
                ephemeral: true
            });
            return true;
        }

        const feature = this.features.get(featureKey);
        if (!feature?.handleButtonInteraction) {
            return false;
        }

        return feature.handleButtonInteraction(interaction, action, rest);
    }

    async onMessage(message: Message): Promise<boolean> {
        for (const feature of this.features.values()) {
            if (!feature.handleMessage) {
                continue;
            }

            const handled = await feature.handleMessage(message);
            if (handled) {
                return true;
            }
        }

        return false;
    }
}

const GLOBAL_KEY = '__coreFeatureManager_v3';
if (!(global as any)[GLOBAL_KEY]) {
    (global as any)[GLOBAL_KEY] = new CoreFeatureManager();
}

export const coreFeatureManager: CoreFeatureManager = (global as any)[GLOBAL_KEY];
