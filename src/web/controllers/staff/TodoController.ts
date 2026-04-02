import { Request, Response } from 'express';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { BotClient } from '../../../core/BotClient.js';
import { SettingsSession } from '../../types/index.js';
import { buildTodoMessagePayload } from '../../../core/todo/TodoMessageManager.js';
import {
    createEmptyBoard,
    getTodoBoardByChannel,
    getGuildTodoBoards,
    normalizeBoard,
    normalizeTags,
    saveTodoBoard,
    updateTodoBoardMessageId,
    TodoBoardSnapshot,
    TODO_MAX_BOARDS_PER_GUILD
} from '../../../core/todo/TodoStorage.js';

type SessionLike = SettingsSession & {
    guilds?: Array<{ id?: string; guildId?: string }>;
};

type TodoMessageSnapshot = {
    messageId: string | null;
    jumpUrl: string | null;
    board: TodoBoardSnapshot;
    updatedAt: string;
    updatedBy: string;
    embedCount: number;
};

export class TodoController {
    constructor(private botClient: BotClient) {}

    getTodo = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, channelId } = req.params;
            const session = (req as any).session as SessionLike;

            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const channelResult = await resolveTodoChannel(guild, channelId);
            if (!channelResult.ok) {
                res.status(channelResult.status).json({ error: channelResult.error });
                return;
            }

            const board = await getTodoBoardByChannel(guildId, channelId);
            const todo = board ? await this.toSnapshot(guild, channelResult.channel, board) : null;
            const boards = await getGuildTodoBoards(guildId);

            res.json({
                guild: {
                    id: guild.id,
                    name: guild.name,
                    icon: guild.iconURL()
                },
                channel: {
                    id: channelResult.channel.id,
                    name: channelResult.channel.name,
                    type: channelResult.channel.type
                },
                todo,
                boardLimit: TODO_MAX_BOARDS_PER_GUILD,
                boardCount: boards.length,
                accessPath: `/todo/${guild.id}/${channelResult.channel.id}`
            });
        } catch (error) {
            console.error('TodoController.getTodo failed:', error);
            res.status(500).json({ error: 'Failed to load todo' });
        }
    };

    upsertTodo = async (req: Request, res: Response): Promise<void> => {
        try {
            const { guildId, channelId } = req.params;
            const session = (req as any).session as SessionLike;

            if (!session || !hasAccessToGuild(session, guildId)) {
                res.status(403).json({ error: 'Access denied to this guild' });
                return;
            }

            const guild = await this.botClient.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                res.status(404).json({ error: 'Guild not found' });
                return;
            }

            const actor = await requireTodoActor(guild, session.userId);
            if (!actor.ok) {
                res.status(actor.status).json({ error: actor.error });
                return;
            }

            const channelResult = await resolveTodoChannel(guild, channelId);
            if (!channelResult.ok) {
                res.status(channelResult.status).json({ error: channelResult.error });
                return;
            }

            const existing = await getTodoBoardByChannel(guildId, channelId);
            const body = (req.body || {}) as Partial<TodoBoardSnapshot>;
            const merged = normalizeBoard({
                ...(existing || createEmptyBoard(guildId, channelId, (body.title as string | undefined) || 'Project Todo')),
                ...body,
                guildId,
                channelId,
                items: Array.isArray(body.items)
                    ? body.items.map((item) => ({
                        ...item,
                        tags: normalizeTags(Array.isArray(item.tags) ? item.tags.join(' ') : `${item.tags || ''}`)
                    }))
                    : existing?.items || [],
                updatedAt: new Date().toISOString(),
                updatedBy: actor.member.displayName
            }, guildId, channelId);

            const savedBoard = await saveTodoBoard(merged);
            const payload = buildTodoMessagePayload(savedBoard, {
                guildName: guild.name,
                channelName: channelResult.channel.name
            });

            const existingMessage = savedBoard.messageId
                ? await channelResult.channel.messages.fetch(savedBoard.messageId).catch(() => null)
                : null;

            const message = existingMessage
                ? await existingMessage.edit(payload)
                : await channelResult.channel.send(payload);

            const finalBoard = await updateTodoBoardMessageId(guildId, channelId, message.id) || savedBoard;
            const todo = await this.toSnapshot(guild, channelResult.channel, finalBoard);
            const boards = await getGuildTodoBoards(guildId);

            res.json({
                success: true,
                todo,
                boardLimit: TODO_MAX_BOARDS_PER_GUILD,
                boardCount: boards.length,
                accessPath: `/todo/${guild.id}/${channelResult.channel.id}`
            });
        } catch (error) {
            console.error('TodoController.upsertTodo failed:', error);
            res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save todo' });
        }
    };

    private async toSnapshot(guild: any, channel: any, board: TodoBoardSnapshot): Promise<TodoMessageSnapshot> {
        const message = board.messageId ? await channel.messages.fetch(board.messageId).catch(() => null) : null;
        return {
            messageId: board.messageId,
            jumpUrl: message?.url || (board.messageId ? `https://discord.com/channels/${guild.id}/${channel.id}/${board.messageId}` : null),
            board,
            updatedAt: board.updatedAt,
            updatedBy: board.updatedBy,
            embedCount: message?.embeds.length || 0
        };
    }
}

async function resolveTodoChannel(guild: any, channelId: string) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        return { ok: false as const, status: 404, error: 'Channel not found' };
    }

    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return { ok: false as const, status: 400, error: 'Todo supports text and announcement channels only' };
    }

    if (!('messages' in channel) || !('send' in channel)) {
        return { ok: false as const, status: 400, error: 'Channel does not support todo posting' };
    }

    return { ok: true as const, channel };
}

async function requireTodoActor(guild: any, userId: string) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        return { ok: false as const, status: 403, error: 'Guild member not found' };
    }

    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember) {
        return { ok: false as const, status: 403, error: 'Bot member not found' };
    }

    const userCanManage = member.permissions.has(PermissionFlagsBits.Administrator)
        || member.permissions.has(PermissionFlagsBits.ManageGuild)
        || member.permissions.has(PermissionFlagsBits.ManageChannels);
    if (!userCanManage) {
        return { ok: false as const, status: 403, error: 'Manage Guild or Manage Channels permission is required' };
    }

    const botCanManage = botMember.permissions.has(PermissionFlagsBits.ViewChannel)
        && botMember.permissions.has(PermissionFlagsBits.SendMessages)
        && botMember.permissions.has(PermissionFlagsBits.EmbedLinks);
    if (!botCanManage) {
        return { ok: false as const, status: 403, error: 'Bot lacks the required permissions for todo posting' };
    }

    return { ok: true as const, member };
}

function hasAccessToGuild(session: SessionLike, guildId: string): boolean {
    try {
        if (!guildId) return false;
        if (session.guildId && session.guildId === guildId) return true;
        if (Array.isArray(session.guildIds) && session.guildIds.includes(guildId)) return true;
        if (Array.isArray(session.guilds) && session.guilds.some((g) => g && (g.id === guildId || g.guildId === guildId))) return true;
        if (Array.isArray(session.permissions) && session.permissions.some((p) => p && p.guildId === guildId)) return true;
    } catch {
        return false;
    }
    return false;
}
