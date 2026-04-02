import { database } from '../Database.js';

export type TodoItemStatus = 'todo' | 'doing' | 'review' | 'blocked' | 'done';
export type TodoItemPriority = 'low' | 'medium' | 'high' | 'critical';

export type TodoItem = {
    id: string;
    title: string;
    status: TodoItemStatus;
    priority: TodoItemPriority;
    progress: number;
    summary: string;
    details: string;
    assignee: string;
    dueDate: string | null;
    tags: string[];
    createdAt: string;
    updatedAt: string;
};

export type TodoBoardSnapshot = {
    version: 3;
    guildId: string;
    channelId: string;
    messageId: string | null;
    title: string;
    summary: string;
    items: TodoItem[];
    updatedAt: string;
    updatedBy: string;
};

type TodoBoardCollection = {
    guildId: string;
    boards: TodoBoardSnapshot[];
};

export const TODO_MAX_BOARDS_PER_GUILD = 2;
export const TODO_MAX_ITEMS_PER_BOARD = 10;
export const TODO_MAX_DETAIL_LENGTH = 1000;
const TODO_MAX_TITLE_LENGTH = 120;
const TODO_MAX_SUMMARY_LENGTH = 1200;
const TODO_MAX_ITEM_TITLE_LENGTH = 90;
const TODO_MAX_ITEM_SUMMARY_LENGTH = 220;
const TODO_MAX_ASSIGNEE_LENGTH = 80;
const TODO_MAX_DUE_DATE_LENGTH = 40;
const TODO_MAX_TAGS = 10;
const TODO_MAX_TAG_LENGTH = 24;

function getTodoBoardsKey(guildId: string): string {
    return `Guild/${guildId}/staff/todo-boards`;
}

export async function getGuildTodoBoards(guildId: string): Promise<TodoBoardSnapshot[]> {
    const stored = await database.get<TodoBoardCollection | null>(guildId, getTodoBoardsKey(guildId), null);
    if (!stored || !Array.isArray(stored.boards)) {
        return [];
    }
    return stored.boards.map((board) => normalizeBoard(board, guildId, board.channelId)).slice(0, TODO_MAX_BOARDS_PER_GUILD);
}

export async function getTodoBoardByChannel(guildId: string, channelId: string): Promise<TodoBoardSnapshot | null> {
    const boards = await getGuildTodoBoards(guildId);
    return boards.find((board) => board.channelId === channelId) || null;
}

export async function saveTodoBoard(board: TodoBoardSnapshot): Promise<TodoBoardSnapshot> {
    const normalized = normalizeBoard(board, board.guildId, board.channelId);
    const boards = await getGuildTodoBoards(normalized.guildId);
    const existingIndex = boards.findIndex((entry) => entry.channelId === normalized.channelId);

    if (existingIndex < 0 && boards.length >= TODO_MAX_BOARDS_PER_GUILD) {
        throw new Error(`Todo boards are limited to ${TODO_MAX_BOARDS_PER_GUILD} per guild.`);
    }

    const nextBoards = [...boards];
    if (existingIndex >= 0) {
        nextBoards[existingIndex] = normalized;
    } else {
        nextBoards.push(normalized);
    }

    await database.set(normalized.guildId, getTodoBoardsKey(normalized.guildId), {
        guildId: normalized.guildId,
        boards: nextBoards
    } satisfies TodoBoardCollection);

    return normalized;
}

export async function updateTodoBoardMessageId(guildId: string, channelId: string, messageId: string): Promise<TodoBoardSnapshot | null> {
    const board = await getTodoBoardByChannel(guildId, channelId);
    if (!board) {
        return null;
    }
    return saveTodoBoard({
        ...board,
        messageId
    });
}

export function createEmptyBoard(guildId: string, channelId: string, title = 'Project Todo'): TodoBoardSnapshot {
    return normalizeBoard({
        version: 3,
        guildId,
        channelId,
        messageId: null,
        title,
        summary: '',
        items: [],
        updatedAt: new Date().toISOString(),
        updatedBy: 'Unknown'
    }, guildId, channelId);
}

export function normalizeBoard(input: Partial<TodoBoardSnapshot>, guildId: string, channelId: string): TodoBoardSnapshot {
    const now = new Date().toISOString();
    const items = Array.isArray(input.items)
        ? input.items.slice(0, TODO_MAX_ITEMS_PER_BOARD).map((item, index) => normalizeItem(item, now, index))
        : [];

    return {
        version: 3,
        guildId,
        channelId,
        messageId: typeof input.messageId === 'string' && input.messageId.trim() ? input.messageId.trim() : null,
        title: `${input.title || 'Project Todo'}`.trim().slice(0, TODO_MAX_TITLE_LENGTH) || 'Project Todo',
        summary: `${input.summary || ''}`.trim().slice(0, TODO_MAX_SUMMARY_LENGTH),
        items,
        updatedAt: input.updatedAt || now,
        updatedBy: `${input.updatedBy || 'Unknown'}`.trim().slice(0, 80) || 'Unknown'
    };
}

function normalizeItem(item: Partial<TodoItem>, fallbackTimestamp: string, index: number): TodoItem {
    const tags = normalizeTags(Array.isArray(item.tags) ? item.tags.join(' ') : `${item.tags || ''}`);
    return {
        id: `${item.id || `todo-${index + 1}`}`.slice(0, 60),
        title: `${item.title || `Untitled ${index + 1}`}`.trim().slice(0, TODO_MAX_ITEM_TITLE_LENGTH) || `Untitled ${index + 1}`,
        status: isStatus(item.status) ? item.status : 'todo',
        priority: isPriority(item.priority) ? item.priority : 'medium',
        progress: clampProgress(item.progress),
        summary: `${item.summary || ''}`.trim().slice(0, TODO_MAX_ITEM_SUMMARY_LENGTH),
        details: `${item.details || ''}`.trim().slice(0, TODO_MAX_DETAIL_LENGTH),
        assignee: `${item.assignee || ''}`.trim().slice(0, TODO_MAX_ASSIGNEE_LENGTH),
        dueDate: typeof item.dueDate === 'string' && item.dueDate.trim() ? item.dueDate.trim().slice(0, TODO_MAX_DUE_DATE_LENGTH) : null,
        tags,
        createdAt: item.createdAt || fallbackTimestamp,
        updatedAt: item.updatedAt || fallbackTimestamp
    };
}

export function normalizeTags(raw: string): string[] {
    return raw
        .split(/\s+/)
        .map((tag) => tag.trim().replace(/^#+/g, ''))
        .filter(Boolean)
        .slice(0, TODO_MAX_TAGS)
        .map((tag) => tag.slice(0, TODO_MAX_TAG_LENGTH));
}

function clampProgress(progress: unknown): number {
    const numeric = Number(progress);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, Math.round(numeric)));
}

function isStatus(value: unknown): value is TodoItemStatus {
    return ['todo', 'doing', 'review', 'blocked', 'done'].includes(`${value || ''}`);
}

function isPriority(value: unknown): value is TodoItemPriority {
    return ['low', 'medium', 'high', 'critical'].includes(`${value || ''}`);
}
