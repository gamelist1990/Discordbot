/**
 * ユーザーカスタムプロフィール型定義
 */

export interface UserCustomProfile {
  userId: string;
  
  // 基本情報
  displayName?: string;           // カスタム表示名
  bio?: string;                   // 自己紹介文 (最大500文字)
  pronouns?: string;              // 代名詞 (例: "he/him", "she/her")
  // 場所情報: 表示ラベルと任意のリンク（例: 地図や外部プロフィール）
  location?: {
    label: string;                // 表示ラベル (例: "日本")
    url?: string;                 // 任意のリンク (例: マップや外部ページ)
    code?: string;                // ISO国コードなど (例: "JP")
    emoji?: string;               // 国旗やアイコン絵文字 (例: "🇯🇵")
  };
  website?: string;               // ウェブサイトURL
  
  // ビジュアルカスタマイズ
  banner?: {
    type: 'color' | 'gradient' | 'image' | 'pattern';
    value: string;                // カラーコード、画像URL、またはパターンID
    gradient?: {
      colors: string[];           // グラデーションの場合の色配列
      direction: 'horizontal' | 'vertical' | 'diagonal';
    };
  };
  
  themeColor?: string;            // テーマカラー (HEX)
  
  // 絵文字・アイコン
  favoriteEmojis?: Array<{
    emoji: string;                // 絵文字またはカスタム絵文字ID
    label?: string;               // ラベル (例: "気分", "趣味")
  }>;
  // お気に入りの画像 URL
  favoriteImage?: string;        // 画像の URL （任意）
  
  // バッジ
  badges?: Array<{
    id: string;                   // バッジID
    name: string;                 // バッジ名
    icon: string;                 // アイコン (絵文字またはURL)
    earnedAt: string;             // 取得日時 (ISO 8601)
  }>;
  
  // プライバシー設定
  privacy?: {
    showStats: boolean;           // 統計情報を表示するか
    showServers: boolean;         // 参加サーバーを表示するか
    showActivity: boolean;        // アクティビティを表示するか
    allowPublicView: boolean;     // 他のユーザーからの閲覧を許可するか
  };

  // 概要表示の設定 (表示ウィジェットなど)
  overviewConfig?: {
    cards?: Array<{
      id: string; type: 'text' | 'image' | 'sticker'; content: string;
      x?: number; y?: number; pxW?: number; pxH?: number; rotation?: number; zIndex?: number; opacity?: number;
      meta?: { fontSize?: number; color?: string; align?: 'left' | 'center' | 'right'; fontWeight?: string; fontFamily?: string };
    }>;
    widgets?: Array<{
      type: 'ranking' | 'rankPosition' | 'custom' | 'stats';
      guildId?: string;
      preset?: string;
    }>;
  };

  // アクティビティ表示のソース (例: 'ranking' でランキングを表示)
  activitySource?: 'ranking' | 'stats' | 'none';
  
  // メタデータ
  createdAt: string;              // プロフィール作成日時
  updatedAt: string;              // 最終更新日時
}

export interface BannerPreset {
  colors: string[];
  gradients: Array<{
    id: string;
    colors: string[];
    direction: 'horizontal' | 'vertical' | 'diagonal';
    name: string;
  }>;
  patterns: Array<{
    id: string;
    name: string;
    preview: string;
  }>;
}
