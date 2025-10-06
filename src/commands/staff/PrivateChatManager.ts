import { 
    Guild,
    CategoryChannel,
    ChannelType,
    PermissionFlagsBits,
    TextChannel,
    EmbedBuilder
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
 * プライベートチャット管理クラス
 * Web UI からも使用される
 */
export class PrivateChatManager {
    /**
     * すべてのプライベートチャットを取得
     */
    static async getAllChats(): Promise<PrivateChatInfo[]> {
        const allChats = await database.get<PrivateChatInfo[]>(PRIVATE_CHATS_KEY, []);
        return allChats || [];
    }

    /**
     * ギルド別のプライベートチャットを取得
     */
    static async getChatsByGuild(guildId: string): Promise<PrivateChatInfo[]> {
        const allChats = await this.getAllChats();
        return allChats.filter(chat => chat.guildId === guildId);
    }

    /**
     * プライベートチャットを作成
     */
    static async createChat(
        guild: Guild,
        userId: string,
        staffId: string
    ): Promise<PrivateChatInfo> {
        // ユーザーを取得
        const user = await guild.members.fetch(userId).catch(() => null);
        if (!user) {
            throw new Error('ユーザーが見つかりません');
        }

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
        const channelName = `private-${user.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

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
                    id: userId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                },
                {
                    id: staffId,
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
            userId: userId,
            staffId: staffId,
            guildId: guild.id,
            createdAt: Date.now()
        };

        const chats = await this.getAllChats();
        chats.push(chatInfo);
        await database.set(PRIVATE_CHATS_KEY, chats);

        // ウェルカムメッセージを送信
        const welcomeEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('💬 プライベートチャットへようこそ')
            .setDescription(
                `<@${userId}> さん、このチャンネルはあなたとスタッフ <@${staffId}> の間の ` +
                `プライベートな会話用です。\n\n` +
                `質問や相談事があればお気軽にお話しください。`
            )
            .setTimestamp();

        await privateChannel.send({ embeds: [welcomeEmbed] });

        return chatInfo;
    }

    /**
     * プライベートチャットを削除
     */
    static async deleteChat(guild: Guild, chatId: string): Promise<boolean> {
        const chats = await this.getAllChats();
        const chatIndex = chats.findIndex(
            chat => chat.chatId === chatId || chat.channelId === chatId
        );

        if (chatIndex === -1) {
            return false;
        }

        const chat = chats[chatIndex];

        // チャンネルを削除
        const channel = guild.channels.cache.get(chat.channelId);
        if (channel) {
            await channel.delete('プライベートチャット終了');
        }

        // データベースから削除
        chats.splice(chatIndex, 1);
        await database.set(PRIVATE_CHATS_KEY, chats);

        return true;
    }

    /**
     * 特定のチャットを取得
     */
    static async getChat(chatId: string): Promise<PrivateChatInfo | null> {
        const allChats = await this.getAllChats();
        return allChats.find(chat => chat.chatId === chatId || chat.channelId === chatId) || null;
    }

    /**
     * チャット統計を取得
     */
    static async getStats(guildId: string): Promise<{
        total: number;
        today: number;
        thisWeek: number;
        thisMonth: number;
    }> {
        const chats = await this.getChatsByGuild(guildId);
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

        return {
            total: chats.length,
            today: chats.filter(chat => chat.createdAt >= oneDayAgo).length,
            thisWeek: chats.filter(chat => chat.createdAt >= oneWeekAgo).length,
            thisMonth: chats.filter(chat => chat.createdAt >= oneMonthAgo).length
        };
    }
}
