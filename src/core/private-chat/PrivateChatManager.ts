import {
    Guild,
    CategoryChannel,
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder
} from 'discord.js';
import { database } from '../persistence/Database.js';
import { emitPrivateChatEvent } from './PrivateChatEvents.js';

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
        const allChats = await database.get<PrivateChatInfo[]>('', PRIVATE_CHATS_KEY, []);
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

        // base name を整形（部屋名をそのまま使用）
        // 日本語などのユニコード文字を残しつつ、空白をハイフンにし、許可されない記号は除去する
        let baseName = roomName.trim().toLowerCase();
        // 空白類をハイフンに置換
        baseName = baseName.replace(/\s+/g, '-');
        // Unicode の文字（letters/numbers）とハイフン/アンダースコアのみ許可。それ以外は削除
        baseName = baseName.replace(/[^^\p{L}\p{N}\-_]/gu, '');
        // もし無効な名前になってしまった場合はフォールバック名を使う
        if (!baseName || baseName.length === 0) {
            baseName = `room-${Date.now().toString(36).slice(-4)}`;
        }
        // より分かりやすい命名にする: サフィックスを "-text" と "-voice" に変更
        const channelName = `${baseName}-text`;
        const vcChannelName = `${baseName}-voice`;

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
                name: vcChannelName,
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
        await database.set('', PRIVATE_CHATS_KEY, chats);

        // emit event
        try {
            emitPrivateChatEvent({ type: 'chatCreated', chatId: chatInfo.chatId, guildId: guild.id, staffId: staffId, roomName: chatInfo.roomName, userId: chatInfo.userId });
        } catch (err) {
            console.error('Failed to emit chatCreated event:', err);
        }

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

        // チャンネルに通知を送り、チャンネルを削除
        const channel = guild.channels.cache.get(chat.channelId);
        if (channel) {
            try {
                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🔒 プライベートチャットを終了しました')
                    .setDescription(`このチャットはスタッフ <@${chat.staffId}> によって終了されました。`)
                    .setTimestamp();

                // 送信を試みる（失敗しても削除は続行）
                if ('send' in channel && typeof (channel as any).send === 'function') {
                    await (channel as any).send({ embeds: [embed] }).catch(() => { });
                }
            } catch (err) {
                console.error('deleteChat: failed to send closing message:', err);
            }

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
        await database.set('', PRIVATE_CHATS_KEY, chats);

        // emit event
        try {
            emitPrivateChatEvent({ type: 'chatDeleted', chatId: chat.chatId, guildId: guild.id });
        } catch (err) {
            console.error('Failed to emit chatDeleted event:', err);
        }

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

    /**
     * チャットにメンバーを追加
     */
    static async addMember(guild: Guild, chatId: string, userId: string): Promise<boolean> {
        if (!userId || userId.trim() === '') {
            throw new Error('ユーザーIDが無効です');
        }

        const chat = await this.getChat(chatId);
        if (!chat) {
            throw new Error('チャットが見つかりません');
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            throw new Error('ユーザーが見つかりません');
        }

        // テキストチャンネルに権限を追加
        const channel = guild.channels.cache.get(chat.channelId);
        if (channel && 'permissionOverwrites' in channel) {
            await channel.permissionOverwrites.create(userId, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });
        }

        // VCチャンネルに権限を追加
        if (chat.vcId) {
            const vcChannel = guild.channels.cache.get(chat.vcId);
            if (vcChannel && 'permissionOverwrites' in vcChannel) {
                await vcChannel.permissionOverwrites.create(userId, {
                    ViewChannel: true,
                    Connect: true,
                    Speak: true
                });
            }
        }

        // チャネル内にメッセージで通知
        try {
            if (channel && 'send' in channel && typeof (channel as any).send === 'function') {
                const member = await guild.members.fetch(userId).catch(() => null);
                const mention = `<@${userId}>`;
                const display = member ? `${member.user.username}` : null;
                const embed = new EmbedBuilder()
                    .setColor('#00aaff')
                    .setTitle('➕ メンバーが追加されました')
                    .setDescription(`${mention}${display ? ` (${display})` : ''} がチャットに追加されました。`)
                    .setTimestamp();

                await (channel as any).send({ embeds: [embed] }).catch(() => { });
            }
        } catch (err) {
            console.error('addMember: failed to send add notification:', err);
        }

        // emit event
        try {
            emitPrivateChatEvent({ type: 'memberAdded', chatId: chat.chatId, guildId: guild.id, userId });
        } catch (err) {
            console.error('Failed to emit memberAdded event:', err);
        }

        return true;
    }

    /**
     * チャットからメンバーを削除
     */
    static async removeMember(guild: Guild, chatId: string, userId: string): Promise<boolean> {
        const chat = await this.getChat(chatId);
        if (!chat) {
            throw new Error('チャットが見つかりません');
        }

        // テキストチャンネルから権限を削除（通知は削除前に送信する）
        const channel = guild.channels.cache.get(chat.channelId);
        if (channel) {
            try {
                // メンバー情報を取得してメッセージ送信
                const member = await guild.members.fetch(userId).catch(() => null);
                const mention = `<@${userId}>`;
                const display = member ? `${member.user.username}` : null;
                const embed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('➖ メンバーが削除されました')
                    .setDescription(`${mention}${display ? ` (${display})` : ''} がチャットから削除されました。`)
                    .setTimestamp();

                if ('send' in channel && typeof (channel as any).send === 'function') {
                    await (channel as any).send({ embeds: [embed] }).catch(() => { });
                }
            } catch (err) {
                console.error('removeMember: failed to send removal notification:', err);
            }

            if ('permissionOverwrites' in channel) {
                await channel.permissionOverwrites.delete(userId).catch(() => { });
            }
        }


        // VCチャンネルから権限を削除
        if (chat.vcId) {
            const vcChannel = guild.channels.cache.get(chat.vcId);
            if (vcChannel && 'permissionOverwrites' in vcChannel) {
                await vcChannel.permissionOverwrites.delete(userId).catch(() => { });
            }
        }

        // emit event
        try {
            emitPrivateChatEvent({ type: 'memberRemoved', chatId: chat.chatId, guildId: guild.id, userId });
        } catch (err) {
            console.error('Failed to emit memberRemoved event:', err);
        }

        return true;
    }

    /**
     * チャットのメンバーリストを取得
     */
    static async getMembers(guild: Guild, chatId: string): Promise<string[]> {
        const chat = await this.getChat(chatId);
        if (!chat) {
            throw new Error('チャットが見つかりません');
        }

        const channel = guild.channels.cache.get(chat.channelId);
        if (!channel || !('permissionOverwrites' in channel)) {
            return [];
        }

        const members: string[] = [];
        channel.permissionOverwrites.cache.forEach((overwrite) => {
            if (overwrite.type === 1 && overwrite.id !== guild.id) { // type 1 = member
                const permissions = overwrite.allow;
                if (permissions.has(PermissionFlagsBits.ViewChannel)) {
                    members.push(overwrite.id);
                }
            }
        });

        return members;
    }
}
