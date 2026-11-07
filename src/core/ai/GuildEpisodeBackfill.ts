import { ChannelType, PermissionsBitField, type Client, type TextChannel } from 'discord.js';
import { config } from '../../config.js';
import { Logger } from '../../utils/Logger.js';
import { OpenAIChatManager } from './OpenAIChatManager.js';
import {
    extractGuildEpisodes,
    loadGuildEpisodeStore,
    saveGuildEpisodeStore,
    sanitizeEpisodeText,
    type EpisodeSourceMessage,
} from './GuildEpisodeMemory.js';

/**
 * 出来事の長期記憶の初期構築（バックフィル）。
 *
 * 本番メインギルドの主要テキストチャンネルについて、2026-11-01 以降の履歴を遡って
 * 出来事を抽出し、初期データを作る。起動の少し後にバックグラウンドで少しずつ処理し、
 * 通常運用はブロックしない。チャンネル毎の進捗（読み終えた最古の発言ID）をストアに
 * 保存するため、途中で再起動しても続きから再開でき、出来事の登録自体も発言IDで
 * 冪等なので二重登録にならない。全チャンネルが終わると completedAt が付き、以後は走らない。
 */

export const EPISODE_BACKFILL_GUILD_ID = '890315487962095637';
/** 優先的に処理するメイン雑談チャンネル。 */
const PRIORITY_CHANNEL_ID = '1482537395986501734';
/** 対象範囲の下限（日本時間）。 */
const BACKFILL_SINCE_MS = Date.parse('2026-11-01T00:00:00+09:00');
/** チャンネル毎に遡る発言数の上限（無制限にはしない）。 */
const PER_CHANNEL_SCAN_CAP = 5000;
/** 1ランの抽出対象（この件数たまるか範囲の下限に届いたら抽出して進捗を保存する）。 */
const RUN_MESSAGE_TARGET = 200;
/** 抽出1回あたりの発言数。 */
const EXTRACTION_CHUNK = 40;
const FETCH_DELAY_MS = 350;
const EXTRACTION_DELAY_MS = 600;
const START_DELAY_MS = 45_000;

