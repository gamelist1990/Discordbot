import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType,
    SlashCommandSubcommandBuilder,
    SlashCommandStringOption,
    SlashCommandChannelOption,
    ButtonInteraction,
    GuildMemberRoleManager,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    StringSelectMenuOptionBuilder
} from 'discord.js';

import { RolePresetManager } from '../../../core/RolePresetManager.js';

/**
 * ロールが操作可能かどうかをチェック
 */
function canManageRole(role: any, botMember: any): boolean {
    return role && role.position < botMember.roles.highest.position;
}

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
     * インタラクションのハンドリング（ロールパネル）
     */
    async handleInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
        if (!interaction.customId.startsWith('rolepanel:')) return;

        try {
            const parts = interaction.customId.split(':');
            // parts: ['rolepanel', guildId, presetId, action]
            const guildId = parts[1];
            const presetId = parts[2];
            const action = parts[3];

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

            // ボタンクリックの場合はロール選択メニューを表示
            if (interaction.isButton() && action === 'manage') {
                await this.showRoleSelectionMenu(interaction as ButtonInteraction, preset);
                return;
            }

            // SelectMenu選択の場合はロール変更処理
            if (interaction.isStringSelectMenu() && action === 'select') {
                await this.handleRoleChange(interaction as StringSelectMenuInteraction, preset);
                return;
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'エラー';

            if (interaction.deferred) {
                await interaction.editReply({
                    content: `❌ エラー: ${errorMsg}`
                });
            } else {
                await interaction.reply({
                    content: `❌ エラー: ${errorMsg}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    },

    /**
     * ボタンクリック時の処理 - ロール選択メニューを表示
     */
    async showRoleSelectionMenu(interaction: ButtonInteraction, preset: any): Promise<void> {
        const member = interaction.member as any;
        if (!member) return;

        // 現在のロール状態を取得
        const currentRoles = member.roles.cache.map((r: any) => r.id);

        // SelectMenuのオプションを作成
        const options: StringSelectMenuOptionBuilder[] = [];
        for (const roleId of preset.roles) {
            const role = interaction.guild!.roles.cache.get(roleId);
            if (!role) continue;

            const hasRole = currentRoles.includes(roleId);
            const option = new StringSelectMenuOptionBuilder()
                .setLabel(role.name)
                .setValue(roleId)
                .setDescription(`現在の状態: ${hasRole ? '付与済み' : '未付与'}`)
                .setEmoji(hasRole ? '✅' : '⬜')
                .setDefault(hasRole);

            options.push(option);
        }

        if (options.length === 0) {
            await interaction.reply({
                content: '❌ 選択可能なロールが見つかりません。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // SelectMenuを作成
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`rolepanel:${interaction.guild!.id}:${preset.id}:select`)
            .setPlaceholder('ロールを選択')
            .setMinValues(0)
            .setMaxValues(options.length);

        // オプションを追加
        if (options.length > 0) {
            selectMenu.addOptions(...options);
        }

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(selectMenu);

        await interaction.reply({
            content: `🎭 **${preset.name}** - ロールを選択してください`,
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    },

    /**
     * SelectMenu選択時の処理 - ロール変更処理
     */
    async handleRoleChange(interaction: StringSelectMenuInteraction, preset: any): Promise<void> {
        const member = interaction.member as any;
        if (!member) return;

        await interaction.deferUpdate();

        const selectedRoleIds = interaction.values;
        const currentRoles = (member.roles as GuildMemberRoleManager).cache.map(r => r.id);
        const results: string[] = [];
        const errors: string[] = [];
        const botMember = interaction.guild!.members.me;

        // プリセット内のロールとの差分を計算
        for (const roleId of preset.roles) {
            const role = interaction.guild!.roles.cache.get(roleId);
            if (!role) continue;

            const isSelected = selectedRoleIds.includes(roleId);
            const hasRole = currentRoles.includes(roleId);

            // 選択されているが持っていない → 追加
            if (isSelected && !hasRole) {
                try {
                    if (!canManageRole(role, botMember)) {
                        errors.push(`${role.name}: 権限不足`);
                        continue;
                    }

                    await (member.roles as GuildMemberRoleManager).add(role);
                    results.push(`✅ ${role.name} を追加`);
                } catch (error) {
                    errors.push(`${role.name}: エラー`);
                }
            }
            // 選択されていないが持っている → 削除
            else if (!isSelected && hasRole) {
                try {
                    await (member.roles as GuildMemberRoleManager).remove(role);
                    results.push(`➖ ${role.name} を削除`);
                } catch (error) {
                    errors.push(`${role.name}: エラー`);
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

        // 元のドロップダウンメッセージを結果に更新
        await interaction.editReply({
            content: message,
            components: []
        });
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

        // テキストチャンネルかどうかをチェック
        const isTextChannel = targetChannel?.type !== ChannelType.GuildVoice && targetChannel?.type !== ChannelType.GuildCategory;

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

            // ロール情報をチェック
            const missingRoles: string[] = [];

            for (const roleId of preset.roles) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (!canManageRole(role, botMember)) {
                    missingRoles.push(role ? `${role.name} (権限不足)` : roleId);
                }
            }

            if (preset.roles.length === missingRoles.length) {
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
                    '\n\n**使い方:**' +
                    '\n• ボタンをクリックしてロール管理を開始' +
                    '\n• 現在のロール状態を確認可能' +
                    '\n• ロールの追加/削除が可能' +
                    '\n\n**注意:** ボットより上位のロールは操作不可'
                )
                .setColor(0x5865F2)
                .setFooter({ text: `ID: ${preset.id}` })
                .setTimestamp();

            // ボタンを作成
            const roleButton = new ButtonBuilder()
                .setCustomId(`rolepanel:${interaction.guild.id}:${preset.id}:manage`)
                .setLabel('ロールを管理する')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎭');

            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(roleButton);

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

        } catch (error) {
            await interaction.editReply({
                content: `❌ エラー: ${error instanceof Error ? error.message : '不明'}`
            });
        }
    }
};
