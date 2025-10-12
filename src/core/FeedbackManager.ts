import { database } from './Database.js';
import crypto from 'crypto';

/**
 * フィードバックの種類
 */
export type FeedbackType = 'feature_request' | 'bug_report' | 'improvement';

/**
 * フィードバックのステータス
 */
export type FeedbackStatus = 'open' | 'in_progress' | 'completed' | 'rejected';

/**
 * フィードバックアイテム
 */
export interface FeedbackItem {
    id: string;
    type: FeedbackType;
    title: string;
    description: string;
    status: FeedbackStatus;
    authorId: string; // Discord User ID
    authorName: string; // Discord Username
    authorAvatar?: string; // Discord Avatar URL
    createdAt: number;
    updatedAt: number;
    upvotes: string[]; // ユーザーIDの配列
    comments: FeedbackComment[];
    tags: string[];
    // オプション: 関連するギルドID（グローバルの場合は空）
    relatedGuildIds?: string[];
}

/**
 * フィードバックコメント
 */
export interface FeedbackComment {
    id: string;
    feedbackId: string;
    authorId: string;
    authorName: string;
    authorAvatar?: string;
    content: string;
    createdAt: number;
    updatedAt: number;
}

/**
 * グローバルフィードバック管理
 */
export class FeedbackManager {
    private static db = database;
    private static readonly FEEDBACK_KEY = 'Global/Feedback';

    /**
     * すべてのフィードバックを取得
     */
    static async getAllFeedback(): Promise<FeedbackItem[]> {
        try {
            const data = await this.db.get('global', this.FEEDBACK_KEY);
            if (!data || !Array.isArray(data.items)) {
                return [];
            }
            return data.items;
        } catch (error) {
            console.error('[FeedbackManager] Error getting all feedback:', error);
            return [];
        }
    }

    /**
     * タイプでフィルタリングしたフィードバックを取得
     */
    static async getFeedbackByType(type: FeedbackType): Promise<FeedbackItem[]> {
        const allFeedback = await this.getAllFeedback();
        return allFeedback.filter(item => item.type === type);
    }

    /**
     * ステータスでフィルタリングしたフィードbackを取得
     */
    static async getFeedbackByStatus(status: FeedbackStatus): Promise<FeedbackItem[]> {
        const allFeedback = await this.getAllFeedback();
        return allFeedback.filter(item => item.status === status);
    }

    /**
     * 特定のフィードバックを取得
     */
    static async getFeedbackById(id: string): Promise<FeedbackItem | null> {
        const allFeedback = await this.getAllFeedback();
        return allFeedback.find(item => item.id === id) || null;
    }

    /**
     * 新しいフィードバックを作成
     */
    static async createFeedback(
        type: FeedbackType,
        title: string,
        description: string,
        authorId: string,
        authorName: string,
        authorAvatar?: string,
        tags: string[] = []
    ): Promise<FeedbackItem> {
        const newFeedback: FeedbackItem = {
            id: crypto.randomUUID(),
            type,
            title,
            description,
            status: 'open',
            authorId,
            authorName,
            authorAvatar,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            upvotes: [],
            comments: [],
            tags
        };

        const allFeedback = await this.getAllFeedback();
        allFeedback.push(newFeedback);

        await this.saveFeedback(allFeedback);
        console.log(`[FeedbackManager] Created feedback: ${newFeedback.id}`);

        return newFeedback;
    }

    /**
     * フィードバックを更新
     */
    static async updateFeedback(
        id: string,
        updates: Partial<Omit<FeedbackItem, 'id' | 'authorId' | 'createdAt'>>
    ): Promise<FeedbackItem | null> {
        const allFeedback = await this.getAllFeedback();
        const index = allFeedback.findIndex(item => item.id === id);

        if (index === -1) {
            return null;
        }

        allFeedback[index] = {
            ...allFeedback[index],
            ...updates,
            updatedAt: Date.now()
        };

        await this.saveFeedback(allFeedback);
        console.log(`[FeedbackManager] Updated feedback: ${id}`);

        return allFeedback[index];
    }

    /**
     * フィードバックを削除
     */
    static async deleteFeedback(id: string): Promise<boolean> {
        const allFeedback = await this.getAllFeedback();
        const filteredFeedback = allFeedback.filter(item => item.id !== id);

        if (filteredFeedback.length === allFeedback.length) {
            return false; // 削除対象が見つからない
        }

        await this.saveFeedback(filteredFeedback);
        console.log(`[FeedbackManager] Deleted feedback: ${id}`);

        return true;
    }

    /**
     * Upvote を追加/削除（トグル）
     */
    static async toggleUpvote(feedbackId: string, userId: string): Promise<FeedbackItem | null> {
        const feedback = await this.getFeedbackById(feedbackId);
        if (!feedback) return null;

        const hasUpvoted = feedback.upvotes.includes(userId);

        if (hasUpvoted) {
            // Upvote を削除
            feedback.upvotes = feedback.upvotes.filter(id => id !== userId);
        } else {
            // Upvote を追加
            feedback.upvotes.push(userId);
        }

        return await this.updateFeedback(feedbackId, { upvotes: feedback.upvotes });
    }

    /**
     * コメントを追加
     */
    static async addComment(
        feedbackId: string,
        authorId: string,
        authorName: string,
        content: string,
        authorAvatar?: string
    ): Promise<FeedbackComment | null> {
        const feedback = await this.getFeedbackById(feedbackId);
        if (!feedback) return null;

        const newComment: FeedbackComment = {
            id: crypto.randomUUID(),
            feedbackId,
            authorId,
            authorName,
            authorAvatar,
            content,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        feedback.comments.push(newComment);
        await this.updateFeedback(feedbackId, { comments: feedback.comments });

        console.log(`[FeedbackManager] Added comment to feedback: ${feedbackId}`);

        return newComment;
    }

    /**
     * コメントを削除
     */
    static async deleteComment(feedbackId: string, commentId: string): Promise<boolean> {
        const feedback = await this.getFeedbackById(feedbackId);
        if (!feedback) return false;

        const originalLength = feedback.comments.length;
        feedback.comments = feedback.comments.filter(c => c.id !== commentId);

        if (feedback.comments.length === originalLength) {
            return false; // コメントが見つからない
        }

        await this.updateFeedback(feedbackId, { comments: feedback.comments });
        console.log(`[FeedbackManager] Deleted comment from feedback: ${feedbackId}`);

        return true;
    }

    /**
     * 統計情報を取得
     */
    static async getStats(): Promise<{
        total: number;
        byType: Record<FeedbackType, number>;
        byStatus: Record<FeedbackStatus, number>;
    }> {
        const allFeedback = await this.getAllFeedback();

        const stats = {
            total: allFeedback.length,
            byType: {
                feature_request: 0,
                bug_report: 0,
                improvement: 0
            } as Record<FeedbackType, number>,
            byStatus: {
                open: 0,
                in_progress: 0,
                completed: 0,
                rejected: 0
            } as Record<FeedbackStatus, number>
        };

        allFeedback.forEach(item => {
            stats.byType[item.type]++;
            stats.byStatus[item.status]++;
        });

        return stats;
    }

    /**
     * フィードバックを保存
     */
    private static async saveFeedback(feedback: FeedbackItem[]): Promise<void> {
        await this.db.set('global', this.FEEDBACK_KEY, {
            items: feedback,
            updatedAt: Date.now()
        });
    }
}
