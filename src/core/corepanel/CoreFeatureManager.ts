import {
    ButtonInteraction,
    Client,
    Guild,
    Message,
    ModalSubmitInteraction,
    StringSelectMenuInteraction
} from 'discord.js';
import { database } from '../Database.js';
import { registerModalHandler } from '../../utils/Modal.js';
import { createDebateFeature } from './debate/index.js';
import { createPersonalityFeature } from './personality/index.js';
import { createRequestFeature } from './request/index.js';
import {
    buildPanelRowsFromFeatures,
    CoreFeatureApi,
    CoreFeatureCloseResult,
    CoreFeatureModule,
    CoreFeatureResetResult
} from './registry.js';
import { CoreFeaturePanelConfig, CoreFeaturePanelKind } from './types.js';

export type { DebateOpponentType } from './types.js';

function getLegacyPanelKey(guildId: string): string {
    return `Guild/${guildId}/corefeature/panel`;
}

function getPanelMapKey(guildId: string): string {
    return `Guild/${guildId}/corefeature/panels`;
}

function isPanelKind(value: string): value is CoreFeaturePanelKind {
    return ['combined', 'personality', 'debate', 'request'].includes(value);
}

function normalizePanelConfig(
    panelKind: CoreFeaturePanelKind,
    config: Partial<CoreFeaturePanelConfig> | null | undefined
): CoreFeaturePanelConfig | null {
    if (!config || typeof config.guildId !== 'string' || typeof config.channelId !== 'string') {
        return null;
    }

    return {
        panelKind,
        guildId: config.guildId,
        channelId: config.channelId,
        messageId: typeof config.messageId === 'string' ? config.messageId : null,
        spectatorRoleId: typeof config.spectatorRoleId === 'string' ? config.spectatorRoleId : null,
        requestCategoryName: typeof config.requestCategoryName === 'string' ? config.requestCategoryName : null,
        requestLabels: Array.isArray(config.requestLabels)
            ? config.requestLabels.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean).slice(0, 20)
            : undefined,
        requestDoneChannelId: typeof config.requestDoneChannelId === 'string' ? config.requestDoneChannelId : null,
        requestStaffRoleId: typeof config.requestStaffRoleId === 'string' ? config.requestStaffRoleId : null,
        requestTrackingChannelId: typeof config.requestTrackingChannelId === 'string' ? config.requestTrackingChannelId : null,
        updatedBy: typeof config.updatedBy === 'string' ? config.updatedBy : 'unknown',
        updatedAt: typeof config.updatedAt === 'string' ? config.updatedAt : new Date(0).toISOString()
    };
}

export class CoreFeatureManager implements CoreFeatureApi {
    private client: Client | null = null;
    private readonly features = new Map<string, CoreFeatureModule>();

