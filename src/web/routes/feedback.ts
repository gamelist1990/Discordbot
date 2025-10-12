import { Router } from 'express';
import { FeedbackController } from '../controllers/FeedbackController.js';
import { SettingsSession } from '../types/index.js';
import { verifyAuth } from '../middleware/auth.js';

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

    // SSEストリーム（リアルタイム更新）
    router.get('/feedback/stream', auth, controller.streamFeedbackUpdates.bind(controller));

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
