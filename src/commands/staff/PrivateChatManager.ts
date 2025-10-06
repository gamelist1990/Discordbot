import { 
    Guild,
    CategoryChannel,
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder
} from 'discord.js';
import { database } from '../../core/Database.js';

/**
 * プライベートチャット情報
 */
export interface PrivateChatInfo {
    chatId: string;
    channelId: string;
    vcId?: string; // 対応するボイスチャンネルID
    userId: string;
    roomName?: string; // 部屋名（roomNameベースのチャットの場合）
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
     * 部屋名とメンバーリストでチャットを作成する
     * roomName: 任意の名前（事前に 'private-' prefix を含む/含まないどちらでもOK）
     * members: ユーザーID の配列（空配列可）
     * categoryName: 作成するカテゴリ名（デフォルトは 'プライベートチャット'）
     */
    static async createChatWithName(
        guild: Guild,
        roomName: string,
        members: string[],
        staffId: string,
        categoryName = 'プライベートチャット'
    ): Promise<PrivateChatInfo> {
        // カテゴリ取得/作成
        let category = guild.channels.cache.find(
            ch => ch.type === ChannelType.GuildCategory && ch.name === categoryName
        ) as CategoryChannel | undefined;

        if (!category) {
            category = await guild.channels.create({
                name: categoryName,
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    }
                ]
            });
        }

        // base name を整形
        let baseName = roomName.toLowerCase();
        if (!baseName.startsWith('private-') && !baseName.startsWith('vc-')) {
            baseName = `private-${baseName}`;
        }
        const channelName = baseName.replace(/[^a-z0-9-_]/g, '-');

        // 権限オーバーライドを作成
        const overwrites: any[] = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }
        ];

        // メンバーに閲覧権限を付与
        for (const memberId of members) {
            overwrites.push({
                id: memberId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.Connect]
            });
        }

        // スタッフ権限
        overwrites.push({
            id: staffId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages]
        });

        // テキストチャンネル作成
        const privateChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: overwrites
        });

        // VC の作成（オプション）
        let vcChannel: any = null;
        try {
            vcChannel = await guild.channels.create({
                name: channelName.replace(/^private-/, 'vc-'),
                type: ChannelType.GuildVoice,
                parent: category.id,
                permissionOverwrites: overwrites
            });
        } catch (err) {
            console.error('Failed to create VC for private chat:', err);
            vcChannel = null;
        }

        const chatInfo: PrivateChatInfo = {
            chatId: privateChannel.id,
            channelId: privateChannel.id,
            vcId: vcChannel ? vcChannel.id : undefined,
            userId: members.length > 0 ? members[0] : '',
            roomName: roomName,
            staffId: staffId,
            guildId: guild.id,
            createdAt: Date.now()
        };

        const chats = await this.getAllChats();
        chats.push(chatInfo);
        await database.set(PRIVATE_CHATS_KEY, chats);

        // ウェルカムメッセージ（メンバーがいる場合はメンション）
        const welcomeEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('💬 プライベートチャットへようこそ')
            .setDescription(
                `${members.length > 0 ? members.map(m => `<@${m}>`).join(' ') + ' ' : ''}` +
                `このチャネルはスタッフ <@${staffId}> によって作成されました。ご利用ください。`
            )
            .setTimestamp();

        await privateChannel.send({ embeds: [welcomeEmbed] });

        return chatInfo;
    }

    /**
     * プライベートチャットを作成（旧 API 互換: userId を与える）
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
        const sanitizedName = `private-${user.user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
        return this.createChatWithName(guild, sanitizedName, [userId], staffId, 'プライベートチャット');
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

        // VC があれば削除
        if (chat.vcId) {
            const vc = guild.channels.cache.get(chat.vcId);
            if (vc) {
                await vc.delete('プライベートチャット終了');
            }
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
