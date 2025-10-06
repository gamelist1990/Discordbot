import { 
    ChatInputCommandInteraction, 
    EmbedBuilder, 
    MessageFlags,
    CategoryChannel,
    ChannelType,
    PermissionFlagsBits,
    User
} from 'discord.js';
import { database } from '../../core/Database.js';

/**
 * プライベートチャット情報
 */
export interface PrivateChatInfo {
    chatId: string;
    channelId: string;
    userId: string;
    staffId: string;
    guildId: string;
    createdAt: number;
}

/**
 * プライベートチャットデータベースキー
 */
const PRIVATE_CHATS_KEY = 'staff_private_chats';

/**
 * /staff privatechat サブコマンドを処理
 */
export async function handlePrivateChatSubcommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const action = interaction.options.getString('action', true);
    const targetUser = interaction.options.getUser('user');
    const chatId = interaction.options.getString('chat_id');

    switch (action) {
        case 'create':
            await createPrivateChat(interaction, targetUser);
            break;
        case 'list':
            await listPrivateChats(interaction);
            break;
        case 'delete':
            await deletePrivateChat(interaction, chatId);
            break;
        case 'manage':
            await openManagementUI(interaction);
            break;
        default:
            await interaction.reply({
                content: `❌ 不明なアクション: ${action}`,
                ephemeral: true
            });
    }
}

/**
 * プライベートチャットを作成
 */
async function createPrivateChat(
    interaction: ChatInputCommandInteraction,
    targetUser: User | null
): Promise<void> {
    if (!targetUser) {
        await interaction.reply({
            content: '❌ ユーザーを指定してください。',
            ephemeral: true
        });
        return;
    }

    if (!interaction.guild) {
        await interaction.reply({
            content: '❌ このコマンドはサーバー内でのみ使用できます。',
            ephemeral: true
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const guild = interaction.guild;

        // プライベートチャット用のカテゴリを取得または作成
        let category = guild.channels.cache.find(
            ch => ch.type === ChannelType.GuildCategory && ch.name === 'プライベートチャット'
        ) as CategoryChannel | undefined;

        if (!category) {
            category = await guild.channels.create({
                name: 'プライベートチャット',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    }
                ]
            });
        }

        // チャンネル名を生成
        const channelName = `private-${targetUser.username}`;

        // プライベートチャンネルを作成
        const privateChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: targetUser.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageMessages
                    ]
                }
            ]
        });

        // データベースに保存
        const chatInfo: PrivateChatInfo = {
            chatId: privateChannel.id,
            channelId: privateChannel.id,
            userId: targetUser.id,
            staffId: interaction.user.id,
            guildId: guild.id,
            createdAt: Date.now()
        };

        const chats = await getPrivateChats(guild.id);
        chats.push(chatInfo);
        await database.set(PRIVATE_CHATS_KEY, chats);

        // ウェルカムメッセージを送信
        const welcomeEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('💬 プライベートチャットへようこそ')
            .setDescription(
                `<@${targetUser.id}> さん、このチャンネルはあなたとスタッフ <@${interaction.user.id}> の間の ` +
                `プライベートな会話用です。\n\n` +
                `質問や相談事があればお気軽にお話しください。`
            )
            .setTimestamp();

        await privateChannel.send({ embeds: [welcomeEmbed] });

        // 成功メッセージ
        const successEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('✅ プライベートチャット作成完了')
            .addFields(
                { name: 'チャンネル', value: `<#${privateChannel.id}>`, inline: true },
                { name: 'ユーザー', value: `<@${targetUser.id}>`, inline: true },
                { name: 'チャットID', value: privateChannel.id, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        console.error('プライベートチャット作成エラー:', error);
        await interaction.editReply({
            content: '❌ プライベートチャットの作成中にエラーが発生しました。'
        });
    }
}

/**
 * プライベートチャット一覧を表示
 */
