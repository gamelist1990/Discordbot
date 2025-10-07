import JsonDB from '../database.js';
import crypto from 'crypto';

/**
 * Jamboard データ構造
 */
export interface Jamboard {
    id: string;
    type: 'staff' | 'personal';
    guildId: string;
    ownerId: string; // 作成者のユーザーID
    name: string;
    members: string[]; // アクセス可能なユーザーIDリスト
    inviteCode?: string; // 招待コード（personalの場合のみ）
    createdAt: number;
    updatedAt: number;
}

/**
 * Jamboard コンテンツ（ホワイトボード、Todo）
 */
export interface JamboardContent {
    jamboardId: string;
    whiteboard: WhiteboardData;
    todos: TodoItem[];
    updatedAt: number;
}

/**
 * ホワイトボードデータ
 */
export interface WhiteboardData {
    strokes: DrawingStroke[];
}

/**
 * 描画ストローク
 */
export interface DrawingStroke {
    id: string;
    points: { x: number; y: number }[];
    color: string;
    width: number;
    tool: 'pen' | 'eraser' | 'highlighter';
    timestamp: number;
}

/**
 * Todoアイテム
 */
export interface TodoItem {
    id: string;
    text: string;
    completed: boolean;
    createdBy: string;
    createdAt: number;
    completedAt?: number;
}

/**
 * Jamboard マネージャー
 */
export class JamboardManager {
    private static jamboardsDb = new JsonDB('jamboards', './database');
    private static contentsDb = new JsonDB('jamboard_contents', './database');

