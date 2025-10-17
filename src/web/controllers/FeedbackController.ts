import { Request, Response } from 'express';
import { SettingsSession } from '../types/index.js';
import { FeedbackManager, FeedbackType, FeedbackStatus } from '../../core/FeedbackManager.js';
import { unifiedWsManager } from '../services/UnifiedWebSocketManager.js';
import { isOwner } from '../../config.js';
import { CacheManager } from '../../utils/CacheManager.js';

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
            const tagQuery = req.query.tag as string | undefined; // comma-separated tags

            // キャッシュキーを生成（フィルタ条件を含む）
            const cacheKey = `feedback_all_${type || 'all'}_${status || 'all'}_${tagQuery || 'none'}`;
            const cachedFeedback = CacheManager.get<any[]>(cacheKey);
            if (cachedFeedback) {
                res.json({ feedback: cachedFeedback });
                return;
            }

            // Load all then filter server-side to support combined filters (type+status+tag)
            let feedback = await FeedbackManager.getAllFeedback();

            if (type) {
                feedback = feedback.filter(item => item.type === type);
            }
            if (status) {
                feedback = feedback.filter(item => item.status === status);
            }
            if (tagQuery) {
                const tags = tagQuery.split(',').map(t => t.trim()).filter(Boolean);
                if (tags.length > 0) {
                    feedback = feedback.filter(item => item.tags && item.tags.some(t => tags.includes(t)));
                }
            }

            // キャッシュに保存（5分間）
            CacheManager.set(cacheKey, feedback, 5 * 60 * 1000);

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

            // キャッシュチェック
            const cacheKey = `feedback_${id}`;
            const cachedFeedback = CacheManager.get<any>(cacheKey);
            if (cachedFeedback) {
                res.json({ feedback: cachedFeedback });
                return;
            }

            const feedback = await FeedbackManager.getFeedbackById(id);

            if (!feedback) {
                res.status(404).json({ error: 'Feedback not found' });
                return;
            }

            // キャッシュに保存（10分間）
            CacheManager.set(cacheKey, feedback, 10 * 60 * 1000);

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

            // WebSocket経由でリアルタイム通知
            unifiedWsManager.broadcast('feedback', {
                type: 'feedbackCreated',
                timestamp: Date.now(),
                payload: feedback
            });

            // キャッシュをクリア（フィードバック関連の全キャッシュ）
            CacheManager.clear();

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

            // 作成者は任意の更新が可能。
            // 作成者でない場合、オーナーは status と tags の変更のみ許可する。
            if (existingFeedback.authorId !== session.userId) {
                const ownerFlag = isOwner(session.userId);
                const updateKeys = Object.keys(updates || {});
                const allowedOwnerKeys = ['status', 'tags'];
                const onlyAllowed = updateKeys.length > 0 && updateKeys.every(k => allowedOwnerKeys.includes(k));
                if (!(ownerFlag && onlyAllowed)) {
                    res.status(403).json({ error: 'You are not authorized to update this feedback' });
                    return;
                }
            }

            const updatedFeedback = await FeedbackManager.updateFeedback(id, updates);

            if (!updatedFeedback) {
                res.status(404).json({ error: 'Feedback not found' });
                return;
            }

            // WebSocket経由でリアルタイム通知
            unifiedWsManager.broadcast('feedback', {
                type: 'feedbackUpdated',
                timestamp: Date.now(),
                payload: updatedFeedback
            });

            // キャッシュをクリア
            CacheManager.clear();

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

            // 作成者またはオーナーが削除可能
            if (existingFeedback.authorId !== session.userId && !isOwner(session.userId)) {
                res.status(403).json({ error: 'You are not authorized to delete this feedback' });
                return;
            }

            const deleted = await FeedbackManager.deleteFeedback(id);

            if (!deleted) {
                res.status(404).json({ error: 'Feedback not found' });
                return;
            }

            // WebSocket経由でリアルタイム通知
            unifiedWsManager.broadcast('feedback', {
                type: 'feedbackDeleted',
                timestamp: Date.now(),
                payload: { id }
            });

            // キャッシュをクリア
            CacheManager.clear();

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

            // WebSocket経由でリアルタイム通知
            unifiedWsManager.broadcast('feedback', {
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

            // WebSocket経由でリアルタイム通知
            unifiedWsManager.broadcast('feedback', {
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

            // WebSocket経由でリアルタイム通知
            unifiedWsManager.broadcast('feedback', {
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
    async getStats(_req: Request, res: Response): Promise<void> {
        try {
            const stats = await FeedbackManager.getStats();
            res.json(stats);
        } catch (error) {
            console.error('[FeedbackController] Error getting stats:', error);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    }

    /**
     * WebSocket用の初期データ取得
     */
    async getInitialData(_req: Request, res: Response): Promise<void> {
        try {
            const feedback = await FeedbackManager.getAllFeedback();
            const stats = await FeedbackManager.getStats();

            res.json({
                success: true,
                data: { feedback, stats }
            });
        } catch (error) {
            console.error('[FeedbackController] Error getting initial data:', error);
            res.status(500).json({ error: 'Failed to fetch initial data' });
        }
    }
}
