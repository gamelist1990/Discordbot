import {
    AttachmentBuilder,
    Client,
    EmbedBuilder,
    Events,
    type GuildTextBasedChannel,
    type Message,
} from 'discord.js';
import { Logger } from '../../utils/Logger.js';
import {
    EMBED_IMAGE_NAME,
    EMBED_TITLE,
    OFFLINE_COLOR,
    ONLINE_COLOR,
    POLL_INTERVAL_MS,
    REQUEST_TIMEOUT_MS,
    STATUS_IMAGE_URL,
    TARGET_CHANNEL_ID,
    TARGET_GUILD_ID,
} from './constants.js';
import { formatTimestamp } from './formatters.js';
import { buildOfflineStatusImage } from './offlineImage.js';
import { loadIntegrationState, saveIntegrationState } from './stateStore.js';
import type { IntegrationState, StatusSnapshot } from './types.js';

export class Guild890315487962095637ServerStatusIntegration {
    private client: Client | null = null;
    private interval: NodeJS.Timeout | null = null;
    private state: IntegrationState = { messageId: null, lastOnlineAt: null };
    private started = false;
    private isSyncing = false;

    async initialize(client: Client): Promise<void> {
        if (this.started || this.client) {
            return;
        }

        this.client = client;
        this.state = await loadIntegrationState();

        if (client.isReady()) {
            await this.start();
            return;
        }

        client.once(Events.ClientReady, () => {
            void this.start();
        });
    }

    async destroy(): Promise<void> {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        this.started = false;
    }

    private async start(): Promise<void> {
        if (!this.client || this.started) {
            return;
        }

        this.started = true;
        Logger.info('[Guild890315487962095637] Starting server status integration');

        await this.syncStatusMessage();
        this.interval = setInterval(() => {
            void this.syncStatusMessage();
        }, POLL_INTERVAL_MS);
    }

    private async syncStatusMessage(): Promise<void> {
        if (!this.client || this.isSyncing) {
            return;
        }

        this.isSyncing = true;

        try {
            const channel = await this.resolveChannel();
            if (!channel) {
                return;
            }

            const snapshot = await this.createSnapshot();
            const payload = this.buildMessagePayload(snapshot);
            const existingMessage = await this.resolveMessage(channel);

            if (existingMessage) {
                await existingMessage.edit({
                    ...payload,
                    attachments: [],
                });
            } else {
                const message = await channel.send(payload);
                this.state.messageId = message.id;
            }

            if (snapshot.status === 'online') {
                this.state.lastOnlineAt = snapshot.lastOnlineAt;
            }

            await saveIntegrationState(this.state);
        } catch (error) {
            Logger.error('[Guild890315487962095637] Failed to sync server status message:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    private async resolveChannel(): Promise<GuildTextBasedChannel | null> {
        if (!this.client) {
            return null;
        }

        const guild = await this.client.guilds.fetch(TARGET_GUILD_ID).catch(() => null);
        if (!guild) {
            Logger.warn(`[Guild890315487962095637] Guild ${TARGET_GUILD_ID} is not available`);
            return null;
        }

        const rawChannel = await guild.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
        if (!rawChannel || !rawChannel.isTextBased()) {
            Logger.warn(`[Guild890315487962095637] Channel ${TARGET_CHANNEL_ID} is not text-based`);
            return null;
        }

        return rawChannel as GuildTextBasedChannel;
    }

    private async resolveMessage(channel: GuildTextBasedChannel): Promise<Message | null> {
        if (!this.state.messageId) {
            return null;
        }

        const message = await channel.messages.fetch(this.state.messageId).catch(() => null);
        if (!message) {
            this.state.messageId = null;
        }

        return message;
    }

    private async createSnapshot(): Promise<StatusSnapshot> {
        const checkedAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(STATUS_IMAGE_URL, {
                signal: controller.signal,
                headers: {
                    'cache-control': 'no-cache',
                    pragma: 'no-cache',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
            if (!contentType.startsWith('image/')) {
                throw new Error(`Unexpected content-type: ${contentType || 'unknown'}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            if (arrayBuffer.byteLength === 0) {
                throw new Error('Received an empty image');
            }

            return {
                status: 'online',
                checkedAt,
                imageBuffer: Buffer.from(arrayBuffer),
                lastOnlineAt: checkedAt,
            };
        } catch (error) {
            return {
                status: 'offline',
                checkedAt,
                imageBuffer: buildOfflineStatusImage(this.state.lastOnlineAt, checkedAt),
                lastOnlineAt: this.state.lastOnlineAt,
                failureReason: error instanceof Error ? error.message : String(error),
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    private buildMessagePayload(snapshot: StatusSnapshot) {
        const failureSuffix = snapshot.failureReason
            ? ` | ${snapshot.failureReason.slice(0, 120)}`
            : '';
        const attachment = new AttachmentBuilder(snapshot.imageBuffer, {
            name: EMBED_IMAGE_NAME,
        });

        const embed = new EmbedBuilder()
            .setColor(snapshot.status === 'online' ? ONLINE_COLOR : OFFLINE_COLOR)
            .setTitle(EMBED_TITLE)
            .setDescription(
                snapshot.status === 'online'
                    ? 'Latest server status image.'
                    : 'The monitored server is currently unavailable.',
            )
            .addFields(
                {
                    name: 'Status',
                    value: snapshot.status === 'online' ? 'Online' : 'Offline',
                    inline: true,
                },
                {
                    name: 'Last Online',
                    value: formatTimestamp(snapshot.lastOnlineAt),
                    inline: true,
                },
                {
                    name: 'Checked At',
                    value: formatTimestamp(snapshot.checkedAt),
                    inline: true,
                },
            )
            .setImage(`attachment://${EMBED_IMAGE_NAME}`)
            .setFooter({
                text:
                    snapshot.status === 'online'
                        ? 'Updates every 60 seconds'
                        : `Retrying every 60 seconds${failureSuffix}`,
            })
            .setTimestamp(new Date(snapshot.checkedAt));

        return {
            embeds: [embed],
            files: [attachment],
        };
    }
}