    constructor() {
        this.registerFeature(createPersonalityFeature());
        this.registerFeature(createDebateFeature());
        this.registerFeature(createRequestFeature());
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

    async getPanelConfig(guildId: string, panelKind: CoreFeaturePanelKind = 'combined'): Promise<CoreFeaturePanelConfig | null> {
        const stored = await database.get<Partial<Record<CoreFeaturePanelKind, CoreFeaturePanelConfig>> | null>(guildId, getPanelMapKey(guildId), null);
        const fromMap = normalizePanelConfig(panelKind, stored?.[panelKind]);
        if (fromMap) {
            return fromMap;
        }

        if (panelKind === 'combined') {
            const legacy = await database.get<CoreFeaturePanelConfig | null>(guildId, getLegacyPanelKey(guildId), null);
            return normalizePanelConfig('combined', legacy);
        }

        return null;
    }

    async listPanelConfigs(guildId: string): Promise<Partial<Record<CoreFeaturePanelKind, CoreFeaturePanelConfig>>> {
        const stored = await database.get<Partial<Record<CoreFeaturePanelKind, CoreFeaturePanelConfig>> | null>(guildId, getPanelMapKey(guildId), null);
        const result: Partial<Record<CoreFeaturePanelKind, CoreFeaturePanelConfig>> = {};

        for (const panelKind of ['combined', 'personality', 'debate', 'request'] as CoreFeaturePanelKind[]) {
            const normalized = normalizePanelConfig(panelKind, stored?.[panelKind]);
            if (normalized) {
                result[panelKind] = normalized;
            }
        }

        if (!result.combined) {
            const legacy = await database.get<CoreFeaturePanelConfig | null>(guildId, getLegacyPanelKey(guildId), null);
            const normalizedLegacy = normalizePanelConfig('combined', legacy);
            if (normalizedLegacy) {
                result.combined = normalizedLegacy;
            }
        }

        return result;
    }

    async savePanelConfig(guildId: string, config: CoreFeaturePanelConfig, panelKind: CoreFeaturePanelKind = config.panelKind): Promise<void> {
        const current = await this.listPanelConfigs(guildId);
        const next: Partial<Record<CoreFeaturePanelKind, CoreFeaturePanelConfig>> = {
            ...current,
            [panelKind]: {
                ...config,
                panelKind
            }
        };

        await database.set(guildId, getPanelMapKey(guildId), next);
        if (panelKind === 'combined') {
            await database.set(guildId, getLegacyPanelKey(guildId), next.combined);
        }
    }

    buildPanelRows(guildId: string, panelKind: CoreFeaturePanelKind = 'combined') {
        return buildPanelRowsFromFeatures(guildId, panelKind, this.getFeaturesForPanel(panelKind));
    }

    async handleButtonInteraction(interaction: ButtonInteraction): Promise<boolean> {
        return this.handleComponentInteraction(interaction, 'button');
    }

    async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<boolean> {
        return this.handleComponentInteraction(interaction, 'select');
    }

    private async handleComponentInteraction(
        interaction: ButtonInteraction | StringSelectMenuInteraction,
        kind: 'button' | 'select'
    ): Promise<boolean> {
        if (!interaction.customId.startsWith('corefeature:')) {
            return false;
        }

        const parts = interaction.customId.split(':');
        const guildId = parts[1];
        const usesNewFormat = parts.length >= 5 && isPanelKind(parts[2] || '') && this.features.has(parts[3] || '');
        const panelKind = usesNewFormat ? parts[2] as CoreFeaturePanelKind : 'combined';
        const featureKey = usesNewFormat ? parts[3] : parts[2];
        const action = usesNewFormat ? (parts[4] || '') : (parts[3] || '');
        const rest = usesNewFormat ? parts.slice(5) : parts.slice(4);

        if (!interaction.guild || interaction.guild.id !== guildId) {
            await interaction.reply({
                content: '❌ このパネルは別のサーバー用です。',
                ephemeral: true
            });
            return true;
        }

        const feature = this.features.get(featureKey);
        if (kind === 'select') {
            if (!feature?.handleSelectMenuInteraction) {
                return false;
            }
            return feature.handleSelectMenuInteraction(interaction as StringSelectMenuInteraction, panelKind, action, rest);
        }

        if (!feature?.handleButtonInteraction) {
            return false;
        }
        return feature.handleButtonInteraction(interaction as ButtonInteraction, panelKind, action, rest);
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

    async onModalSubmit(interaction: ModalSubmitInteraction): Promise<boolean> {
        for (const feature of this.features.values()) {
            if (!feature.handleModalSubmit) {
                continue;
            }
            const handled = await feature.handleModalSubmit(interaction, interaction.customId);
            if (handled) {
                return true;
            }
        }
        return false;
    }

    async closeSessions(
        guild: Guild,
        options: { channelId?: string; panelKind?: CoreFeaturePanelKind; reason: string }
    ): Promise<CoreFeatureCloseResult[]> {
        const panelKind = options.panelKind || 'combined';
        const results: CoreFeatureCloseResult[] = [];

        for (const feature of this.getFeaturesForPanel(panelKind)) {
            if (!feature.closeSessions) {
                continue;
            }

            const closed = await feature.closeSessions(guild, {
                channelId: options.channelId,
                reason: options.reason
            });
            results.push(...closed);
        }

        return results;
    }

    async resetUserData(
        guild: Guild,
        options: { userId: string; panelKind?: CoreFeaturePanelKind; reason: string }
    ): Promise<CoreFeatureResetResult[]> {
        const panelKind = options.panelKind || 'combined';
        const results: CoreFeatureResetResult[] = [];

        for (const feature of this.getFeaturesForPanel(panelKind)) {
            if (!feature.resetUserData) {
                continue;
            }

            const resetResult = await feature.resetUserData(guild, options.userId, options.reason);
            if (resetResult) {
                results.push(resetResult);
            }
        }

        return results;
    }

    private getFeaturesForPanel(panelKind: CoreFeaturePanelKind): CoreFeatureModule[] {
        const features = Array.from(this.features.values());
        if (panelKind === 'combined') {
            return features;
        }

        return features.filter((feature) => feature.key === panelKind);
    }
}

const GLOBAL_KEY = '__coreFeatureManager_v5';
if (!(global as any)[GLOBAL_KEY]) {
    (global as any)[GLOBAL_KEY] = new CoreFeatureManager();
}

export const coreFeatureManager: CoreFeatureManager = (global as any)[GLOBAL_KEY];
