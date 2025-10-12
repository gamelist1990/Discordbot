/**
 * Discord CDN URLを生成するユーティリティ
 */

const DISCORD_CDN_BASE = 'https://cdn.discordapp.com';

/**
 * Discord User Avatar URLを取得
 * @param userId Discord User ID
 * @param avatarHash Avatar hash (例: cd3ea62793ad841dfb2ab9c15408fc76)
 * @param size 画像サイズ (デフォルト: 128)
 * @returns Avatar URL or null
 */
export function getDiscordAvatarUrl(
    userId: string,
    avatarHash?: string | null,
    size: number = 128
): string | null {
    if (!avatarHash) {
        // デフォルトアバターを返す (Discord discriminatorベース)
        const defaultAvatarIndex = parseInt(userId) % 5;
        return `${DISCORD_CDN_BASE}/embed/avatars/${defaultAvatarIndex}.png`;
    }

    // アニメーションGIFかどうかをチェック
    const isAnimated = avatarHash.startsWith('a_');
    const extension = isAnimated ? 'gif' : 'png';

    return `${DISCORD_CDN_BASE}/avatars/${userId}/${avatarHash}.${extension}?size=${size}`;
}

/**
 * Discord Guild Icon URLを取得
 * @param guildId Discord Guild ID
 * @param iconHash Icon hash
 * @param size 画像サイズ (デフォルト: 128)
 * @returns Icon URL or null
 */
export function getDiscordGuildIconUrl(
    guildId: string,
    iconHash?: string | null,
    size: number = 128
): string | null {
    if (!iconHash) return null;

    const isAnimated = iconHash.startsWith('a_');
    const extension = isAnimated ? 'gif' : 'png';

    return `${DISCORD_CDN_BASE}/icons/${guildId}/${iconHash}.${extension}?size=${size}`;
}

/**
 * 既存のURL文字列をパースしてDiscord CDN URLに変換
 * @param url 既存のURL (完全URLまたはhash)
 * @param userId User ID
 * @param size サイズ
 */
export function parseAvatarUrl(
    url: string | undefined | null,
    userId?: string,
    size: number = 128
): string | null {
    if (!url) {
        // UserIDが提供されていればデフォルトアバターを返す
        if (userId) {
            const defaultAvatarIndex = parseInt(userId) % 5;
            return `${DISCORD_CDN_BASE}/embed/avatars/${defaultAvatarIndex}.png`;
        }
        return null;
    }

    // 既に完全なURLの場合はそのまま返す
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }

    // hashのみの場合はURLを生成
    if (userId) {
        return getDiscordAvatarUrl(userId, url, size);
    }

    return null;
}

/**
 * アバター画像のフォールバック付きコンポーネント用のsrc属性を生成
 * @param avatarUrl Avatar URL or hash
 * @param userId User ID
 */
export function getAvatarSrc(avatarUrl: string | undefined | null, userId?: string): string {
    const url = parseAvatarUrl(avatarUrl, userId);
    
    if (url) {
        return url;
    }

    // 最終的なフォールバック: Material Iconsのpersonアイコンを使用
    // または、デフォルト画像のdata URIを返す
    return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23999"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';
}
