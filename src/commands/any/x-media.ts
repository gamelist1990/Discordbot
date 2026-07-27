import {
    ActionRowBuilder,
    ApplicationCommandType,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ContextMenuCommandBuilder,
    GuildMember,
    MessageContextMenuCommandInteraction,
    MessageFlags,
    NewsChannel,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    StringSelectMenuOptionBuilder,
    TextChannel,
} from 'discord.js';
import path from 'node:path';
import { SlashCommand } from '../../types/command.js';
import { downloadXMedia, extractXStatusUrl } from '../../core/media/XMediaDownloader.js';
import { sendViaChannelWebhook } from '../../core/media/WebhookSender.js';

// ---------------------------------------------------------------------------
// セッション管理（Bot プロセス内 Map）
// ---------------------------------------------------------------------------
interface XMediaSession {
    files: string[];
    cleanup: () => Promise<void>;
    authorName: string;
    authorAvatarUrl: string;
    channelId: string;
    selectedIndex: number;
    expiresAt: number;
    invokingUserId: string;
}

const sessions = new Map<string, XMediaSession>();
const SESSION_TTL_MS = 15 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (session.expiresAt < now) {
            session.cleanup().catch(() => {});
            sessions.delete(id);
        }
    }
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// カスタム ID
// ---------------------------------------------------------------------------
const PREFIX = 'xmedia';
function buildPostAllId(sid: string) { return `${PREFIX}:post_all:${sid}`; }
function buildSelectId(sid: string)  { return `${PREFIX}:select:${sid}`; }
function buildPostSelId(sid: string) { return `${PREFIX}:post_sel:${sid}`; }

// ---------------------------------------------------------------------------
// UI ビルダー
// ---------------------------------------------------------------------------
function buildPostAllRow(sid: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
    const btn = new ButtonBuilder()
        .setCustomId(buildPostAllId(sid))
        .setLabel(disabled ? '送信済み' : 'チャンネルに投稿')
        .setEmoji('📤')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(btn);
}

