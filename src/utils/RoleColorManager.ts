/**
 * ロール色管理ユーティリティ
 * Discordロールの色に基づいて絵文字を決定する機能を最適化
 */

export class RoleColorManager {
    // 色→絵文字のマッピングテーブル（パフォーマンス最適化）
    private static readonly COLOR_EMOJI_MAP: Record<string, string> = {
        // デフォルト色
        'default': '⚪',

        // 赤系
        'red': '🔴',
        'dark_red': '🔴',
        'crimson': '🔴',
        'maroon': '🔴',

        // 青系
        'blue': '🔵',
        'dark_blue': '🔵',
        'navy': '🔵',
        'royal_blue': '🔵',

        // 緑系
        'green': '🟢',
        'dark_green': '🟢',
        'forest_green': '🟢',
        'lime': '🟢',

        // 橙系
        'orange': '🟠',
        'dark_orange': '🟠',
        'coral': '🟠',

        // 紫系
        'purple': '🟣',
        'dark_purple': '🟣',
        'indigo': '🟣',
        'violet': '🟣',

        // ピンク系
        'pink': '🟣',
        'hot_pink': '🟣',
        'magenta': '🟣',

        // 黄色系
        'yellow': '🟡',
        'gold': '🟡',
        'goldenrod': '🟡',

        // シアン系
        'cyan': '🔵',
        'aqua': '🔵',
        'turquoise': '🔵',

        // 白/グレー系
        'white': '⚪',
        'light_gray': '⚪',
        'gray': '⚪',
        'dark_gray': '⚪',
        'black': '⚫'
    };

    // RGB値の閾値
    private static readonly THRESHOLDS = {
        STRONG_COMPONENT: 100, // この値以上の成分を「強い」とみなす
        MIN_SATURATION: 30     // 最小彩度
    };

    /**
     * RGB値から色カテゴリを判定
     * @param r 赤成分 (0-255)
     * @param g 緑成分 (0-255)
     * @param b 青成分 (0-255)
     * @returns 色カテゴリ
     */
    private static getColorCategory(r: number, g: number, b: number): string {
        // 彩度が低い場合は白/グレー
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max * 100;

        if (saturation < this.THRESHOLDS.MIN_SATURATION) {
            return max > 200 ? 'white' : max > 150 ? 'light_gray' : max > 100 ? 'gray' : 'dark_gray';
        }

        // RGBの強さを判定
        const isRedStrong = r >= this.THRESHOLDS.STRONG_COMPONENT;
        const isGreenStrong = g >= this.THRESHOLDS.STRONG_COMPONENT;
        const isBlueStrong = b >= this.THRESHOLDS.STRONG_COMPONENT;

        // 色の組み合わせに基づいてカテゴリを決定
        if (isRedStrong && isGreenStrong && isBlueStrong) return 'white'; // 白/グレー
        if (isRedStrong && isGreenStrong && !isBlueStrong) return 'orange'; // オレンジ
        if (isRedStrong && !isGreenStrong && isBlueStrong) return 'purple'; // 紫
        if (!isRedStrong && isGreenStrong && isBlueStrong) return 'cyan'; // シアン
        if (isRedStrong && !isGreenStrong && !isBlueStrong) return 'red'; // 赤
        if (!isRedStrong && isGreenStrong && !isBlueStrong) return 'green'; // 緑
        if (!isRedStrong && !isGreenStrong && isBlueStrong) return 'blue'; // 青

        // デフォルト（弱い色）
        return 'default';
    }

    /**
     * Discordロールの色から適切な絵文字を取得
     * @param color Discordロールの色値 (0x000000形式)
     * @returns 対応する絵文字
     */
    static getRoleColorEmoji(color: number): string {
        // デフォルト色の場合
        if (color === 0) {
            return this.COLOR_EMOJI_MAP.default;
        }

        // RGB値に変換
        const r = (color >> 16) & 0xFF;
        const g = (color >> 8) & 0xFF;
        const b = color & 0xFF;

        // 色カテゴリを取得
        const category = this.getColorCategory(r, g, b);

        // マッピングテーブルから絵文字を取得
        return this.COLOR_EMOJI_MAP[category] || this.COLOR_EMOJI_MAP.default;
    }

    /**
     * 利用可能な色カテゴリの一覧を取得
     * @returns 色カテゴリの配列
     */
    static getAvailableColorCategories(): string[] {
        return Object.keys(this.COLOR_EMOJI_MAP);
    }

    /**
     * 色カテゴリに対応する絵文字を取得
     * @param category 色カテゴリ
     * @returns 対応する絵文字
     */
    static getEmojiByCategory(category: string): string {
        return this.COLOR_EMOJI_MAP[category] || this.COLOR_EMOJI_MAP.default;
    }
}