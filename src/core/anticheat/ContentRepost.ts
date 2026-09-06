import { AttachmentBuilder, EmbedBuilder, escapeMarkdown, PermissionFlagsBits, type Message } from 'discord.js';
import type { DetectionResult } from './types.js';
import { fetchPublicMedia } from './ContentMedia.js';
import { getMediaAttachments } from './detectors/MediaSafetyUtils.js';
import { displayContentExplanation } from './ContentExplanation.js';

export function spoilerText(text: string): string {
    // User supplied spoiler delimiters/backslashes must never close our wrapper.
    return `||${escapeMarkdown(text.replace(/\|/g, '｜')).replace(/@/g, '@\u200b')}||`;
}

export async function repostWithSpoilers(message: Message, repost: NonNullable<DetectionResult['spoilerRepost']>): Promise<string> {
    const channel = message.channel;
    // Voice-channel text chat, threads and forum posts are text-based even when
    // they are not exposed as a regular TextChannel by the runtime.
    const isTextBased = typeof channel.isTextBased === 'function' ? channel.isTextBased() : 'send' in channel;
    if (!isTextBased || !('send' in channel) || typeof channel.send !== 'function' || !message.deletable) {
        throw new Error('Cannot replace this message');
    }
    const permissions = 'permissionsFor' in channel ? channel.permissionsFor(message.client.user!) : null;
    if (permissions && !permissions.has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles,
        channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages])) {
        throw new Error('Missing permissions for spoiler repost');
    }
    const originalContent = message.content;
    const revision = message.editedTimestamp;
    const attachments = getMediaAttachments(message);
    const attachmentIds = [...message.attachments.keys()].join();
    if (repost.expected && (originalContent !== repost.expected.content || revision !== repost.expected.editedTimestamp
        || attachmentIds !== repost.expected.attachmentIds)) throw new Error('Message changed during analysis');
    // Preserve original attachments, including those not classified. No URL-only attachment loss after deletion.
    const files: AttachmentBuilder[] = [];
    let bytes = 0;
    for (const attachment of attachments) {
        const media = await fetchPublicMedia(attachment.url, 10 * 1024 * 1024);
        bytes += media.data.length;
        if (bytes > 24 * 1024 * 1024) throw new Error('Repost total size exceeded');
        const name = (attachment.name || 'attachment.bin').replace(/^SPOILER_/, '').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-120);
        files.push(new AttachmentBuilder(media.data, { name: `${files.length + 1}-${name}` }).setSpoiler(true));
    }
    // URL previews become actual spoiler attachments; original links remain in the hidden text.
    {
        for (const file of repost.files.filter(file => !attachments.some(attachment => attachment.url === file.sourceUrl))) {
            bytes += file.data.length;
            if (bytes > 24 * 1024 * 1024) throw new Error('Repost total size exceeded');
            files.push(new AttachmentBuilder(file.data, { name: file.name }).setSpoiler(true));
        }
    }
    const hidden = originalContent ? spoilerText(originalContent) : '';
    let description = 'この投稿には配慮が必要な内容が含まれる可能性があります。内容はネタバレ表示です。';
    if (hidden.length <= 3500) description += hidden ? `\n\n${hidden}` : '';
    else {
        files.push(new AttachmentBuilder(Buffer.from(originalContent), { name: 'original-message.txt' }).setSpoiler(true));
        description += '\n本文はネタバレ添付のテキストファイルに保存しました。';
    }
    if (files.length > 10) throw new Error('Too many attachments to preserve the complete post');
    const embed = new EmbedBuilder().setColor(0xe6a23c).setTitle('⚠️ コンテンツ注意・代理投稿')
        .setAuthor({ name: `${message.member?.displayName || message.author.username} (@${message.author.username})`.slice(0, 256) })
        .setDescription(description)
        .addFields({ name: '投稿ユーザー', value: `<@${message.author.id}> / ID: ${message.author.id}` },
            { name: '検知カテゴリ（AI推定）', value: repost.categories.join('・') })
        .setFooter({ text: `元投稿ID: ${message.id} • Botによる代理投稿` })
        .setTimestamp(message.createdAt);
    if (repost.aiExplanation) embed.addFields({ name: 'AIの判定理由（参考）', value: displayContentExplanation(repost.aiExplanation).slice(0, 1024) });
    const fresh = await message.fetch();
    if (fresh.content !== originalContent || fresh.editedTimestamp !== revision
        || [...fresh.attachments.keys()].join() !== attachmentIds) throw new Error('Message changed during analysis');
    const replacement = await channel.send({ embeds: [embed], files, allowedMentions: { parse: [], repliedUser: false } });
    try {
        const latest = await message.fetch();
        if (latest.content !== originalContent || latest.editedTimestamp !== revision
            || [...latest.attachments.keys()].join() !== attachmentIds) throw new Error('Message changed during upload');
        await message.delete();
    }
    catch {
        await replacement.delete();
        throw new Error('Original deletion failed; repost rolled back');
    }
    return replacement.id;
}
