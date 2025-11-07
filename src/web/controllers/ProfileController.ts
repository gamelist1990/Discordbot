import { Router, Request, Response } from 'express';
import { verifyAuth, getCurrentUser } from '../middleware/auth.js';
import { ProfileService } from '../services/ProfileService.js';
import { SettingsSession } from '../types/index.js';

/**
 * プロフィールカスタマイズコントローラー
 */
export function createProfileController(
  sessions: Map<string, SettingsSession>,
  profileService: ProfileService
): Router {
  const router = Router();
  
  /**
   * カスタムプロフィール取得
   * GET /api/user/profile/custom?userId=<userId>
   */
  router.get('/custom', verifyAuth(sessions), async (req: Request, res: Response) => {
    try {
      const requestedUserId = req.query.userId as string;
      const currentUser = getCurrentUser(req);
      
      if (!currentUser) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      const userId = requestedUserId || currentUser.userId;
      const profile = await profileService.getCustomProfile(userId);
      
      // プライバシーチェック: 他人のプロフィールを見ようとしている場合
      if (userId !== currentUser.userId && profile) {
        if (!profile.privacy?.allowPublicView) {
          res.status(403).json({ error: 'This profile is private' });
          return;
        }
      }
      
      res.json(profile || {});
    } catch (error) {
      console.error('Failed to get custom profile:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  /**
   * カスタムプロフィール更新
   * PUT /api/user/profile/custom
   */
  router.put('/custom', verifyAuth(sessions), async (req: Request, res: Response) => {
    try {
      const user = getCurrentUser(req);
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      const profileData = req.body;
      
      // バリデーション
      const errors = profileService.validateProfile(profileData);
      if (errors.length > 0) {
        res.status(400).json({ errors });
        return;
      }
      
      await profileService.saveCustomProfile(user.userId, profileData);
      
      res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
      console.error('Failed to update custom profile:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  /**
   * バナープリセット取得
   * GET /api/user/profile/banner-presets
   */
  router.get('/banner-presets', async (req: Request, res: Response) => {
    try {
      const presets = profileService.getBannerPresets();
      res.json(presets);
    } catch (error) {
      console.error('Failed to get banner presets:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  return router;
}
