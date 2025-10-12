import { Request, Response } from 'express';
import { SettingsSession } from '../types/index.js';
import { FeedbackManager, FeedbackType, FeedbackStatus } from '../../core/FeedbackManager.js';
import { sseManager } from '../services/SSEManager.js';
import crypto from 'crypto';

/**
 * フィードバックコントローラー
 */
export class FeedbackController {
    /**
     * すべてのフィードバックを取得
     */
    async getAllFeedback(req: Request, res: Response): Promise<void> {
        try {
            const type = req.query.type as FeedbackType | undefined;
            const status = req.query.status as FeedbackStatus | undefined;

            let feedback;

            if (type) {
                feedback = await FeedbackManager.getFeedbackByType(type);
            } else if (status) {
                feedback = await FeedbackManager.getFeedbackByStatus(status);
            } else {
                feedback = await FeedbackManager.getAllFeedback();
            }

            res.json({ feedback });
        } catch (error) {
            console.error('[FeedbackController] Error getting feedback:', error);
            res.status(500).json({ error: 'Failed to fetch feedback' });
        }
    }

    /**
     * 特定のフィードバックを取得
     */
    async getFeedbackById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const feedback = await FeedbackManager.getFeedbackById(id);

            if (!feedback) {
                res.status(404).json({ error: 'Feedback not found' });
                return;
            }

