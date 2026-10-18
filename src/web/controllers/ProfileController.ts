import { Router, Request, Response } from "express";
import { verifyAuth, getCurrentUser } from "../middleware/auth.js";
import { ProfileService } from "../services/ProfileService.js";
import { SettingsSession } from "../types/index.js";
import config from "../../config.js";
import { publicProfileFields } from "../shared/profileSafety.js";

export function profileWriteOriginAllowed(
  origin: unknown,
  expectedOrigin: string,
  site?: string,
): boolean {
  if (typeof origin !== "string" || site === "cross-site") return false;
  try {
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

/**
 * プロフィールカスタマイズコントローラー
 */
export function createProfileController(
  sessions: Map<string, SettingsSession>,
  profileService: ProfileService,
): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });

  /**
   * カスタムプロフィール取得
   * GET /api/user/profile/custom?userId=<userId>
   */
  router.get(
    "/custom",
    verifyAuth(sessions),
    async (req: Request, res: Response) => {
      try {
        const requestedUserId = req.query.userId;
        if (
          requestedUserId !== undefined &&
          (typeof requestedUserId !== "string" ||
            !/^[1-9]\d{0,19}$/.test(requestedUserId))
        ) {
          res.status(400).json({ error: "ユーザーIDが不正です。" });
          return;
        }
        const currentUser = getCurrentUser(req);

        if (!currentUser) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        const userId = requestedUserId || currentUser.userId;
        const profile = await profileService.getCustomProfile(userId);

        // プライバシーチェック: 他人のプロフィールを見ようとしている場合
        if (userId !== currentUser.userId && profile) {
          if (!profile.privacy?.allowPublicView) {
            res.status(403).json({ error: "This profile is private" });
            return;
          }
        }

        res.json(
          profile && userId !== currentUser.userId
            ? publicProfileFields(profile)
            : profile || {},
        );
      } catch (error) {
        console.error("Failed to get custom profile:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  /**
   * カスタムプロフィール更新
   * PUT /api/user/profile/custom
   */
  router.put(
    "/custom",
    verifyAuth(sessions),
    async (req: Request, res: Response) => {
      try {
        if (
          ![config.BASE_URL, config.WEB_BASE_URL]
            .filter(Boolean)
            .some((origin) =>
              profileWriteOriginAllowed(
                req.get("origin"),
                origin!,
                req.get("sec-fetch-site"),
              ),
            ) ||
          !req.is("application/json")
        ) {
          res.status(403).json({
            error: "このページからのプロフィール更新は許可されていません。",
          });
          return;
        }
        const user = getCurrentUser(req);
        if (!user) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        const profileData = req.body;
        if (
          profileData?.userId !== undefined &&
          profileData.userId !== user.userId
        ) {
          res
            .status(403)
            .json({ error: "他のユーザーのプロフィールは更新できません。" });
          return;
        }

        // バリデーション
        const errors = profileService.validateProfile(profileData);
        if (errors.length > 0) {
          res.status(400).json({ errors });
          return;
        }

        await profileService.saveCustomProfile(user.userId, profileData);

        res.json({
          success: true,
          profile: await profileService.getCustomProfile(user.userId),
        });
      } catch (error) {
        console.error("Failed to update custom profile:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  /**
   * バナープリセット取得
   * GET /api/user/profile/banner-presets
   */
  router.get("/banner-presets", async (_req: Request, res: Response) => {
    try {
      const presets = profileService.getBannerPresets();
      res.json(presets);
    } catch (error) {
      console.error("Failed to get banner presets:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
