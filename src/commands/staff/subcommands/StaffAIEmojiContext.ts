import sharp from 'sharp';
import type { Guild } from 'discord.js';
import type { OpenAIContentPart } from '../../../types/openai.js';

const EMOJI_TAG = /<a?:[A-Za-z0-9_]{2,32}:(\d{15,22})>/g;
const NEED_EMOJIS = /絵文字|スタンプ|emoji|エモート|リアクション/i;
const VISUAL_QUESTION = /絵文字|スタンプ|emoji|エモート|見た目|絵柄|何これ|これ何|これなに/i;

export interface StaffEmoji {
    id: string;
    tag: string;
    url: string;
}

function referencedIds(text: string): string[] {
    return [...text.matchAll(EMOJI_TAG)].map(match => match[1]);
}

export function selectStaffEmojis(
    guild: Guild | null | undefined,
    prompt: string,
    recentMessages: string[] = [],
): { catalog: string; images: StaffEmoji[] } {
    if (!guild) return { catalog: '', images: [] };

    const available = [...guild.emojis.cache.values()]
        .filter(emoji => emoji.available !== false
            && emoji.name && /^[A-Za-z0-9_]{2,32}$/.test(emoji.name)
            && (emoji.roles.cache.size === 0
                || emoji.roles.cache.some(role => guild.members.me?.roles.cache.has(role.id))))
        .sort((a, b) => a.id.localeCompare(b.id));
    const byId = new Map(available.map(emoji => [emoji.id, emoji]));
    const ids = referencedIds(prompt);
    const recent = recentMessages.slice(-8).reverse();
    // "この絵文字は？" can refer to a custom emoji sent immediately before the command.
    if (ids.length === 0 && NEED_EMOJIS.test(prompt)) {
        const latest = recent.find(text => referencedIds(text).length > 0);
        if (latest) ids.push(...referencedIds(latest).slice(-2));
    }

    if (ids.length === 0 && !NEED_EMOJIS.test(prompt)) {
        return { catalog: '', images: [] };
    }
    const selectedIds = [...new Set(ids)].filter(id => byId.has(id));
    const catalogEmojis = selectedIds.map(id => byId.get(id)!);

    if (NEED_EMOJIS.test(prompt) && catalogEmojis.length < 12) {
        // For emoji lookup, add a small stable set; never dump the entire guild catalog.
        for (const emoji of available) {
            if (catalogEmojis.length >= 12) break;
            if (!selectedIds.includes(emoji.id)) catalogEmojis.push(emoji);
        }
    }
    const tags = catalogEmojis.map(emoji =>
        `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`);
    const images = selectedIds
        .map(id => byId.get(id)!)
        .slice(0, 2)
        .filter(() => VISUAL_QUESTION.test(prompt))
        .map(emoji => ({
            id: emoji.id,
            tag: `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`,
            url: emoji.url,
        }));

    return {
        catalog: tags.length
            ? '使えるカスタム絵文字（このタグのまま送信）: ' + tags.join(' ')
            : '',
        images,
    };
}

/** Only fetch emoji pixels when the user references an emoji and asks about it. */
export async function getStaffEmojiImageParts(
    emojis: StaffEmoji[],
    fetchImage: typeof fetch = fetch,
): Promise<OpenAIContentPart[]> {
    const parts: OpenAIContentPart[] = [];
    for (const emoji of emojis.slice(0, 2)) {
        try {
            // URLs originate from Discord's guild emoji cache, not from user-provided text.
            const url = new URL(emoji.url);
            if (url.protocol !== 'https:' ||
                !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) continue;
            const response = await fetchImage(url.toString(), { signal: AbortSignal.timeout(3000) });
            if (!response.ok || Number(response.headers.get('content-length') || 0) > 512_000) continue;
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length > 512_000) continue;
            const png = await sharp(bytes, { animated: false, limitInputPixels: 1_048_576 })
                .resize(96, 96, { fit: 'inside' }).png().toBuffer();
            parts.push({ type: 'text', text: `実際のカスタム絵文字画像 ${emoji.tag}:` });
            parts.push({
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${png.toString('base64')}`, detail: 'low' },
            });
        } catch {
            // If the image is unavailable, the model can still read the emoji name.
        }
    }
    return parts;
}