    /**
     * スタッフ用Jamboardを取得または作成
     */
    static async getOrCreateStaffJamboard(guildId: string): Promise<Jamboard> {
        const existingStaff = await this.getStaffJamboard(guildId);
        if (existingStaff) {
            return existingStaff;
        }

        // スタッフ用Jamboardを作成
        const jamboard: Jamboard = {
            id: `staff_${guildId}`,
            type: 'staff',
            guildId,
            ownerId: 'system',
            name: 'Staff Jamboard',
            members: [], // スタッフ全員がアクセス可能
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        await this.jamboardsDb.set(guildId, jamboard.id, jamboard);

        // 初期コンテンツを作成
        const content: JamboardContent = {
            jamboardId: jamboard.id,
            whiteboard: { strokes: [] },
            todos: [],
            updatedAt: Date.now()
        };
        await this.contentsDb.set(guildId, jamboard.id, content);

        return jamboard;
    }

    /**
     * スタッフ用Jamboardを取得
     */
    static async getStaffJamboard(guildId: string): Promise<Jamboard | null> {
        const staffId = `staff_${guildId}`;
        const jamboard = await this.jamboardsDb.get<Jamboard>(guildId, staffId);
        return jamboard || null;
    }

    /**
     * 個人用Jamboardを作成
     */
    static async createPersonalJamboard(
        guildId: string,
        userId: string,
        name: string
    ): Promise<Jamboard> {
        // すでに個人用Jamboardを持っているか確認
        const existing = await this.getPersonalJamboard(guildId, userId);
        if (existing) {
            throw new Error('User already has a personal jamboard');
        }

        const jamboardId = crypto.randomBytes(16).toString('hex');
        const inviteCode = crypto.randomBytes(8).toString('hex');

        const jamboard: Jamboard = {
            id: jamboardId,
            type: 'personal',
            guildId,
            ownerId: userId,
            name: name || 'My Jamboard',
            members: [userId],
            inviteCode,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        await this.jamboardsDb.set(guildId, jamboardId, jamboard);

        // 初期コンテンツを作成
        const content: JamboardContent = {
            jamboardId: jamboard.id,
            whiteboard: { strokes: [] },
            todos: [],
            updatedAt: Date.now()
        };
        await this.contentsDb.set(guildId, jamboardId, content);

        return jamboard;
    }

    /**
     * ユーザーの個人用Jamboardを取得
     */
    static async getPersonalJamboard(guildId: string, userId: string): Promise<Jamboard | null> {
        const allJamboards = await this.jamboardsDb.getAll(guildId);
        
        for (const key in allJamboards) {
            const jamboard = allJamboards[key] as Jamboard;
            if (jamboard.type === 'personal' && jamboard.ownerId === userId) {
                return jamboard;
            }
        }

        return null;
    }

    /**
     * Jamboard IDからJamboardを取得
     */
    static async getJamboard(guildId: string, jamboardId: string): Promise<Jamboard | null> {
        const jamboard = await this.jamboardsDb.get<Jamboard>(guildId, jamboardId);
        return jamboard || null;
    }

    /**
     * 招待コードからJamboardを取得
     */
    static async getJamboardByInviteCode(inviteCode: string): Promise<Jamboard | null> {
        // 全ギルドをスキャン（効率的ではないが、小規模なら問題ない）
        // TODO: 実装を改善 - 招待コードをキーとした別のインデックスを使用
        
        // 簡易実装として null を返す
        console.warn('getJamboardByInviteCode is not fully implemented yet:', inviteCode);
        return null;
    }

    /**
     * Jamboardにメンバーを追加
     */
    static async addMember(
        guildId: string,
        jamboardId: string,
        userId: string
    ): Promise<void> {
        const jamboard = await this.getJamboard(guildId, jamboardId);
        if (!jamboard) {
            throw new Error('Jamboard not found');
        }

        if (jamboard.type === 'staff') {
            throw new Error('Cannot add members to staff jamboard');
        }

        if (jamboard.members.includes(userId)) {
            return; // すでにメンバー
        }

        jamboard.members.push(userId);
        jamboard.updatedAt = Date.now();
        await this.jamboardsDb.set(guildId, jamboardId, jamboard);
    }

    /**
     * Jamboardからメンバーを削除
     */
    static async removeMember(
        guildId: string,
        jamboardId: string,
        userId: string
    ): Promise<void> {
        const jamboard = await this.getJamboard(guildId, jamboardId);
        if (!jamboard) {
            throw new Error('Jamboard not found');
        }

        if (jamboard.ownerId === userId) {
            throw new Error('Cannot remove owner from jamboard');
        }

        jamboard.members = jamboard.members.filter(id => id !== userId);
        jamboard.updatedAt = Date.now();
        await this.jamboardsDb.set(guildId, jamboardId, jamboard);
    }

    /**
     * ユーザーがアクセスできるJamboardか確認
     */
    static async canAccess(
        guildId: string,
        jamboardId: string,
        userId: string,
        isStaff: boolean
    ): Promise<boolean> {
        const jamboard = await this.getJamboard(guildId, jamboardId);
        if (!jamboard) {
            return false;
        }

        // スタッフ用Jamboardはスタッフのみアクセス可能
        if (jamboard.type === 'staff') {
            return isStaff;
        }

        // 個人用Jamboardはメンバーのみアクセス可能
        return jamboard.members.includes(userId);
    }

    /**
     * Jamboardコンテンツを取得
     */
    static async getContent(guildId: string, jamboardId: string): Promise<JamboardContent | null> {
        const content = await this.contentsDb.get<JamboardContent>(guildId, jamboardId);
        return content || null;
    }

    /**
     * Jamboardコンテンツを更新
     */
    static async updateContent(
        guildId: string,
        jamboardId: string,
        content: Partial<JamboardContent>
    ): Promise<void> {
        const existing = await this.getContent(guildId, jamboardId);
        if (!existing) {
            throw new Error('Content not found');
        }

        const updated: JamboardContent = {
            ...existing,
            ...content,
            jamboardId,
            updatedAt: Date.now()
        };

        await this.contentsDb.set(guildId, jamboardId, updated);
    }

    /**
     * ストロークを追加
     */
    static async addStroke(
        guildId: string,
        jamboardId: string,
        stroke: DrawingStroke
    ): Promise<void> {
        const content = await this.getContent(guildId, jamboardId);
        if (!content) {
            throw new Error('Content not found');
        }

        content.whiteboard.strokes.push(stroke);
        content.updatedAt = Date.now();
        await this.contentsDb.set(guildId, jamboardId, content);
    }

    /**
     * ストロークを削除
     */
    static async removeStroke(
        guildId: string,
        jamboardId: string,
        strokeId: string
    ): Promise<void> {
        const content = await this.getContent(guildId, jamboardId);
        if (!content) {
            throw new Error('Content not found');
        }

        content.whiteboard.strokes = content.whiteboard.strokes.filter(s => s.id !== strokeId);
        content.updatedAt = Date.now();
        await this.contentsDb.set(guildId, jamboardId, content);
    }

    /**
     * Todoを追加
     */
    static async addTodo(
        guildId: string,
        jamboardId: string,
        todo: TodoItem
    ): Promise<void> {
        const content = await this.getContent(guildId, jamboardId);
        if (!content) {
            throw new Error('Content not found');
        }

        content.todos.push(todo);
        content.updatedAt = Date.now();
        await this.contentsDb.set(guildId, jamboardId, content);
    }

    /**
     * Todoを更新
     */
    static async updateTodo(
        guildId: string,
        jamboardId: string,
        todoId: string,
        updates: Partial<TodoItem>
    ): Promise<void> {
        const content = await this.getContent(guildId, jamboardId);
        if (!content) {
            throw new Error('Content not found');
        }

        const todoIndex = content.todos.findIndex(t => t.id === todoId);
        if (todoIndex === -1) {
            throw new Error('Todo not found');
        }

        content.todos[todoIndex] = {
            ...content.todos[todoIndex],
            ...updates
        };

        if (updates.completed !== undefined && updates.completed) {
            content.todos[todoIndex].completedAt = Date.now();
        }

        content.updatedAt = Date.now();
        await this.contentsDb.set(guildId, jamboardId, content);
    }

    /**
     * Todoを削除
     */
    static async deleteTodo(
        guildId: string,
        jamboardId: string,
        todoId: string
    ): Promise<void> {
        const content = await this.getContent(guildId, jamboardId);
        if (!content) {
            throw new Error('Content not found');
        }

        content.todos = content.todos.filter(t => t.id !== todoId);
        content.updatedAt = Date.now();
        await this.contentsDb.set(guildId, jamboardId, content);
    }

    /**
     * ユーザーがアクセス可能なJamboardリストを取得
     */
    static async getAccessibleJamboards(
        guildId: string,
        userId: string,
        isStaff: boolean
    ): Promise<Jamboard[]> {
        const allJamboards = await this.jamboardsDb.getAll(guildId);
        const accessible: Jamboard[] = [];

        for (const key in allJamboards) {
            const jamboard = allJamboards[key] as Jamboard;
            
            if (jamboard.type === 'staff' && isStaff) {
                accessible.push(jamboard);
            } else if (jamboard.type === 'personal' && jamboard.members.includes(userId)) {
                accessible.push(jamboard);
            }
        }

        return accessible;
    }
}