async function listPrivateChats(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await interaction.reply({
            content: '❌ このコマンドはサーバー内でのみ使用できます。',
            ephemeral: true
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const chats = await getPrivateChats(interaction.guild.id);

        if (chats.length === 0) {
            await interaction.editReply({
                content: 'ℹ️ 現在、アクティブなプライベートチャットはありません。'
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📋 プライベートチャット一覧')
            .setDescription(`全 ${chats.length} 件のプライベートチャット`)
            .setTimestamp();

        for (const chat of chats.slice(0, 10)) { // 最大10件まで表示
            const channel = interaction.guild.channels.cache.get(chat.channelId);
            const channelInfo = channel ? `<#${chat.channelId}>` : `削除済み (${chat.chatId})`;
            
            embed.addFields({
                name: `💬 Chat ID: ${chat.chatId.slice(0, 8)}...`,
                value: 
                    `**チャンネル:** ${channelInfo}\n` +
                    `**ユーザー:** <@${chat.userId}>\n` +
                    `**スタッフ:** <@${chat.staffId}>\n` +
                    `**作成日時:** <t:${Math.floor(chat.createdAt / 1000)}:R>`,
                inline: false
            });
        }

        if (chats.length > 10) {
            embed.setFooter({ text: `${chats.length - 10} 件のチャットが省略されています` });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('プライベートチャット一覧取得エラー:', error);
        await interaction.editReply({
            content: '❌ プライベートチャット一覧の取得中にエラーが発生しました。'
        });
    }
}

/**
 * プライベートチャットを削除
 */
async function deletePrivateChat(
    interaction: ChatInputCommandInteraction,
    chatId: string | null
): Promise<void> {
    if (!chatId) {
        await interaction.reply({
            content: '❌ チャットIDを指定してください。',
            ephemeral: true
        });
        return;
    }

    if (!interaction.guild) {
        await interaction.reply({
            content: '❌ このコマンドはサーバー内でのみ使用できます。',
            ephemeral: true
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const chats = await getPrivateChats(interaction.guild.id);
        const chatIndex = chats.findIndex(chat => chat.chatId === chatId || chat.channelId === chatId);

        if (chatIndex === -1) {
            await interaction.editReply({
                content: '❌ 指定されたチャットIDが見つかりませんでした。'
            });
            return;
        }

        const chat = chats[chatIndex];
        const channel = interaction.guild.channels.cache.get(chat.channelId);

        // チャンネルを削除
        if (channel) {
            await channel.delete('プライベートチャット終了');
        }

        // データベースから削除
        chats.splice(chatIndex, 1);
        await database.set(PRIVATE_CHATS_KEY, chats);

        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('✅ プライベートチャット削除完了')
            .addFields(
                { name: 'チャットID', value: chat.chatId, inline: true },
                { name: 'ユーザー', value: `<@${chat.userId}>`, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('プライベートチャット削除エラー:', error);
        await interaction.editReply({
            content: '❌ プライベートチャットの削除中にエラーが発生しました。'
        });
    }
}

/**
 * Web UI 管理画面を開く
 */
async function openManagementUI(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await interaction.reply({
            content: '❌ このコマンドはサーバー内でのみ使用できます。',
            ephemeral: true
        });
        return;
    }

    // SettingsServer インスタンスを取得
    const settingsServer = (interaction.client as any).settingsServer;

    if (!settingsServer) {
        await interaction.reply({
            content: '❌ Web UI管理機能が利用できません。設定サーバーが起動していない可能性があります。',
            ephemeral: true
        });
        return;
    }

    try {
        // セッションを作成
        const token = settingsServer.createSession(interaction.guildId, interaction.user.id);
        const managementUrl = `http://localhost:3000/staff/privatechat?token=${token}`;

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🖥️ プライベートチャット管理画面')
            .setDescription(
                `以下のURLからWeb UIでプライベートチャットを管理できます：\n\n` +
                `${managementUrl}\n\n` +
                `⚠️ このURLは30分間有効です。\n` +
                `⚠️ このURLは他の人と共有しないでください。`
            )
            .addFields(
                { name: '💡 機能', value: 'チャットの一覧表示・作成・削除が可能です', inline: false }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    } catch (error) {
        console.error('Web UI管理画面エラー:', error);
        await interaction.reply({
            content: '❌ 管理画面URLの生成中にエラーが発生しました。',
            ephemeral: true
        });
    }
}

/**
 * プライベートチャットデータを取得
 */
async function getPrivateChats(guildId: string): Promise<PrivateChatInfo[]> {
    const allChats = await database.get<PrivateChatInfo[]>(PRIVATE_CHATS_KEY, []);
    if (!allChats) return [];
    return allChats.filter(chat => chat.guildId === guildId);
}
