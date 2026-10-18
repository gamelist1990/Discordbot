import { Database } from "../../core/persistence/Database.js";
import { UserCustomProfile } from "../types/profile.js";
import {
  isRecord,
  normalizeProfile,
  safeWebUrl,
} from "../shared/profileSafety.js";

/**
 * プロフィールカスタマイズサービス
 */
export class ProfileService {
  private database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /**
   * カスタムプロフィールを取得
   */
  async getCustomProfile(userId: string): Promise<UserCustomProfile | null> {
    try {
      const raw = await this.database.get<any>(
        "",
        `UserProfiles/${userId}`,
        null,
      );
      if (!isRecord(raw)) return null;
      return {
        ...normalizeProfile(raw).profile,
        userId,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        badges: Array.isArray(raw.badges)
          ? raw.badges
              .filter(
                (badge: unknown) =>
                  isRecord(badge) &&
                  typeof badge.id === "string" &&
                  typeof badge.name === "string",
              )
              .slice(0, 50)
              .map((badge: any) => ({
                id: badge.id.slice(0, 100),
                name: badge.name.slice(0, 100),
                icon:
                  safeWebUrl(badge.icon) ||
                  (typeof badge.icon === "string" &&
                  badge.icon.length <= 32 &&
                  !/[<>]/.test(badge.icon) &&
                  !/^[a-z]+:/i.test(badge.icon)
                    ? badge.icon
                    : ""),
                earnedAt:
                  typeof badge.earnedAt === "string"
                    ? badge.earnedAt.slice(0, 40)
                    : "",
              }))
          : undefined,
        privacy: {
          showStats: raw.privacy?.showStats === true,
          showServers: raw.privacy?.showServers === true,
          showActivity: raw.privacy?.showActivity === true,
          allowPublicView: raw.privacy?.allowPublicView === true,
        },
      } as UserCustomProfile;
    } catch (error) {
      console.error(`Failed to get custom profile for ${userId}:`, error);
      return null;
    }
  }

  /**
   * カスタムプロフィールを保存
   */
  async saveCustomProfile(
    userId: string,
    profile: Partial<UserCustomProfile>,
  ): Promise<void> {
    const normalized = normalizeProfile(profile);
    if (normalized.errors.length) throw new Error(normalized.errors.join("\n"));
    profile = normalized.profile;
    const existing = await this.getCustomProfile(userId);
    const now = new Date().toISOString();

    const updated: UserCustomProfile = {
      userId,
      displayName:
        profile.displayName !== undefined
          ? profile.displayName
          : existing?.displayName,
      bio: profile.bio !== undefined ? profile.bio : existing?.bio,
      pronouns:
        profile.pronouns !== undefined ? profile.pronouns : existing?.pronouns,
      location:
        profile.location !== undefined ? profile.location : existing?.location,
      website:
        profile.website !== undefined ? profile.website : existing?.website,
      banner: profile.banner !== undefined ? profile.banner : existing?.banner,
      // new fields
      overviewConfig:
        profile.overviewConfig !== undefined
          ? profile.overviewConfig
          : existing?.overviewConfig,
      activitySource:
        profile.activitySource !== undefined
          ? profile.activitySource
          : existing?.activitySource,
      themeColor:
        profile.themeColor !== undefined
          ? profile.themeColor
          : existing?.themeColor,
      favoriteEmojis:
        profile.favoriteEmojis !== undefined
          ? profile.favoriteEmojis
          : existing?.favoriteEmojis,
      favoriteImage:
        profile.favoriteImage !== undefined
          ? profile.favoriteImage
          : existing?.favoriteImage,
      badges: existing?.badges,
      privacy: {
        ...{
          showStats: true,
          showServers: true,
          showActivity: true,
          allowPublicView: false,
        },
        ...existing?.privacy,
        ...profile.privacy,
      },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await this.database.set("", `UserProfiles/${userId}`, updated);
  }

  /**
   * プロフィールのバリデーション
   */
  validateProfile(profile: unknown): string[] {
    return normalizeProfile(profile).errors;
  }

  /**
   * バナープリセットを取得
   */
  getBannerPresets() {
    return {
      colors: [
        "#1DA1F2",
        "#794BC4",
        "#F91880",
        "#FFD400",
        "#00BA7C",
        "#FF6B6B",
        "#4A90E2",
        "#9B59B6",
        "#E74C3C",
        "#3498DB",
        "#2ECC71",
        "#F39C12",
      ],
      gradients: [
        {
          id: "sunset",
          colors: ["#FF512F", "#DD2476"],
          direction: "horizontal" as const,
          name: "サンセット",
        },
        {
          id: "ocean",
          colors: ["#2E3192", "#1BFFFF"],
          direction: "diagonal" as const,
          name: "オーシャン",
        },
        {
          id: "purple-dream",
          colors: ["#c471f5", "#fa71cd"],
          direction: "horizontal" as const,
          name: "パープルドリーム",
        },
        {
          id: "forest",
          colors: ["#134E5E", "#71B280"],
          direction: "vertical" as const,
          name: "フォレスト",
        },
        {
          id: "fire",
          colors: ["#f12711", "#f5af19"],
          direction: "diagonal" as const,
          name: "ファイア",
        },
        {
          id: "cool-blue",
          colors: ["#2193b0", "#6dd5ed"],
          direction: "horizontal" as const,
          name: "クールブルー",
        },
      ],
      patterns: [
        {
          id: "dots",
          name: "ドット",
          preview:
            "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImRvdHMiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMyIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjMpIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2RvdHMpIi8+PC9zdmc+",
        },
        {
          id: "grid",
          name: "グリッド",
          preview:
            "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHBhdGggZD0iTSAwIDQwIEwgNDAgNDAgNDAgMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMikiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==",
        },
      ],
    };
  }
}
