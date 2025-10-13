import { Router } from 'express';
import { FeedbackController } from '../controllers/FeedbackController.js';
import { SettingsSession } from '../types/index.js';
import { verifyAuth } from '../middleware/auth.js';
import { globalPreviewRegistry } from '../preview/PreviewRegistry.js';
import { FeedbackManager } from '../../core/FeedbackManager.js';

/**
 * フィードバックルート
 */
export function createFeedbackRoutes(
    sessions: Map<string, SettingsSession>
): Router {
    const router = Router();
    const controller = new FeedbackController();

    // すべてのルートで認証を要求
    const auth = verifyAuth(sessions);

    // フィードバック一覧取得（type, status でフィルタ可能）
    router.get('/feedback', auth, controller.getAllFeedback.bind(controller));

    // 統計情報取得
    router.get('/feedback/stats', auth, controller.getStats.bind(controller));

    // 初期データ取得（WebSocket用）
    router.get('/feedback/initial', auth, controller.getInitialData.bind(controller));

    // 特定のフィードバック取得
    router.get('/feedback/:id', auth, controller.getFeedbackById.bind(controller));

    // フィードバック作成
    router.post('/feedback', auth, controller.createFeedback.bind(controller));

    // フィードバック更新
    router.put('/feedback/:id', auth, controller.updateFeedback.bind(controller));

    // フィードバック削除
    router.delete('/feedback/:id', auth, controller.deleteFeedback.bind(controller));

    // Upvote トグル
    router.post('/feedback/:id/upvote', auth, controller.toggleUpvote.bind(controller));

    // コメント追加
    router.post('/feedback/:id/comments', auth, controller.addComment.bind(controller));

    // コメント削除
    router.delete('/feedback/:id/comments/:commentId', auth, controller.deleteComment.bind(controller));

    return router;
}

// Register preview handlers for feedback pages so external crawlers
// can get OG meta for /feedback and /feedback/:id without SettingsServer edits.
try {
    // /feedback (index)
    globalPreviewRegistry.register(/^\/feedback$/i, async (path) => {
        return {
            title: 'Feedback',
            description: 'Community feedback, feature requests and bug reports.',
            url: path
        };
    });

    // /feedback/:id
    globalPreviewRegistry.register(/^\/feedback\/([a-zA-Z0-9-_]+)$/i, async (path) => {
        const parts = path.split('/');
        const id = parts[2];
        const f = await FeedbackManager.getFeedbackById(id);
        if (!f) return null;
        return {
            title: f.title || 'Feedback item',
            description: (f.description || '').toString().slice(0, 200),
            image: f.authorAvatar || undefined,
            url: path,
            type: 'article'
        };
    });
} catch (e) {
    // best-effort registration at import time; swallow errors
    // console.warn('Preview registration for feedback failed', e);
}