let started = false;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function buildGenerator() {
    const chatManager = new OpenAIChatManager();
    return async (messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> => {
        const text = await chatManager.generateText(
            messages.map(message => ({ role: message.role, content: sanitizeEpisodeText(message.content) })),
            {
                model: config.pexAi.channelModel || config.pexAi.model,
                strictModel: true,
                maxTokens: 1600,
                priority: 'background',
            },
        );
        return text ?? '';
    };
}

async function processChannel(
    channel: TextChannel,
    generate: (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string>,
): Promise<void> {
    const guildId = channel.guild.id;
    const initial = await loadGuildEpisodeStore(guildId);
    const state = initial.backfill.channels[channel.id];
    if (state?.done) return;
    let before = state?.resumeBeforeId;
    let scanned = state?.messagesScanned ?? 0;
    let addedTotal = state?.episodesAdded ?? 0;
    let buffer: EpisodeSourceMessage[] = [];
    Logger.info(`[EpisodeBackfill] #${channel.name} の処理を開始します（既読 ${scanned} 件から再開）`);

    const flush = async (reachedStart: boolean): Promise<void> => {
        if (buffer.length) {
            const ordered = [...buffer].sort((a, b) => a.at - b.at);
            buffer = [];
            for (let index = 0; index < ordered.length; index += EXTRACTION_CHUNK) {
                const chunk = ordered.slice(index, index + EXTRACTION_CHUNK);
                try {
                    const result = await extractGuildEpisodes(guildId, chunk, 'backfill', generate);
                    addedTotal += result.added;
                } catch (error) {
                    Logger.warn(`[EpisodeBackfill] #${channel.name} の抽出に失敗しました（この塊はスキップします）:`, error);
                }
                if (index + EXTRACTION_CHUNK < ordered.length) await sleep(EXTRACTION_DELAY_MS);
            }
        }
        const store = await loadGuildEpisodeStore(guildId);
        store.backfill.channels[channel.id] = {
            done: reachedStart,
            ...(before ? { resumeBeforeId: before } : {}),
            messagesScanned: scanned,
            episodesAdded: addedTotal,
            updatedAt: new Date().toISOString(),
        };
        await saveGuildEpisodeStore(guildId, store);
    };

    let reachedStart = false;
    while (scanned < PER_CHANNEL_SCAN_CAP && !reachedStart) {
        let page: Awaited<ReturnType<typeof channel.messages.fetch>>;
        try {
            page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        } catch (error) {
            Logger.warn(`[EpisodeBackfill] #${channel.name} の履歴取得に失敗しました（このチャンネルは中断します）:`, error);
            break;
        }
        if (!page.size) { reachedStart = true; break; }
        const messages = Array.from(page.values()).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
        scanned += messages.length;
        for (const message of messages) {
            if (message.createdTimestamp < BACKFILL_SINCE_MS) continue;
            if (message.author.bot || message.webhookId || message.system) continue;
            const content = (message.content ?? '').trim();
            if (!content) continue;
            buffer.push({
                id: message.id,
                at: message.createdTimestamp,
                channelId: channel.id,
                channelName: channel.name,
                authorId: message.author.id,
                authorName: message.member?.displayName || message.author.globalName || message.author.username,
                content,
            });
        }
        const oldest = messages[messages.length - 1];
        before = oldest.id;
        if (oldest.createdTimestamp < BACKFILL_SINCE_MS || messages.length < 100) reachedStart = true;
        if (buffer.length >= RUN_MESSAGE_TARGET || reachedStart) await flush(reachedStart);
        if (!reachedStart) await sleep(FETCH_DELAY_MS);
    }
    if (!reachedStart) {
        // 上限到達で打ち切った場合も、この範囲は処理済みとして記録する（再起動のたびに最初から遡らない）。
        reachedStart = true;
        await flush(true);
        Logger.info(`[EpisodeBackfill] #${channel.name} は走査上限 ${PER_CHANNEL_SCAN_CAP} 件に達したため打ち切りました`);
    }
    Logger.info(`[EpisodeBackfill] #${channel.name} 完了: 走査 ${scanned} 件 / 出来事 +${addedTotal} 件`);
}

async function runBackfill(client: Client): Promise<void> {
    const guild = await client.guilds.fetch(EPISODE_BACKFILL_GUILD_ID).catch(() => null);
    if (!guild) {
        Logger.warn('[EpisodeBackfill] 対象ギルドが見つからないためバックフィルを中止しました');
        return;
    }
    const store = await loadGuildEpisodeStore(guild.id);
    if (store.backfill.completedAt) {
        Logger.info('[EpisodeBackfill] 既に完了しているためスキップします');
        return;
    }
    if (!store.backfill.startedAt) {
        store.backfill.startedAt = new Date().toISOString();
        await saveGuildEpisodeStore(guild.id, store);
    }
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    const channelCollection = guild.channels.cache
        .filter((channel): channel is TextChannel =>
            channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
        .filter(channel => {
            if (!me) return false;
            const permissions = channel.permissionsFor(me);
            return Boolean(permissions?.has(PermissionsBitField.Flags.ViewChannel)
                && permissions?.has(PermissionsBitField.Flags.ReadMessageHistory));
        })
        .sort((a, b) => {
            if (a.id === PRIORITY_CHANNEL_ID) return -1;
            if (b.id === PRIORITY_CHANNEL_ID) return 1;
            return a.position - b.position;
        });
    const channels: TextChannel[] = [...channelCollection.values()];
    Logger.info(`[EpisodeBackfill] ${channels.length} チャンネルを対象に開始します（2026-11-01 以降、#${PRIORITY_CHANNEL_ID} 優先）`);
    const generate = buildGenerator();
    for (const channel of channels) {
        await processChannel(channel, generate).catch(error => {
            Logger.warn(`[EpisodeBackfill] #${channel.name} の処理でエラーが発生しました（次のチャンネルへ進みます）:`, error);
        });
    }
    const finished = await loadGuildEpisodeStore(guild.id);
    const allDone = channels.every(channel => finished.backfill.channels[channel.id]?.done);
    if (allDone) {
        finished.backfill.completedAt = new Date().toISOString();
        await saveGuildEpisodeStore(guild.id, finished);
        Logger.info(`[EpisodeBackfill] 全チャンネル完了: 出来事は合計 ${finished.episodes.length} 件です`);
    } else {
        Logger.info('[EpisodeBackfill] 一部チャンネルが未完了のため、次回起動時に続きから再開します');
    }
}

/** 起動の少し後に一度だけバックフィルを開始する。通常運用はブロックしない。 */
export function startGuildEpisodeBackfill(client: Client): void {
    if (started) return;
    started = true;
    const timer = setTimeout(() => {
        runBackfill(client).catch(error => {
            Logger.warn('[EpisodeBackfill] バックフィルでエラーが発生しました:', error);
        });
    }, START_DELAY_MS);
    timer.unref?.();
}
