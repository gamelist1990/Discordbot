import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType,
    SlashCommandSubcommandBuilder,
    MessageFlags,
    TextChannel
} from 'discord.js';
import { rankManager } from '../../../core/RankManager.js';
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
                        { name: 'パネル作成', value: 'create-panel' },
                        { name: 'パネル削除', value: 'delete-panel' },
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
                case 'create-panel':
                    await handleCreatePanel(interaction, guildId);
                    break;
                case 'delete-panel':
                    await handleDeletePanel(interaction, guildId);
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
 * プリセットを削除
 */
/**
 * ランクパネルを作成
 */
async function handleCreatePanel(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
/**
 * 更新間隔を設定
 */
/**
 * ユーザーにXPを付与
 */
async function handleAddXp(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
    const presetName = data.rankPresets[0]?.name || 'default';
    
    if (!data.users[user.id]) {
        data.users[user.id] = {};
    }

    if (!data.users[user.id][presetName]) {
        data.users[user.id][presetName] = {
            xp: 0,
            lastUpdated: new Date().toISOString(),
            dailyXp: 0,
            dailyXpResetDate: new Date().toISOString().split('T')[0],
            lastMessageTime: undefined,
            vcAccumMs: 0
        };
    }

    data.users[user.id][presetName].xp = xp;
    data.users[user.id][presetName].lastUpdated = new Date().toISOString();
    await rankManager.saveRankingData(guildId, data);

    await interaction.editReply(`✅ ${user.tag} のXPを ${xp} に設定しました。`);
    Logger.info(`Set XP to ${xp} for user ${user.id} in guild ${guildId} (staff command)`);
}

/**
 * ランキングを表示
 */
async function handleShowRanking(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
        
        // ユーザー名を取得（見つからない場合はIDを表示）
        let userName = entry.userId;
        try {
            const member = await interaction.guild!.members.fetch(entry.userId);
            userName = member.displayName || member.user.username;
        } catch (error) {
            // ユーザーが見つからない場合はIDのまま
            Logger.warn(`Failed to fetch user ${entry.userId} for ranking display:`, error);
        }
        
        embed.addFields({
            name: `${medal} ${userName}`,
            value: `**XP:** ${entry.xp.toLocaleString()} | **ランク:** ${entry.rank}`,
            inline: false
        });
    }

    await interaction.editReply({ embeds: [embed] });
}
