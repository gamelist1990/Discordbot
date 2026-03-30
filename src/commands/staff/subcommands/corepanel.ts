import {
    ButtonInteraction,
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    SlashCommandSubcommandBuilder
} from 'discord.js';
import { coreFeatureManager } from '../../../core/corepanel/CoreFeatureManager.js';
import { PERSONALITY_ARCHETYPES } from '../../../core/corepanel/constants.js';

function isTextChannel(targetChannel: any): boolean {
    return targetChannel?.type !== ChannelType.GuildVoice && targetChannel?.type !== ChannelType.GuildCategory;
}

function buildPanelEmbed(spectatorRoleId: string | null): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle('Core機能パネル')
        .setColor(0x5865f2)
        .setDescription([
            'このパネルでは、AI 性格診断と れすば をまとめて利用できます。',
            '',
            '**性格診断**',
            `AI と1対1で面談し、${Object.keys(PERSONALITY_ARCHETYPES).length}種類の性格ロールから1つを判定します。`,
            '判定結果には観測した傾向タグも付きます。',
            '判定後は専用ロールを付与し、再挑戦は1週間後です。',
            '',
            '**れすば**',
            'お題を決めて 賛成/反対 を選び、AI か論破王と勝負できます。',
            'スタッフは観戦用の AI vs AI れすばも作成できます。',
            '勝つと論破スコアが加算され、一定成績で論破王になれます。',
            spectatorRoleId ? `観戦ロール: <@&${spectatorRoleId}>` : '観戦ロール: 未設定'
        ].join('\n'))
        .setFooter({ text: '論破王対戦は論破王のみ作成・参加できます。部屋は結果後または1時間無操作で自動整理されます。' })
        .setTimestamp();
}

export default {
    name: 'corepanel',
    description: 'Core機能パネルを投稿します',

    builder: (subcommand: SlashCommandSubcommandBuilder) => {
        return subcommand
            .setName('corepanel')
            .setDescription('Core機能パネルを投稿します')
            .addChannelOption((opt: any) =>
                opt.setName('channel')
                    .setDescription('パネルを投稿するチャンネル（省略時は現在のチャンネル）')
                    .setRequired(false)
            )
            .addRoleOption((opt: any) =>
                opt.setName('spectator_role')
                    .setDescription('れすば観戦用のロール')
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

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ このコマンドはサーバー内でのみ使えます。',
                ephemeral: true
            });
            return;
        }

        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
        if (!targetChannel || !isTextChannel(targetChannel)) {
            await interaction.reply({
                content: '❌ 有効なテキストチャンネルを指定してください。',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const selectedRole = interaction.options.getRole('spectator_role');
            const existingConfig = await coreFeatureManager.getPanelConfig(interaction.guild.id);
            const spectatorRoleId = selectedRole?.id || existingConfig?.spectatorRoleId || null;

            const sentMessage = await (targetChannel as any).send({
                embeds: [buildPanelEmbed(spectatorRoleId)],
                components: coreFeatureManager.buildPanelRows(interaction.guild.id)
            });

            await coreFeatureManager.savePanelConfig(interaction.guild.id, {
                guildId: interaction.guild.id,
                channelId: targetChannel.id,
                messageId: sentMessage.id,
                spectatorRoleId,
                updatedBy: interaction.user.id,
                updatedAt: new Date().toISOString()
            });

            await interaction.editReply(`✅ Core機能パネルを ${targetChannel} に投稿しました。`);
        } catch (error) {
            await interaction.editReply(`❌ ${error instanceof Error ? error.message : '投稿に失敗しました。'}`);
        }
    }
};
