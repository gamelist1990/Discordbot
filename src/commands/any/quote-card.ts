import {
    ApplicationCommandType,
    AttachmentBuilder,
    ContextMenuCommandBuilder,
    MessageContextMenuCommandInteraction,
    MessageFlags,
} from 'discord.js';
import * as cheerio from 'cheerio';
import { assertSafeHttpUrl } from '../../core/ChatAIChannel/tools/urlSafety.js';
import { renderQuoteCard } from '../../core/media/QuoteCardRenderer.js';
import { SlashCommand } from '../../types/command.js';

const IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)$/iu;
const USER_MENTION_PATTERN = /<@!?(\d+)>/gu;
const URL_PATTERN = /https?:\/\/[^\s<]+/giu;
const LINK_PREVIEW_TIMEOUT_MS = 8_000;
const LINK_PREVIEW_MAX_BYTES = 512 * 1024;

interface LinkPreview {
    siteName: string;
    title?: string;
    description?: string;
    imageUrl?: string;
}

function cleanMetadata(value: string | undefined, maximumLength: number): string | undefined {
    const cleaned = value?.replace(/\s+/gu, ' ').trim();
    if (!cleaned) return undefined;
    return Array.from(cleaned).slice(0, maximumLength).join('');
}

function getSiteName(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./iu, '');
    } catch {
        return 'Webサイト';
    }
}

async function fetchLinkPreview(url: string): Promise<LinkPreview | undefined> {
    const safeUrl = await assertSafeHttpUrl(url);
    if (!safeUrl.ok) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LINK_PREVIEW_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                accept: 'text/html,application/xhtml+xml',
                'user-agent': 'PexQuoteCard/1.0',
            },
        });
        if (!response.ok) return undefined;

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
            return undefined;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const html = buffer.subarray(0, LINK_PREVIEW_MAX_BYTES).toString('utf8');
        const $ = cheerio.load(html);
        const metadata = (property: string): string | undefined =>
            $(`meta[property="${property}"]`).first().attr('content')
            ?? $(`meta[name="${property}"]`).first().attr('content');

        const finalUrl = response.url || url;
        const rawImageUrl = metadata('og:image:secure_url')
            ?? metadata('og:image')
            ?? metadata('twitter:image');
        let imageUrl: string | undefined;
        if (rawImageUrl) {
            try {
                const resolvedImageUrl = new URL(rawImageUrl, finalUrl).toString();
                const safeImageUrl = await assertSafeHttpUrl(resolvedImageUrl);
                if (safeImageUrl.ok) imageUrl = resolvedImageUrl;
            } catch {
                // 不正または安全でないOG画像URLは無視し、テキスト版を使用する。
            }
        }

        return {
            siteName: cleanMetadata(metadata('og:site_name'), 50) ?? getSiteName(finalUrl),
            title: cleanMetadata(metadata('og:title') ?? $('title').first().text(), 100),
            description: cleanMetadata(
                metadata('og:description') ?? metadata('description'),
                180,
            ),
            imageUrl,
        };
    } catch {
        return undefined;
    } finally {
        clearTimeout(timeout);
    }
}

async function resolveUserMentions(
    content: string,
    interaction: MessageContextMenuCommandInteraction,
): Promise<string> {
    const userIds = [...content.matchAll(USER_MENTION_PATTERN)].map(match => match[1]);
    const uniqueUserIds = [...new Set(userIds)];
    const names = new Map<string, string>();

    await Promise.all(uniqueUserIds.map(async userId => {
        const member = interaction.guild?.members.cache.get(userId)
            ?? await interaction.guild?.members.fetch(userId).catch(() => null);
        const user = member?.user
            ?? interaction.client.users.cache.get(userId)
            ?? await interaction.client.users.fetch(userId).catch(() => null);
        names.set(userId, member?.displayName ?? user?.displayName ?? user?.username ?? '不明なユーザー');
    }));

    return content.replace(USER_MENTION_PATTERN, (_mention, userId: string) =>
        `@${names.get(userId) ?? '不明なユーザー'}`,
    );
}

const quoteCardCommand: SlashCommand = {
    data: new ContextMenuCommandBuilder()
        .setName('名言画像にする')
        .setType(ApplicationCommandType.Message),

    async execute(baseInteraction): Promise<void> {
        if (!baseInteraction.isMessageContextMenuCommand()) return;

        const interaction = baseInteraction as MessageContextMenuCommandInteraction;
        const message = interaction.targetMessage;
        const rawQuote = message.content.trim();
        const contentImage = message.attachments.find(attachment => {
            if (attachment.contentType?.startsWith('image/')) return true;
            return IMAGE_EXTENSIONS.test(attachment.name ?? attachment.url);
        });

        if (!rawQuote) {
            await interaction.reply({
                content: '❌ テキストが含まれているメッセージを選択してください。',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const author = message.author;
            const member = message.member;
            const authorName = member?.displayName ?? author.displayName ?? author.username;
            const quoteWithMentions = await resolveUserMentions(rawQuote, interaction);
            const firstUrl = quoteWithMentions.match(URL_PATTERN)?.[0];
            const linkPreview = firstUrl ? await fetchLinkPreview(firstUrl) : undefined;
            const quote = quoteWithMentions.replace(URL_PATTERN, matchedUrl =>
                `🔗 ${getSiteName(matchedUrl)} のリンク`,
            );

            const image = await renderQuoteCard({
                quote,
                authorName,
                authorHandle: author.username,
                avatarUrl: author.displayAvatarURL({ extension: 'png', size: 1024 }),
                contentImageUrl: contentImage?.url,
                linkPreview,
                style: 'mono',
                seed: message.id,
            });

            const attachment = new AttachmentBuilder(image, {
                name: `quote-${message.id}.png`,
                description: `${authorName} のメッセージを装飾した名言画像`,
            });

            await interaction.editReply({
                files: [attachment],
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            await interaction.editReply(
                `❌ 名言画像の生成に失敗しました: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    },
};

export default quoteCardCommand;