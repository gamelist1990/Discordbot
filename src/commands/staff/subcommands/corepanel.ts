import {
    ButtonInteraction,
    ChannelType,
    ChatInputCommandInteraction,
    ModalSubmitInteraction,
    SlashCommandSubcommandBuilder
} from 'discord.js';
import { coreFeatureManager } from '../../../core/corepanel/CoreFeatureManager.js';
import { buildCorePanelEmbed, getCorePanelKindLabel } from '../../../core/corepanel/panelMessage.js';
import { CoreFeaturePanelKind } from '../../../core/corepanel/types.js';

function isTextChannel(targetChannel: any): boolean {
    return targetChannel?.type !== ChannelType.GuildVoice && targetChannel?.type !== ChannelType.GuildCategory;
}

export default {
    name: 'corepanel',
    description: 'Core機能パネルの投稿、停止、ユーザーデータ初期化を行います',

    builder: (subcommand: SlashCommandSubcommandBuilder) => {
        return subcommand
            .setName('corepanel')
            .setDescription('Core機能パネルの投稿、停止、ユーザーデータ初期化を行います')
            .addStringOption((opt: any) =>
                opt.setName('action')
                    .setDescription('実行する操作')
                    .setRequired(false)
                    .addChoices(
                        { name: 'パネルを投稿', value: 'post' },
                        { name: '進行中セッションを停止', value: 'close' },
                        { name: 'ユーザーデータをリセット', value: 'reset' }
                    )
            )
            .addStringOption((opt: any) =>
                opt.setName('panel_kind')
                    .setDescription('投稿するパネルの種類')
                    .setRequired(false)
                    .addChoices(
                        { name: '統合', value: 'combined' },
                        { name: '性格診断だけ', value: 'personality' },
                        { name: 'レスバだけ', value: 'debate' }
                    )
            )
            .addChannelOption((opt: any) =>
                opt.setName('channel')
                    .setDescription('パネルを投稿するチャンネル（省略時は現在のチャンネル）')
                    .setRequired(false)
            )
            .addChannelOption((opt: any) =>
                opt.setName('target_channel')
                    .setDescription('停止対象のレスバ/性格診断チャンネル（省略時は該当種別を全停止）')
                    .setRequired(false)
            )
            .addRoleOption((opt: any) =>
                opt.setName('spectator_role')
                    .setDescription('レスバ観戦用のロール')
                    .setRequired(false)
            )
            .addUserOption((opt: any) =>
                opt.setName('user')
                    .setDescription('リセット対象のユーザー')
                    .setRequired(false)
            );
    },

    async handleInteraction(interaction: ButtonInteraction): Promise<void> {
        if (!interaction.customId.startsWith('corefeature:')) {
            return;
        }

        try {
            const handled = await coreFeatureManager.handleButtonInteraction(interaction);
            if (!handled) {
                await interaction.reply({
                    content: '❌ このボタンは無効か、現在は利用できません。',
                    ephemeral: true
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '処理に失敗しました。';
            if (interaction.deferred) {
                await interaction.editReply(`❌ ${errorMessage}`);
            } else {
                await interaction.reply({
                    content: `❌ ${errorMessage}`,
                    ephemeral: true
                });
            }
        }
    },

    async handleModalInteraction(interaction: ModalSubmitInteraction): Promise<void> {
        if (!interaction.customId.startsWith('corefeature:')) {
            return;
        }

        try {
            const handled = await coreFeatureManager.onModalSubmit(interaction);
            if (!handled) {
                await interaction.reply({
                    content: '❌ このモーダルは無効か、現在は利用できません。',
                    ephemeral: true
                });
            }
        } catch (error) {
            await interaction.reply({
                content: `❌ ${error instanceof Error ? error.message : '処理に失敗しました。'}`,
                ephemeral: true
            });
        }
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ このコマンドはサーバー内でのみ使えます。',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const action = interaction.options.getString('action') || 'post';
            const panelKind = (interaction.options.getString('panel_kind') as CoreFeaturePanelKind | null) || 'combined';
            if (action === 'close') {
                const targetChannel = interaction.options.getChannel('target_channel');
                if (targetChannel && !isTextChannel(targetChannel)) {
                    await interaction.editReply('❌ 停止対象には有効なテキストチャンネルを指定してください。');
                    return;
                }

                const closed = await coreFeatureManager.closeSessions(interaction.guild, {
                    channelId: targetChannel?.id,
                    panelKind,
                    reason: `Core panel session closed by ${interaction.user.tag}`
                });

                if (closed.length === 0) {
                    await interaction.editReply(
                        targetChannel
                            ? `ℹ️ ${getCorePanelKindLabel(panelKind)}で停止対象の進行中ルームは見つかりませんでした。`
                            : `ℹ️ ${getCorePanelKindLabel(panelKind)}で停止できる進行中ルームはありませんでした。`
                    );
                    return;
                }

                const lines = closed.slice(0, 10).map((entry) => `- ${entry.summary}`);
                const suffix = closed.length > 10 ? `\n他 ${closed.length - 10} 件` : '';
                await interaction.editReply(
                    `✅ ${getCorePanelKindLabel(panelKind)}のルームを ${closed.length} 件停止してクローズしました。\n${lines.join('\n')}${suffix}`
                );
                return;
            }

            if (action === 'reset') {
                const targetUser = interaction.options.getUser('user');
                if (!targetUser) {
                    await interaction.editReply('❌ リセット対象のユーザーを指定してください。');
                    return;
                }

                const resetResults = await coreFeatureManager.resetUserData(interaction.guild, {
                    userId: targetUser.id,
                    panelKind,
                    reason: `Core panel user reset by ${interaction.user.tag}`
                });

                if (resetResults.length === 0) {
                    await interaction.editReply(`ℹ️ ${getCorePanelKindLabel(panelKind)}ではリセット対象のデータが見つかりませんでした。`);
                    return;
                }

                await interaction.editReply([
                    `✅ ${targetUser} の ${getCorePanelKindLabel(panelKind)}データをリセットしました。`,
                    ...resetResults.map((entry) => `- ${entry.summary}`)
                ].join('\n'));
                return;
            }

            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
            if (!targetChannel || !isTextChannel(targetChannel)) {
                await interaction.editReply('❌ 有効なテキストチャンネルを指定してください。');
                return;
            }

            const selectedRole = interaction.options.getRole('spectator_role');
            const existingConfig = await coreFeatureManager.getPanelConfig(interaction.guild.id, panelKind);
            const spectatorRoleId = panelKind === 'personality'
                ? null
                : selectedRole?.id || existingConfig?.spectatorRoleId || null;

            const sentMessage = await (targetChannel as any).send({
                embeds: [buildCorePanelEmbed(panelKind, spectatorRoleId)],
                components: coreFeatureManager.buildPanelRows(interaction.guild.id, panelKind)
            });

            await coreFeatureManager.savePanelConfig(interaction.guild.id, {
                panelKind,
                guildId: interaction.guild.id,
                channelId: targetChannel.id,
                messageId: sentMessage.id,
                spectatorRoleId,
                updatedBy: interaction.user.id,
                updatedAt: new Date().toISOString()
            }, panelKind);

            await interaction.editReply(`✅ ${getCorePanelKindLabel(panelKind)}パネルを ${targetChannel} に投稿しました。`);
        } catch (error) {
            await interaction.editReply(`❌ ${error instanceof Error ? error.message : '投稿に失敗しました。'}`);
        }
    }
};
