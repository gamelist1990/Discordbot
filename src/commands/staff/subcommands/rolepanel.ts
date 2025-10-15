import {
    ChatInputCommandInteraction,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    PermissionFlagsBits,
    ChannelType,
    SlashCommandSubcommandBuilder,
    SlashCommandStringOption,
    SlashCommandChannelOption,
    StringSelectMenuInteraction,
    GuildMemberRoleManager
} from 'discord.js';
import { RolePresetManager } from '../../../core/RolePresetManager.js';
import { Logger } from '../../../utils/Logger.js';

/**
 * /staff rolepanel サブコマンド
 */
export default {
    name: 'rolepanel',
    description: 'ロールパネルを投稿または管理します',

    builder: (subcommand: SlashCommandSubcommandBuilder) => {
        return subcommand
            .setName('rolepanel')
            .setDescription('ロールパネルを投稿します')
            .addStringOption((opt: SlashCommandStringOption) =>
                opt.setName('preset')
                    .setDescription('使用するプリセットID')
                    .setRequired(true)
            )
            .addChannelOption((opt: SlashCommandChannelOption) =>
                opt.setName('channel')
                    .setDescription('パネルを投稿するチャンネル（省略時は現在のチャンネル）')
                    .setRequired(false)
            );
    },

    /**
     * SelectMenu インタラクションのハンドリング（ロールパネル）
     */
    async handleInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
        if (!interaction.customId.startsWith('rolepanel:')) return;

        try {
            const [, guildId, presetId] = interaction.customId.split(':');

            if (!interaction.guild || interaction.guild.id !== guildId) {
                await interaction.reply({
                    content: '❌ このパネルは別のサーバー用です。',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const member = interaction.member;
            if (!member) {
                await interaction.reply({
                    content: '❌ メンバー情報を取得できませんでした。',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // プリセットを取得
            const preset = await RolePresetManager.getPreset(guildId, presetId);
            if (!preset) {
                await interaction.reply({
                    content: '❌ このプリセットは削除されました。',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const selectedRoleIds = interaction.values as string[];
            const currentRoles = (member.roles as GuildMemberRoleManager).cache.map(r => r.id);

            const results: string[] = [];
            const errors: string[] = [];

            // プリセット内のロールとの差分を計算
            for (const roleId of preset.roles) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (!role) continue;

                const isSelected = selectedRoleIds.includes(roleId);
                const hasRole = currentRoles.includes(roleId);

                // 選択されているが持っていない → 追加
                if (isSelected && !hasRole) {
                    try {
                        // ロール階層チェック
                        const botMember = interaction.guild.members.me;
                        if (!botMember) {
                            errors.push(`${role.name}: ボットのメンバー情報を取得できません`);
                            continue;
                        }
                        if (role.position >= botMember.roles.highest.position) {
                            errors.push(`${role.name}: ボットより上位のロールです`);
                            continue;
                        }

                        await (member.roles as GuildMemberRoleManager).add(role);
                        results.push(`✅ ${role.name} を追加しました`);

                        // ログに記録
                        await RolePresetManager.logRoleChange({
                            timestamp: new Date().toISOString(),
                            guildId,
                            userId: member.user.id,
                            executorId: member.user.id,
                            presetId,
                            action: 'add',
                            roleId,
                            roleName: role.name,
                            success: true
                        });
                    } catch (error) {
                        const errorMsg = error instanceof Error ? error.message : '不明なエラー';
                        errors.push(`${role.name}: ${errorMsg}`);

                        await RolePresetManager.logRoleChange({
                            timestamp: new Date().toISOString(),
                            guildId,
                            userId: member.user.id,
                            executorId: member.user.id,
                            presetId,
                            action: 'add',
                            roleId,
                            roleName: role.name,
                            success: false,
                            error: errorMsg
                        });
                    }
                }
                // 選択されていないが持っている → 削除
                else if (!isSelected && hasRole) {
                    try {
                        await (member.roles as GuildMemberRoleManager).remove(role);
                        results.push(`➖ ${role.name} を削除しました`);

                        await RolePresetManager.logRoleChange({
                            timestamp: new Date().toISOString(),
                            guildId,
                            userId: member.user.id,
                            executorId: member.user.id,
                            presetId,
                            action: 'remove',
                            roleId,
                            roleName: role.name,
                            success: true
                        });
                    } catch (error) {
                        const errorMsg = error instanceof Error ? error.message : '不明なエラー';
                        errors.push(`${role.name}: ${errorMsg}`);

                        await RolePresetManager.logRoleChange({
                            timestamp: new Date().toISOString(),
                            guildId,
                            userId: member.user.id,
                            executorId: member.user.id,
                            presetId,
                            action: 'remove',
                            roleId,
                            roleName: role.name,
                            success: false,
                            error: errorMsg
                        });
                    }
                }
            }

            // 結果を表示
            let message = '';
            if (results.length > 0) {
                message += results.join('\n');
            }
            if (results.length === 0 && errors.length === 0) {
                message = '✅ 変更はありませんでした。';
            }
            if (errors.length > 0) {
                message += '\n\n**エラー:**\n' + errors.join('\n');
            }

            await interaction.editReply({ content: message });

            // ロール変更後に、ユーザーの現在のロールをデフォルト選択したSelectMenuでメッセージを更新
            try {
                const updatedCurrentRoles = (member.roles as GuildMemberRoleManager).cache.map(r => r.id);

                // ロールの色に基づいて絵文字を選択する関数
                const getRoleColorEmoji = (color: number): string => {
                    if (color === 0) return '⚪'; // デフォルト色

                    // RGB値に変換
                    const r = (color >> 16) & 0xFF;
                    const g = (color >> 8) & 0xFF;
                    const b = color & 0xFF;

                    // RGBの強さを判定するための閾値
                    const threshold = 100; // この値以上の成分を「強い」とみなす

                    const isRedStrong = r >= threshold;
                    const isGreenStrong = g >= threshold;
                    const isBlueStrong = b >= threshold;

                    // 色の組み合わせに基づいて絵文字を選択
                    if (isRedStrong && isGreenStrong && isBlueStrong) return '⚪'; // 白/グレー
                    if (isRedStrong && isGreenStrong && !isBlueStrong) return '🟠'; // オレンジ
                    if (isRedStrong && !isGreenStrong && isBlueStrong) return '🟣'; // 紫
                    if (!isRedStrong && isGreenStrong && isBlueStrong) return '🟢'; // ターコイズ
                    if (isRedStrong && !isGreenStrong && !isBlueStrong) return '🔴'; // 赤
                    if (!isRedStrong && isGreenStrong && !isBlueStrong) return '🟢'; // 緑
                    if (!isRedStrong && !isGreenStrong && isBlueStrong) return '🔵'; // 青

                    // デフォルト（弱い色）
                    return '⚪';
                };

                // プリセット内のロールからオプションを作成
                const roleOptions: StringSelectMenuOptionBuilder[] = [];
                for (const roleId of preset.roles) {
                    const role = interaction.guild.roles.cache.get(roleId);
                    if (role) {
                        // ロール階層チェック
                        const botMember = interaction.guild.members.me;
                        if (!botMember || role.position >= botMember.roles.highest.position) {
                            continue; // スキップ
                        }

                        const isDefault = updatedCurrentRoles.includes(roleId);
                        roleOptions.push(
                            new StringSelectMenuOptionBuilder()
                                .setLabel(role.name)
                                .setValue(roleId)
                                .setDescription(`${role.name} ロールを追加/削除`)
                                .setEmoji(getRoleColorEmoji(role.color))
                                .setDefault(isDefault)
                        );
                    }
                }

                if (roleOptions.length > 0) {
                    // 新しいSelectMenuを作成
                    const updatedSelectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`rolepanel:${interaction.guild.id}:${preset.id}`)
                        .setPlaceholder('ロールを選択してください...')
                        .setMinValues(0)
                        .setMaxValues(preset.allowMulti ? roleOptions.length : 1)
                        .addOptions(roleOptions);

                    const updatedRow = new ActionRowBuilder<StringSelectMenuBuilder>()
                        .addComponents(updatedSelectMenu);

                    // 元のメッセージを更新
                    await interaction.message.edit({
                        components: [updatedRow]
                    });
                }
            } catch (updateError) {
                Logger.warn('Failed to update role panel message:', updateError);
                // エラーが発生しても処理を続行
            }

        } catch (error) {
            Logger.error('Role panel interaction error:', error);

            const errorMsg = error instanceof Error ? error.message : '不明なエラー';

            if (interaction.deferred) {
                await interaction.editReply({
                    content: `❌ ロール変更中にエラーが発生しました: ${errorMsg}`
                });
            } else {
                await interaction.reply({
                    content: `❌ ロール変更中にエラーが発生しました: ${errorMsg}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
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

            // ロールの色に基づいて絵文字を選択する関数
            const getRoleColorEmoji = (color: number): string => {
                if (color === 0) return '⚪'; // デフォルト色

                // RGB値に変換
                const r = (color >> 16) & 0xFF;
                const g = (color >> 8) & 0xFF;
                const b = color & 0xFF;

                // RGBの強さを判定するための閾値
                const threshold = 100; // この値以上の成分を「強い」とみなす

                const isRedStrong = r >= threshold;
                const isGreenStrong = g >= threshold;
                const isBlueStrong = b >= threshold;

                // 色の組み合わせに基づいて絵文字を選択
                if (isRedStrong && isGreenStrong && isBlueStrong) return '⚪'; // 白/グレー
                if (isRedStrong && isGreenStrong && !isBlueStrong) return '🟠'; // オレンジ
                if (isRedStrong && !isGreenStrong && isBlueStrong) return '🟣'; // 紫
                if (!isRedStrong && isGreenStrong && isBlueStrong) return '🟢'; // ターコイズ
                if (isRedStrong && !isGreenStrong && !isBlueStrong) return '🔴'; // 赤
                if (!isRedStrong && isGreenStrong && !isBlueStrong) return '🟢'; // 緑
                if (!isRedStrong && !isGreenStrong && isBlueStrong) return '🔵'; // 青

                // デフォルト（弱い色）
                return '⚪';
            };

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
                            .setEmoji(getRoleColorEmoji(role.color))
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
