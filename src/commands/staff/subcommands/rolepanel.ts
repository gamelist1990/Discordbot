import {
    ChatInputCommandInteraction,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    PermissionFlagsBits,
    ChannelType
} from 'discord.js';
import { RolePresetManager } from '../../../core/RolePresetManager.js';
import { Logger } from '../../../utils/Logger.js';

/**
 * /staff rolepanel サブコマンド
 */
export default {
    name: 'rolepanel',
    description: 'ロールパネルを投稿または管理します',

    builder: (subcommand: any) => {
        return subcommand
            .setName('rolepanel')
            .setDescription('ロールパネルを投稿します')
            .addStringOption((opt: any) =>
                opt.setName('preset')
                    .setDescription('使用するプリセットID')
                    .setRequired(true)
            )
            .addChannelOption((opt: any) =>
                opt.setName('channel')
                    .setDescription('パネルを投稿するチャンネル（省略時は現在のチャンネル）')
                    .setRequired(false)
            );
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ このコマンドはサーバー内でのみ使用できます。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Bot権限チェック
        const botMember = interaction.guild.members.me;
        if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            await interaction.reply({
                content: '❌ Botに「ロールの管理」権限がありません。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const presetId = interaction.options.getString('preset', true);
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

        // テキストベースのチャンネルかどうかをチェック
        const isTextChannel = targetChannel && (
            targetChannel.type === ChannelType.GuildText ||
            targetChannel.type === ChannelType.GuildAnnouncement ||
            targetChannel.type === ChannelType.GuildForum ||
            targetChannel.type === ChannelType.PublicThread ||
            targetChannel.type === ChannelType.PrivateThread
        );

        if (!targetChannel || !isTextChannel) {
            await interaction.reply({
                content: '❌ 有効なテキストチャンネルを指定してください。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // プリセットを取得
            const preset = await RolePresetManager.getPreset(interaction.guild.id, presetId);

            if (!preset) {
                await interaction.editReply({
                    content: `❌ プリセット '${presetId}' が見つかりません。Web管理画面で作成してください。`
                });
                return;
            }

            // ロール情報を取得
            const roleOptions: StringSelectMenuOptionBuilder[] = [];
            const missingRoles: string[] = [];

            for (const roleId of preset.roles) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (role) {
                    // ロール階層チェック
                    if (role.position >= botMember.roles.highest.position) {
                        missingRoles.push(`${role.name} (ボットより上位)`);
                        continue;
                    }

                    roleOptions.push(
                        new StringSelectMenuOptionBuilder()
                            .setLabel(role.name)
                            .setValue(roleId)
                            .setDescription(`${role.name} ロールを追加/削除`)
                            .setEmoji('🎭')
                    );
                } else {
                    missingRoles.push(roleId);
                }
            }

            if (roleOptions.length === 0) {
                await interaction.editReply({
                    content: `❌ プリセット内の有効なロールが見つかりませんでした。\n` +
                        `不足: ${missingRoles.join(', ')}`
                });
                return;
            }

            // Embedを作成
            const embed = new EmbedBuilder()
                .setTitle(`🎭 ${preset.name}`)
                .setDescription(
                    preset.description +
                    '\n\n下のメニューからロールを選択して、自分のロールを追加/削除できます。' +
                    (preset.allowMulti ? '\n複数選択可能です。' : '') +
                    '\n\n**注意:** 選択しているものが現在付与されているロールです。'
                )
                .setColor(0x5865F2)
                .setFooter({ text: `Preset ID: ${preset.id}` })
                .setTimestamp();

            // SelectMenuを作成
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`rolepanel:${interaction.guild.id}:${preset.id}`)
                .setPlaceholder('ロールを選択してください...')
                .setMinValues(0)
                .setMaxValues(preset.allowMulti ? roleOptions.length : 1)
                .addOptions(roleOptions);

            const row = new ActionRowBuilder<StringSelectMenuBuilder>()
                .addComponents(selectMenu);

            // パネルを投稿
            await (targetChannel as any).send({
                embeds: [embed],
                components: [row]
            });

            let warningText = '';
            if (missingRoles.length > 0) {
                warningText = `\n\n⚠️ 以下のロールはスキップされました: ${missingRoles.join(', ')}`;
            }

            await interaction.editReply({
                content: `✅ ロールパネル「${preset.name}」を ${targetChannel} に投稿しました！${warningText}`
            });

            Logger.info(`Role panel '${preset.id}' posted in guild ${interaction.guild.id} by ${interaction.user.tag}`);

        } catch (error) {
            Logger.error('Failed to post role panel:', error);
            await interaction.editReply({
                content: `❌ パネルの投稿に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`
            });
        }
    }
};