            res.json({ feedback });
        } catch (error) {
            console.error('[FeedbackController] Error getting feedback by ID:', error);
            res.status(500).json({ error: 'Failed to fetch feedback' });
        }
    }

    /**
     * 新しいフィードバックを作成
     */
    async createFeedback(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        
        try {
            const { type, title, description, tags } = req.body;

            if (!type || !title || !description) {
                res.status(400).json({ error: 'Missing required fields: type, title, description' });
                return;
            }

            if (!['feature_request', 'bug_report', 'improvement'].includes(type)) {
                res.status(400).json({ error: 'Invalid type' });
                return;
            }

            const feedback = await FeedbackManager.createFeedback(
                type as FeedbackType,
                title,
                description,
                session.userId,
                session.username || session.userId,
                (session as any).avatar,
                tags || []
            );

            // SSE経由でリアルタイム通知
            sseManager.broadcast('feedback', {
                type: 'feedbackCreated',
                timestamp: Date.now(),
                payload: feedback
            });

            res.json({ success: true, feedback });
        } catch (error) {
            console.error('[FeedbackController] Error creating feedback:', error);
            res.status(500).json({ error: 'Failed to create feedback' });
        }
    }

    /**
     * フィードバックを更新
     */
    async updateFeedback(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        
        try {
            const { id } = req.params;
            const updates = req.body;

            // 既存のフィードバックを取得
            const existingFeedback = await FeedbackManager.getFeedbackById(id);
            if (!existingFeedback) {
                res.status(404).json({ error: 'Feedback not found' });
                return;
            }

            // 作成者のみが更新可能（管理者チェックは後で追加可能）
            if (existingFeedback.authorId !== session.userId) {
                res.status(403).json({ error: 'You are not authorized to update this feedback' });
                return;
            }

            const updatedFeedback = await FeedbackManager.updateFeedback(id, updates);

            if (!updatedFeedback) {
                res.status(404).json({ error: 'Feedback not found' });
                return;
            }

            // SSE経由でリアルタイム通知
            sseManager.broadcast('feedback', {
                type: 'feedbackUpdated',
                timestamp: Date.now(),
                payload: updatedFeedback
            });

            res.json({ success: true, feedback: updatedFeedback });
        } catch (error) {
            console.error('[FeedbackController] Error updating feedback:', error);
            res.status(500).json({ error: 'Failed to update feedback' });
        }
    }

    /**
     * フィードバックを削除
     */
    async deleteFeedback(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        
        try {
            const { id } = req.params;

            // 既存のフィードバックを取得
            const existingFeedback = await FeedbackManager.getFeedbackById(id);
            if (!existingFeedback) {
                res.status(404).json({ error: 'Feedback not found' });
                return;
            }

            // 作成者のみが削除可能（管理者チェックは後で追加可能）
            if (existingFeedback.authorId !== session.userId) {
                res.status(403).json({ error: 'You are not authorized to delete this feedback' });
                return;
            }

            const deleted = await FeedbackManager.deleteFeedback(id);

            if (!deleted) {
                res.status(404).json({ error: 'Feedback not found' });
                return;
            }

            // SSE経由でリアルタイム通知
            sseManager.broadcast('feedback', {
                type: 'feedbackDeleted',
                timestamp: Date.now(),
                payload: { id }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('[FeedbackController] Error deleting feedback:', error);
            res.status(500).json({ error: 'Failed to delete feedback' });
        }
    }

    /**
     * Upvote をトグル
     */
    async toggleUpvote(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        
        try {
            const { id } = req.params;

            const feedback = await FeedbackManager.toggleUpvote(id, session.userId);

            if (!feedback) {
                res.status(404).json({ error: 'Feedback not found' });
                return;
            }

            // SSE経由でリアルタイム通知
            sseManager.broadcast('feedback', {
                type: 'feedbackUpvoted',
                timestamp: Date.now(),
                payload: feedback
            });

            res.json({ success: true, feedback });
        } catch (error) {
            console.error('[FeedbackController] Error toggling upvote:', error);
            res.status(500).json({ error: 'Failed to toggle upvote' });
        }
    }

    /**
     * コメントを追加
     */
    async addComment(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        
        try {
            const { id } = req.params;
            const { content } = req.body;

            if (!content) {
                res.status(400).json({ error: 'Missing required field: content' });
                return;
            }

            const comment = await FeedbackManager.addComment(
                id,
                session.userId,
                session.username || session.userId,
                content,
                (session as any).avatar
            );

            if (!comment) {
                res.status(404).json({ error: 'Feedback not found' });
                return;
            }

            // 更新されたフィードバック全体を取得
            const feedback = await FeedbackManager.getFeedbackById(id);

            // SSE経由でリアルタイム通知
            sseManager.broadcast('feedback', {
                type: 'commentAdded',
                timestamp: Date.now(),
                payload: { feedbackId: id, comment, feedback }
            });

            res.json({ success: true, comment });
        } catch (error) {
            console.error('[FeedbackController] Error adding comment:', error);
            res.status(500).json({ error: 'Failed to add comment' });
        }
    }

    /**
     * コメントを削除
     */
    async deleteComment(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        
        try {
            const { id, commentId } = req.params;

            // コメントの作成者チェック（簡易実装）
            const feedback = await FeedbackManager.getFeedbackById(id);
            if (!feedback) {
                res.status(404).json({ error: 'Feedback not found' });
                return;
            }

            const comment = feedback.comments.find(c => c.id === commentId);
            if (!comment) {
                res.status(404).json({ error: 'Comment not found' });
                return;
            }

            if (comment.authorId !== session.userId) {
                res.status(403).json({ error: 'You are not authorized to delete this comment' });
                return;
            }

            const deleted = await FeedbackManager.deleteComment(id, commentId);

            if (!deleted) {
                res.status(404).json({ error: 'Comment not found' });
                return;
            }

            // 更新されたフィードバック全体を取得
            const updatedFeedback = await FeedbackManager.getFeedbackById(id);

            // SSE経由でリアルタイム通知
            sseManager.broadcast('feedback', {
                type: 'commentDeleted',
                timestamp: Date.now(),
                payload: { feedbackId: id, commentId, feedback: updatedFeedback }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('[FeedbackController] Error deleting comment:', error);
            res.status(500).json({ error: 'Failed to delete comment' });
        }
    }

    /**
     * 統計情報を取得
     */
    async getStats(req: Request, res: Response): Promise<void> {
        try {
            const stats = await FeedbackManager.getStats();
            res.json(stats);
        } catch (error) {
            console.error('[FeedbackController] Error getting stats:', error);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    }

    /**
     * SSEストリーム（リアルタイム更新）
     */
    async streamFeedbackUpdates(req: Request, res: Response): Promise<void> {
        const session = (req as any).session as SettingsSession;
        const connectionId = `feedback-${session.userId}-${crypto.randomUUID()}`;

        try {
            // SSE接続を登録
            sseManager.addConnection(connectionId, res, 'feedback', {
                userId: session.userId
            });

            // 初回データを送信
            const feedback = await FeedbackManager.getAllFeedback();
            const stats = await FeedbackManager.getStats();

            sseManager.sendToConnection(connectionId, {
                type: 'initialData',
                timestamp: Date.now(),
                payload: { feedback, stats }
            });

            // Keep-aliveを定期的に送信
            const keepAliveInterval = setInterval(() => {
                if (!sseManager.getConnectionInfo(connectionId)) {
                    clearInterval(keepAliveInterval);
                    return;
                }
                sseManager.sendToConnection(connectionId, {
                    type: 'keepalive',
                    timestamp: Date.now()
                });
            }, 30000); // 30秒ごと

            // 接続終了時のクリーンアップ
            res.on('close', () => {
                clearInterval(keepAliveInterval);
                sseManager.removeConnection(connectionId);
            });

        } catch (error) {
            console.error('[FeedbackController] Error setting up SSE stream:', error);
            res.status(500).json({ error: 'Failed to setup SSE stream' });
        }
    }
}
