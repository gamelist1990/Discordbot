import { Database } from '../../core/Database.js';
import { UserCustomProfile } from '../types/profile.js';

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
      return await this.database.get('', `UserProfiles/${userId}`, null);
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
    profile: Partial<UserCustomProfile>
  ): Promise<void> {
    const existing = await this.getCustomProfile(userId);
    const now = new Date().toISOString();
    
    const updated: UserCustomProfile = {
      userId,
      displayName: profile.displayName !== undefined ? profile.displayName : existing?.displayName,
      bio: profile.bio !== undefined ? profile.bio : existing?.bio,
      pronouns: profile.pronouns !== undefined ? profile.pronouns : existing?.pronouns,
      location: profile.location !== undefined ? profile.location : existing?.location,
      website: profile.website !== undefined ? profile.website : existing?.website,
      banner: profile.banner !== undefined ? profile.banner : existing?.banner,
      // new fields
      overviewConfig: profile.overviewConfig !== undefined ? profile.overviewConfig : existing?.overviewConfig,
      activitySource: profile.activitySource !== undefined ? profile.activitySource : existing?.activitySource,
      themeColor: profile.themeColor !== undefined ? profile.themeColor : existing?.themeColor,
      favoriteEmojis: profile.favoriteEmojis !== undefined ? profile.favoriteEmojis : existing?.favoriteEmojis,
      badges: profile.badges !== undefined ? profile.badges : existing?.badges,
      privacy: profile.privacy !== undefined ? profile.privacy : existing?.privacy || {
        showStats: true,
        showServers: true,
        showActivity: true,
        allowPublicView: true,
      },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    
    await this.database.set('', `UserProfiles/${userId}`, updated);
  }
  
  /**
   * プロフィールのバリデーション
   */
  validateProfile(profile: Partial<UserCustomProfile>): string[] {
    const errors: string[] = [];
    
    if (profile.bio && profile.bio.length > 500) {
      errors.push('Bio must be 500 characters or less');
    }
    
    // Backwards-compatible: some persisted profiles may have a plain string location.
    if (profile.location && typeof (profile.location as any) === 'string') {
      const locStr = profile.location as unknown as string;
      if (locStr.length > 100) {
        errors.push('Location must be 100 characters or less');
      }
    }

    // If location is structured, validate label and optional url
    if (profile.location && typeof profile.location === 'object') {
      if (profile.location.label && profile.location.label.length > 100) {
        errors.push('Location label must be 100 characters or less');
      }
      if (profile.location.url) {
        try { new URL(profile.location.url); } catch { errors.push('Invalid location URL'); }
      }
    }

    if (profile.website) {
      try {
        new URL(profile.website);
      } catch {
        errors.push('Invalid website URL');
      }
    }
    
    if (profile.themeColor && !/^#[0-9A-F]{6}$/i.test(profile.themeColor)) {
      errors.push('Invalid theme color format (must be #RRGGBB)');
    }
    
    if (profile.favoriteEmojis && profile.favoriteEmojis.length > 10) {
      errors.push('Maximum 10 favorite emojis allowed');
    }

    if (profile.overviewConfig && profile.overviewConfig.widgets && profile.overviewConfig.widgets.length > 6) {
      errors.push('Maximum 6 overview widgets allowed');
    }

    // New: validate overviewConfig.cards if present
    if (profile.overviewConfig && (profile.overviewConfig as any).cards) {
      const cards = (profile.overviewConfig as any).cards;
      if (!Array.isArray(cards)) {
        errors.push('overviewConfig.cards must be an array');
      } else {
        if (cards.length > 48) errors.push('Maximum 48 overview cards allowed');
        for (const c of cards) {
          if (!c.type || !['text', 'image', 'sticker'].includes(c.type)) {
            errors.push('Invalid overview card type');
            break;
          }
          if (c.type === 'image' && c.content) {
            try { new URL(c.content); } catch { errors.push('Invalid image URL in overview card'); break; }
          }
          // optional layout position validation
          if (c.x !== undefined && (c.x < 0 || c.x > 1000)) { errors.push('Invalid card x position'); break; }
          if (c.y !== undefined && (c.y < 0 || c.y > 1000)) { errors.push('Invalid card y position'); break; }
          if (c.type === 'sticker' && c.content && c.content.length > 200) {
            errors.push('Sticker content too long'); break;
          }
          if (c.type === 'text' && c.content && c.content.length > 2000) {
            errors.push('Text card content too long'); break;
          }
          // validate size params
          if (c.w && (c.w < 1 || c.w > 12)) { errors.push('Card width must be between 1 and 12'); break; }
          if (c.h && (c.h < 1 || c.h > 12)) { errors.push('Card height must be between 1 and 12'); break; }
        }
      }
    }

    if (profile.activitySource && !['ranking', 'stats', 'none'].includes(profile.activitySource)) {
      errors.push('Invalid activitySource');
    }
    
    if (profile.displayName && profile.displayName.length > 32) {
      errors.push('Display name must be 32 characters or less');
    }
    
    return errors;
  }
  
  /**
   * バナープリセットを取得
   */
  getBannerPresets() {
    return {
      colors: [
        '#1DA1F2', '#794BC4', '#F91880', '#FFD400',
        '#00BA7C', '#FF6B6B', '#4A90E2', '#9B59B6',
        '#E74C3C', '#3498DB', '#2ECC71', '#F39C12',
      ],
      gradients: [
        {
          id: 'sunset',
          colors: ['#FF512F', '#DD2476'],
          direction: 'horizontal' as const,
          name: 'サンセット',
        },
        {
          id: 'ocean',
          colors: ['#2E3192', '#1BFFFF'],
          direction: 'diagonal' as const,
          name: 'オーシャン',
        },
        {
          id: 'purple-dream',
          colors: ['#c471f5', '#fa71cd'],
          direction: 'horizontal' as const,
          name: 'パープルドリーム',
        },
        {
          id: 'forest',
          colors: ['#134E5E', '#71B280'],
          direction: 'vertical' as const,
          name: 'フォレスト',
        },
        {
          id: 'fire',
          colors: ['#f12711', '#f5af19'],
          direction: 'diagonal' as const,
          name: 'ファイア',
        },
        {
          id: 'cool-blue',
          colors: ['#2193b0', '#6dd5ed'],
          direction: 'horizontal' as const,
          name: 'クールブルー',
        },
      ],
      patterns: [
        {
          id: 'dots',
          name: 'ドット',
          preview: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImRvdHMiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMyIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjMpIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2RvdHMpIi8+PC9zdmc+',
        },
        {
          id: 'grid',
          name: 'グリッド',
          preview: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHBhdGggZD0iTSAwIDQwIEwgNDAgNDAgNDAgMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMikiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==',
        },
      ],
    };
  }
}