function buildSelectRow(files: string[], sid: string, disabled = false): ActionRowBuilder<StringSelectMenuBuilder> {
    const opts = files.map((f, i) =>
        new StringSelectMenuOptionBuilder()
            .setLabel(`画像 ${i + 1}：${path.basename(f)}`)
            .setValue(String(i))
    );
    const menu = new StringSelectMenuBuilder()
        .setCustomId(buildSelectId(sid))
        .setPlaceholder('投稿する画像を選択')
        .addOptions(opts)
        .setDisabled(disabled);
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function buildPostSelRow(sid: string, disabled = false, chosen = false): ActionRowBuilder<ButtonBuilder> {
    const btn = new ButtonBuilder()
        .setCustomId(buildPostSelId(sid))
        .setLabel(disabled ? '送信済み' : (chosen ? '選択した画像を投稿' : '画像を選択してから投稿'))
        .setEmoji('🖼️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || !chosen);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(btn);
}

type AnyRow = ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>;

function buildActiveRows(session: XMediaSession, sid: string, chosen = false): AnyRow[] {
    if (session.files.length <= 1) return [buildPostAllRow(sid) as AnyRow];
    return [
        buildPostAllRow(sid) as AnyRow,
        buildSelectRow(session.files, sid) as AnyRow,
        buildPostSelRow(sid, false, chosen) as AnyRow,
    ];
}

function buildDisabledRows(session: XMediaSession, sid: string): AnyRow[] {
    if (session.files.length <= 1) return [buildPostAllRow(sid, true) as AnyRow];
    const chosen = session.selectedIndex >= 0;
    return [
        buildPostAllRow(sid, true) as AnyRow,
        buildSelectRow(session.files, sid, true) as AnyRow,
        buildPostSelRow(sid, true, chosen) as AnyRow,
    ];
}

// ---------------------------------------------------------------------------
// ボタン・セレクトメニューのインタラクション処理（EventHandler から呼ぶ）
// ---------------------------------------------------------------------------
export async function handleXMediaInteraction(
    interaction: ButtonInteraction | StringSelectMenuInteraction
): Promise<void> {
    const [, action, sid] = interaction.customId.split(':');
    const session = sessions.get(sid);

    if (!session) {
        await interaction.reply({ content: '❌ セッションが期限切れです。コマンドを再実行してください。', flags: MessageFlags.Ephemeral });
        return;
    }

    const channel = interaction.channel;
    if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
        await interaction.reply({ content: '❌ テキストチャンネルでのみ使用できます。', flags: MessageFlags.Ephemeral });
        return;
    }

    // 投稿ボタン押下時はユーザーの権限を再チェック
    if (action === 'post_all' || action === 'post_sel') {
        const member = interaction.member as GuildMember | null;
        const hasPerms = member
            ? (channel.permissionsFor(member)?.has([
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.AttachFiles,
              ]) ?? false)
            : false;
        if (!hasPerms) {
            await interaction.reply({
                content: '❌ このチャンネルへの送信権限がありません。',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
    }

    if (action === 'select' && interaction.isStringSelectMenu()) {
        session.selectedIndex = parseInt(interaction.values[0], 10);
        await interaction.update({ components: buildActiveRows(session, sid, true) });
        return;
    }

    if (action === 'post_all' && interaction.isButton()) {
        await interaction.deferUpdate();
        try {
            await sendViaChannelWebhook(channel, {
                username: session.authorName,
                avatarUrl: session.authorAvatarUrl,
                filePaths: session.files,
            });
            await interaction.editReply({ content: 'メディアを取得しました。', components: buildDisabledRows(session, sid) });
        } catch (err) {
            await interaction.followUp({ content: `❌ 送信に失敗しました: ${err instanceof Error ? err.message : String(err)}`, flags: MessageFlags.Ephemeral });
        }
        sessions.delete(sid);
        await session.cleanup();
        return;
    }

    if (action === 'post_sel' && interaction.isButton()) {
        if (session.selectedIndex < 0) {
            await interaction.reply({ content: '❌ 先に画像を選択してください。', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferUpdate();
        try {
            await sendViaChannelWebhook(channel, {
                username: session.authorName,
                avatarUrl: session.authorAvatarUrl,
                filePaths: [session.files[session.selectedIndex]],
            });
            await interaction.editReply({ content: 'メディアを取得しました。', components: buildDisabledRows(session, sid) });
        } catch (err) {
            await interaction.followUp({ content: `❌ 送信に失敗しました: ${err instanceof Error ? err.message : String(err)}`, flags: MessageFlags.Ephemeral });
        }
        sessions.delete(sid);
        await session.cleanup();
        return;
    }
}

// ---------------------------------------------------------------------------
// コマンド本体
// ---------------------------------------------------------------------------
const xMediaCommand: SlashCommand = {
    data: new ContextMenuCommandBuilder()
        .setName('Xのメディアを取得')
        .setType(ApplicationCommandType.Message),

    async execute(baseInteraction): Promise<void> {
        if (!baseInteraction.isMessageContextMenuCommand()) return;
        const interaction = baseInteraction as MessageContextMenuCommandInteraction;
        const sourceUrl = extractXStatusUrl(interaction.targetMessage.content);

        if (!sourceUrl) {
            await interaction.reply({
                content: '選択したメッセージにX（Twitter）の投稿リンクがありません。',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply('投稿の画像・動画を取得しています…');

        const attachmentLimit = (interaction as MessageContextMenuCommandInteraction & {
            attachmentSizeLimit?: number;
        }).attachmentSizeLimit ?? 10 * 1024 * 1024;

        const result = await downloadXMedia(sourceUrl, attachmentLimit);

        const author = interaction.targetMessage.author;
        const member = interaction.targetMessage.member;
        const authorName = member?.displayName ?? author.displayName ?? author.username;
        const authorAvatarUrl = member?.displayAvatarURL({ size: 256 }) ?? author.displayAvatarURL({ size: 256 });

        // コマンド実行者の現チャンネルへの送信権限チェック
        const invokingMember = interaction.member as GuildMember | null;
        const currentChannel = interaction.channel;
        const canPost =
            invokingMember && (currentChannel instanceof TextChannel || currentChannel instanceof NewsChannel)
                ? (currentChannel.permissionsFor(invokingMember)?.has([
                      PermissionFlagsBits.SendMessages,
                      PermissionFlagsBits.AttachFiles,
                  ]) ?? false)
                : false;

        const sid = interaction.id;
        sessions.set(sid, {
            files: result.files,
            cleanup: result.cleanup,
            authorName,
            authorAvatarUrl,
            channelId: interaction.channelId,
            selectedIndex: -1,
            expiresAt: Date.now() + SESSION_TTL_MS,
            invokingUserId: interaction.user.id,
        });

        const session = sessions.get(sid)!;
        await interaction.editReply({
            content: canPost
                ? `メディアを取得しました（${result.files.length} 件）。チャンネルに投稿しますか？`
                : `メディアを取得しました（${result.files.length} 件）。\n（このチャンネルへの送信権限がないため投稿できません）`,
            files: result.files,
            components: canPost ? buildActiveRows(session, sid) : [],
        });
    },
};

export default xMediaCommand;
