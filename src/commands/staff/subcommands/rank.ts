import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType,
    SlashCommandSubcommandBuilder,
    MessageFlags,
    TextChannel
} from 'discord.js';
import { rankManager, RankPreset } from '../../../core/RankManager.js';
import { Logger } from '../../../utils/Logger.js';

/**
 * /staff rank サブコマンド
 * スタッフ用のランク管理機能
 */
export default {
    name: 'rank',
    description: 'ランクシステムの管理',

    builder: (subcommand: SlashCommandSubcommandBuilder) => {
        return subcommand
            .setName('rank')
            .setDescription('ランクシステムを管理します')
            .addStringOption(option =>
                option
                    .setName('action')
                    .setDescription('実行するアクション')
                    .setRequired(true)
                    .addChoices(
                        { name: 'プリセット一覧', value: 'list-presets' },
                        { name: 'プリセット作成', value: 'create-preset' },
                        { name: 'プリセット削除', value: 'delete-preset' },
                        { name: 'パネル作成', value: 'create-panel' },
                        { name: 'パネル削除', value: 'delete-panel' },
                        { name: '設定: 通知チャンネル', value: 'set-notify-channel' },
                        { name: '設定: 更新間隔', value: 'set-update-interval' },
                        { name: 'XP付与', value: 'add-xp' },
                        { name: 'XP設定', value: 'set-xp' },
                        { name: 'ランキング表示', value: 'show-ranking' }
                    )
            )
            .addStringOption(option =>
                option
                    .setName('preset')
                    .setDescription('プリセット名')
                    .setRequired(false)
            )
            .addChannelOption(option =>
                option
                    .setName('channel')
                    .setDescription('対象チャンネル')
                    .setRequired(false)
                    .addChannelTypes(ChannelType.GuildText)
            )
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('対象ユーザー')
                    .setRequired(false)
            )
            .addIntegerOption(option =>
                option
                    .setName('value')
                    .setDescription('数値（XP、更新間隔など）')
                    .setRequired(false)
                    .setMinValue(0)
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

        // 権限チェック
        const member = interaction.guild.members.cache.get(interaction.user.id);
        if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({
                content: '❌ このコマンドを使用するには「サーバー管理」権限が必要です。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const action = interaction.options.getString('action', true);
        const guildId = interaction.guild.id;

        try {
            switch (action) {
                case 'list-presets':
                    await handleListPresets(interaction, guildId);
                    break;
                case 'create-preset':
                    await handleCreatePreset(interaction, guildId);
                    break;
                case 'delete-preset':
                    await handleDeletePreset(interaction, guildId);
                    break;
                case 'create-panel':
                    await handleCreatePanel(interaction, guildId);
                    break;
                case 'delete-panel':
                    await handleDeletePanel(interaction, guildId);
                    break;
                case 'set-notify-channel':
                    await handleSetNotifyChannel(interaction, guildId);
                    break;
                case 'set-update-interval':
                    await handleSetUpdateInterval(interaction, guildId);
                    break;
                case 'add-xp':
                    await handleAddXp(interaction, guildId);
                    break;
                case 'set-xp':
                    await handleSetXp(interaction, guildId);
                    break;
                case 'show-ranking':
                    await handleShowRanking(interaction, guildId);
                    break;
                default:
                    await interaction.reply({
                        content: '❌ 不明なアクションです。',
                        flags: MessageFlags.Ephemeral
                    });
            }
        } catch (error) {
            Logger.error(`Staff rank command error (${action}):`, error);
            
            const errorMessage = error instanceof Error ? error.message : '不明なエラー';
            const replyContent = `❌ コマンドの実行中にエラーが発生しました: ${errorMessage}`;

            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ content: replyContent });
            } else {
                await interaction.reply({
                    content: replyContent,
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    }
};

/**
 * プリセット一覧を表示
 */
async function handleListPresets(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const data = await rankManager.getRankingData(guildId);

    if (data.rankPresets.length === 0) {
        await interaction.editReply('📋 プリセットがありません。');
        return;
    }

    const embed = new EmbedBuilder()
        .setColor('#4A90E2')
        .setTitle('📋 ランクプリセット一覧')
        .setDescription(`全 ${data.rankPresets.length} 件のプリセット`);

    for (const preset of data.rankPresets) {
        const rankNames = preset.ranks.map(r => r.name).join(', ');
        embed.addFields({
            name: preset.name,
            value: `説明: ${preset.description || 'なし'}\nランク数: ${preset.ranks.length}\nランク: ${rankNames}`,
            inline: false
        });
    }

    await interaction.editReply({ embeds: [embed] });
}

/**
 * プリセットを作成
 */
async function handleCreatePreset(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const presetName = interaction.options.getString('preset');
    
    if (!presetName) {
        await interaction.editReply('❌ プリセット名を指定してください。');
        return;
    }

    const data = await rankManager.getRankingData(guildId);

    // 既存チェック
    if (data.rankPresets.find(p => p.name === presetName)) {
        await interaction.editReply('❌ 同名のプリセットが既に存在します。');
        return;
    }

    // デフォルトのランク構成でプリセットを作成
    const newPreset: RankPreset = {
        name: presetName,
        description: 'カスタムプリセット',
        ranks: [
            { name: 'Beginner', minXp: 0, maxXp: 499, color: '#95A5A6' },
            { name: 'Intermediate', minXp: 500, maxXp: 1999, color: '#3498DB' },
            { name: 'Advanced', minXp: 2000, maxXp: 4999, color: '#9B59B6' },
            { name: 'Expert', minXp: 5000, maxXp: 999999, color: '#E74C3C' }
        ],
        rewards: []
    };

    data.rankPresets.push(newPreset);
    await rankManager.saveRankingData(guildId, data);

    const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('✅ プリセット作成完了')
        .setDescription(`プリセット「${presetName}」を作成しました。`)
        .addFields({
            name: '📝 次のステップ',
            value: 'Web UIでランクの編集や報酬の設定ができます。',
            inline: false
        });

    await interaction.editReply({ embeds: [embed] });
    Logger.info(`Created rank preset: ${presetName} in guild ${guildId}`);
}

/**
 * プリセットを削除
 */
async function handleDeletePreset(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const presetName = interaction.options.getString('preset');
    
    if (!presetName) {
        await interaction.editReply('❌ プリセット名を指定してください。');
        return;
    }

    const data = await rankManager.getRankingData(guildId);
    const index = data.rankPresets.findIndex(p => p.name === presetName);

    if (index === -1) {
        await interaction.editReply('❌ 指定されたプリセットが見つかりません。');
        return;
    }

    // デフォルトプリセットの削除は禁止
    if (index === 0 && data.rankPresets.length === 1) {
        await interaction.editReply('❌ 最後のプリセットは削除できません。');
        return;
    }

    data.rankPresets.splice(index, 1);
    await rankManager.saveRankingData(guildId, data);

    await interaction.editReply(`✅ プリセット「${presetName}」を削除しました。`);
    Logger.info(`Deleted rank preset: ${presetName} from guild ${guildId}`);
}

/**
 * ランクパネルを作成
 */
async function handleCreatePanel(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const presetName = interaction.options.getString('preset') || 'default';
    const channel = interaction.options.getChannel('channel') as TextChannel || interaction.channel as TextChannel;

    if (!channel) {
        await interaction.editReply('❌ チャンネルを指定してください。');
        return;
    }

    const data = await rankManager.getRankingData(guildId);
    const preset = data.rankPresets.find(p => p.name === presetName);

    if (!preset) {
        await interaction.editReply('❌ 指定されたプリセットが見つかりません。');
        return;
    }

    // パネルメッセージを作成
    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`🏆 ${preset.name} ランキング`)
        .setDescription('サーバー内のトップランカー\n\n読み込み中...')
        .setTimestamp();

    const message = await channel.send({ embeds: [embed] });

    // パネル情報をDBに保存
    const panelId = `panel-${Date.now()}`;
    data.panels[panelId] = {
        channelId: channel.id,
        messageId: message.id,
        preset: presetName,
        lastUpdate: new Date().toISOString(),
        topCount: 10
    };

    await rankManager.saveRankingData(guildId, data);

    // パネル更新タイマーを開始
    await rankManager.startPanelUpdateTimer(guildId);

    // 即座に更新
    await rankManager.updateAllPanels(guildId);

    await interaction.editReply(
        `✅ ランクパネルを作成しました。\n` +
        `チャンネル: <#${channel.id}>\n` +
        `プリセット: ${presetName}\n` +
        `パネルID: ${panelId}`
    );

    Logger.info(`Created rank panel ${panelId} in guild ${guildId}`);
}

/**
 * パネルを削除
 */
async function handleDeletePanel(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const data = await rankManager.getRankingData(guildId);
    const panelIds = Object.keys(data.panels);

    if (panelIds.length === 0) {
        await interaction.editReply('❌ パネルが存在しません。');
        return;
    }

    // 最初のパネルを削除（簡易実装）
    const panelId = panelIds[0];
    const panel = data.panels[panelId];

    // メッセージを削除
    try {
        const channel = interaction.guild?.channels.cache.get(panel.channelId) as TextChannel;
        if (channel) {
            const message = await channel.messages.fetch(panel.messageId).catch(() => null);
            if (message) {
                await message.delete();
            }
        }
    } catch (error) {
        Logger.warn(`Failed to delete panel message: ${error}`);
    }

    delete data.panels[panelId];
    await rankManager.saveRankingData(guildId, data);

    await interaction.editReply(`✅ パネル ${panelId} を削除しました。`);
    Logger.info(`Deleted rank panel ${panelId} from guild ${guildId}`);
}

/**
 * 通知チャンネルを設定
 */
async function handleSetNotifyChannel(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.options.getChannel('channel') as TextChannel;

    if (!channel) {
        await interaction.editReply('❌ チャンネルを指定してください。');
        return;
    }

    const data = await rankManager.getRankingData(guildId);
    data.settings.notifyChannelId = channel.id;
    await rankManager.saveRankingData(guildId, data);

    await interaction.editReply(`✅ ランクアップ通知チャンネルを <#${channel.id}> に設定しました。`);
    Logger.info(`Set rank notify channel to ${channel.id} in guild ${guildId}`);
}

/**
 * 更新間隔を設定
 */
async function handleSetUpdateInterval(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const minutes = interaction.options.getInteger('value');

    if (!minutes || minutes < 1) {
        await interaction.editReply('❌ 更新間隔（分）を指定してください（最小: 1分）。');
        return;
    }

    const data = await rankManager.getRankingData(guildId);
    data.settings.updateIntervalMs = minutes * 60 * 1000;
    await rankManager.saveRankingData(guildId, data);

    // タイマーを再起動
    await rankManager.startPanelUpdateTimer(guildId);

    await interaction.editReply(`✅ パネルの更新間隔を ${minutes} 分に設定しました。`);
    Logger.info(`Set panel update interval to ${minutes} minutes in guild ${guildId}`);
}

/**
 * ユーザーにXPを付与
 */
async function handleAddXp(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('user');
    const xp = interaction.options.getInteger('value');

    if (!user || !xp) {
        await interaction.editReply('❌ ユーザーとXP量を指定してください。');
        return;
    }

    await rankManager.addXp(guildId, user.id, xp, 'staff-command');

    await interaction.editReply(`✅ ${user.tag} に ${xp} XP を付与しました。`);
    Logger.info(`Added ${xp} XP to user ${user.id} in guild ${guildId} (staff command)`);
}

/**
 * ユーザーのXPを設定
 */
async function handleSetXp(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('user');
    const xp = interaction.options.getInteger('value');

    if (!user || xp === null) {
        await interaction.editReply('❌ ユーザーとXP量を指定してください。');
        return;
    }

    const data = await rankManager.getRankingData(guildId);
    
    if (!data.users[user.id]) {
        data.users[user.id] = {
            xp: 0,
            lastUpdated: new Date().toISOString(),
            dailyXp: 0,
            dailyXpResetDate: new Date().toISOString().split('T')[0]
        };
    }

    data.users[user.id].xp = xp;
    data.users[user.id].lastUpdated = new Date().toISOString();
    await rankManager.saveRankingData(guildId, data);

    await interaction.editReply(`✅ ${user.tag} のXPを ${xp} に設定しました。`);
    Logger.info(`Set XP to ${xp} for user ${user.id} in guild ${guildId} (staff command)`);
}

/**
 * ランキングを表示
 */
async function handleShowRanking(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const leaderboard = await rankManager.getLeaderboard(guildId, 10);

    if (leaderboard.length === 0) {
        await interaction.editReply('📊 まだランキングデータがありません。');
        return;
    }

    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🏆 サーバーランキング TOP 10')
        .setDescription('サーバー内のトップランカー')
        .setTimestamp();

    for (let i = 0; i < leaderboard.length; i++) {
        const entry = leaderboard[i];
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        
        embed.addFields({
            name: `${medal} <@${entry.userId}>`,
            value: `**XP:** ${entry.xp.toLocaleString()} | **ランク:** ${entry.rank}`,
            inline: false
        });
    }

    await interaction.editReply({ embeds: [embed] });
}
