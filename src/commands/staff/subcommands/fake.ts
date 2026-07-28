import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    NewsChannel,
    PermissionFlagsBits,
    SlashCommandSubcommandBuilder,
    TextChannel,
} from 'discord.js';
/**
 * /staff fake
 * 指定チャンネルへ任意のユーザー名・アイコンで Webhook 送信する汎用スタッフコマンド。
 */
const fakeSubcommand = {
    name: 'fake',
    description: '指定したユーザー名・アイコンで Webhook 送信',

    builder(subcommand: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
        return subcommand
            .setName('fake')
            .setDescription('指定したユーザー名・アイコンで Webhook 送信（スタッフ専用）')
            .addUserOption((opt) =>
                opt.setName('user')
                    .setDescription('なりすます Discord ユーザー')
                    .setRequired(true)
            )
            .addChannelOption((opt) =>
                opt.setName('channel')
                    .setDescription('送信先チャンネル（省略時: 現在のチャンネル）')
                    .setRequired(false)
            )
            .addStringOption((opt) =>
                opt.setName('content')
                    .setDescription('メッセージ本文')
                    .setRequired(false)
            )
            .addAttachmentOption((opt) =>
                opt.setName('file1').setDescription('添付ファイル 1').setRequired(false)
            )
            .addAttachmentOption((opt) =>
                opt.setName('file2').setDescription('添付ファイル 2').setRequired(false)
            )
            .addAttachmentOption((opt) =>
                opt.setName('file3').setDescription('添付ファイル 3').setRequired(false)
            )
            .addAttachmentOption((opt) =>
                opt.setName('file4').setDescription('添付ファイル 4').setRequired(false)
            );
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('user', true);
        const member     = interaction.guild?.members.cache.get(targetUser.id)
                        ?? await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
        const username   = member?.displayName ?? targetUser.displayName ?? targetUser.username;
        const avatarUrl  = member?.displayAvatarURL({ size: 256 })
                        ?? targetUser.displayAvatarURL({ size: 256 });
        const content    = interaction.options.getString('content') ?? undefined;

        // チャンネル解決
        const targetChannel =
            interaction.options.getChannel('channel') ?? interaction.channel;

        if (!targetChannel || !(targetChannel instanceof TextChannel || targetChannel instanceof NewsChannel)) {
            await interaction.editReply('❌ テキストチャンネルを指定してください。');
            return;
        }

        // Bot の MANAGE_WEBHOOKS 権限チェック
        const botMember = interaction.guild?.members.me;
        const channelPerms = targetChannel.permissionsFor(botMember ?? interaction.client.user!);
        if (!channelPerms?.has(PermissionFlagsBits.ManageWebhooks)) {
            await interaction.editReply(
                '❌ Bot にそのチャンネルへの MANAGE_WEBHOOKS 権限がありません。'
            );
            return;
        }

        // 添付ファイルをメモリ上の AttachmentBuilder に変換
        // （Webhook は URL か Buffer を受け付けるので、Discord CDN URL をそのまま渡す）
        const attachments: Array<{ url: string; name: string }> = [];
        for (const key of ['file1', 'file2', 'file3', 'file4'] as const) {
            const att = interaction.options.getAttachment(key);
            if (att) attachments.push({ url: att.url, name: att.name });
        }

        // AttachmentBuilder に変換して Webhook 経由で送信
        try {
            const { WebhookClient } = await import('discord.js');
            const webhooks = await targetChannel.fetchWebhooks();
            const botId = interaction.client.user?.id;
            let webhook = webhooks.find((wh) => wh.owner?.id === botId && wh.token);
            if (!webhook) {
                webhook = await targetChannel.createWebhook({
                    name: 'StaffFakeRelay',
                    reason: 'staff fake subcommand (auto-created)',
                });
            }
            if (!webhook.token) throw new Error('Webhook Token を取得できませんでした。');

            const client = new WebhookClient({ id: webhook.id, token: webhook.token });
            try {
                const files: AttachmentBuilder[] = attachments.map(
                    ({ url, name }) => new AttachmentBuilder(url, { name })
                );
                await client.send({
                    username: username.slice(0, 80),
                    avatarURL: avatarUrl,
                    content: content || undefined,
                    files: files.length > 0 ? files : undefined,
                    allowedMentions: { parse: [] },
                });
            } finally {
                client.destroy();
            }

            await interaction.editReply(
                `✅ **${targetChannel.toString()}** に \`${username}\` として送信しました。`
            );
        } catch (err) {
            await interaction.editReply(
                `❌ 送信に失敗しました: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    },
};

export default fakeSubcommand;
