import { Message, PermissionsBitField, Collection, GuildTextBasedChannel, ChannelType, GuildMember } from "discord.js";
import { PREFIX, registerCommand } from "../.."; // PREFIXとregisterCommandは正しくインポートされていると仮定
import { Command } from "../../types/command";

/**
 * 指定されたチャンネルからメッセージを削除する共通関数
 * @param channel メッセージを削除する対象の GuildTextBasedChannel
 * @param botMember ボットの GuildMember オブジェクト
 * @param numMessages 削除するメッセージの最大数 (1-100)
 * @returns 削除されたメッセージ数とエラー情報を含むオブジェクト
 */
async function deleteMessagesInChannel(
    channel: GuildTextBasedChannel,
    botMember: GuildMember,
    numMessages: number
): Promise<{ deletedCount: number, error?: string }> {
    if (!botMember.permissionsIn(channel.id).has(PermissionsBitField.Flags.ManageMessages)) {
        return { deletedCount: 0, error: `チャンネル "#${channel.name}" でメッセージを管理する権限がありません。` };
    }

    try {
        const fetchedMessages: Collection<string, Message> = await channel.messages.fetch({ limit: numMessages });
        const now = Date.now();
        const fourteenDaysAgo = now - (14 * 24 * 60 * 60 * 1000);
        const messagesToDelete = fetchedMessages.filter(msg => msg.createdTimestamp > fourteenDaysAgo);

        if (messagesToDelete.size === 0) {
            return { deletedCount: 0, error: `チャンネル "#${channel.name}" で削除可能な（14日以内の）メッセージは見つかりませんでした。` };
        }

        const deletedMessages = await channel.bulkDelete(messagesToDelete, true);
        return { deletedCount: deletedMessages.size };
    } catch (error: any) {
        console.error(`❌ チャンネル "#${channel.name}" でのclear処理中にエラー:`, error);
        if (error.code === 50013) { // Missing Permissions
            return { deletedCount: 0, error: `チャンネル "#${channel.name}" でメッセージの削除に必要な権限がありません（APIエラー）。` };
        } else if (error.code === 10008) { // Unknown Message
            return { deletedCount: 0, error: `チャンネル "#${channel.name}" で一部メッセージが見つかりませんでした。` };
        }
        return { deletedCount: 0, error: `チャンネル "#${channel.name}" でメッセージの削除中にエラーが発生しました: ${error.message || String(error)}` };
    }
}

const clearCommand: Command = {
    name: 'clear',
    description: '指定された数のメッセージをチャンネルから削除します。`all` を付けるとサーバー全体が対象になります。管理者のみ実行可能です。',
    admin: true,
    usage: 'clear <数(1-100)> [all]', // usageを更新
    execute: async (_client, message: Message, args: string[]) => {
        if (!message.guild || !message.member) {
            await message.reply('❌ このコマンドはサーバー内でのみ使用できます。');
            return;
        }
        // コマンドが実行されたチャンネルがテキストベースであるか確認 (返信のため)
        if (!message.channel.isTextBased()) {
            return;
        }

        const botMember = message.guild.members.me;
        if (!botMember) {
            await message.reply('❌ ボット自身の情報を取得できませんでした。');
            return;
        }

        const amountString = args[0];
        if (!amountString) {
            await message.reply(`❌ 削除するメッセージ数を指定してください。\n使い方: \`${PREFIX}${clearCommand.usage}\``);
            return;
        }

        const amount = parseInt(amountString, 10);
        if (isNaN(amount) || amount < 1 || amount > 100) {
            await message.reply(`❌ 削除できるメッセージ数は1から100の間で指定してください。\n使い方: \`${PREFIX}${clearCommand.usage}\``);
            return;
        }

        const deleteAllChannels = args[1]?.toLowerCase() === 'all';

        if (deleteAllChannels) {
            // 'all' オプションの処理 (admin: true はコマンドフレームワークでチェックされる前提)
            const initialReply = await message.reply({ content: `⏳ サーバー内の全ての対象テキストチャンネルから最大 ${amount} 件のメッセージ削除を開始します... (14日以内のメッセージのみ)` });

            const channelsToClear: GuildTextBasedChannel[] = [];
            message.guild.channels.cache.forEach(ch => {
                // GuildTextBasedChannel (Text, Announcement, Thread) で、ボットが閲覧・メッセージ管理可能か
                if (
                    ch.isTextBased() &&
                    ch.viewable && // ボットがチャンネルを見れる
                    botMember.permissionsIn(ch.id).has(PermissionsBitField.Flags.ManageMessages)
                ) {
                    channelsToClear.push(ch);
                }
            });

            if (channelsToClear.length === 0) {
                await initialReply.edit('ℹ️ メッセージを削除できる対象チャンネルが見つかりませんでした（権限不足または対象チャンネルなし）。').catch(console.error);
                await message.delete().catch(e => { if (e.code !== 10008) console.error("コマンドメッセージ削除エラー (all, no channels):", e); });
                return;
            }

            let totalDeletedCount = 0;
            let successChannelsCount = 0;
            let errorChannelsCount = 0;
            const errorDetails: string[] = [];

            for (const channel of channelsToClear) {
                const result = await deleteMessagesInChannel(channel, botMember, amount);
                totalDeletedCount += result.deletedCount;
                if (result.error && result.deletedCount === 0) { // エラーがあり、かつ何も削除できなかった場合
                    // 「削除可能なメッセージなし」はエラーとしてカウントしない場合もあるが、ここでは詳細として記録
                    errorChannelsCount++;
                    errorDetails.push(result.error);
                    console.warn(result.error);
                } else if (result.deletedCount > 0) {
                    successChannelsCount++;
                }
                // APIレートリミットを考慮して短い待機を入れることも可能
                // await new Promise(resolve => setTimeout(resolve, 250)); 
            }

            // コマンドメッセージを削除
            message.delete().catch(e => {
                if (e.code !== 10008) console.error("コマンドメッセージ削除エラー (all):", e);
            });

            let summaryMessage = `✅ **サーバー全体メッセージ削除完了**\n`;
            summaryMessage += `処理対象チャンネル数: ${channelsToClear.length}\n`;
            summaryMessage += `メッセージ削除成功チャンネル数: ${successChannelsCount}\n`;
            summaryMessage += `合計削除メッセージ数: ${totalDeletedCount}\n`;
            if (errorChannelsCount > 0 || errorDetails.length > successChannelsCount) { // errorChannelsCountだと「対象なし」も含むので、errorDetailsで判断
                const actualErrors = errorDetails.filter(detail => !detail.includes("見つかりませんでした")); // 「見つかりませんでした」は純粋なエラーではない
                if (actualErrors.length > 0) {
                    summaryMessage += `⚠️ ${actualErrors.length} 個のチャンネルで問題が発生しました。\n`;
                    summaryMessage += `主なエラー (最初の3件):\n- ${actualErrors.slice(0, 3).join('\n- ')}\n`;
                    summaryMessage += `詳細はボットのログを確認してください。`;
                } else if (errorDetails.length > 0 && successChannelsCount < channelsToClear.length) {
                    summaryMessage += `ℹ️ 一部のチャンネルでは削除可能なメッセージがありませんでした。\n`;
                }
            }

            try {
                await initialReply.edit({ content: summaryMessage });
                setTimeout(() => initialReply.delete().catch(console.error), 30000); // 結果表示時間を長めに
            } catch (e: any) {
                console.error("結果メッセージ編集エラー(all):", e);
                if (message.channel.isTextBased() && message.channel.type === ChannelType.GuildText) { // 再度確認
                    const finalReply = await message.channel.send({ content: summaryMessage });
                    setTimeout(() => finalReply.delete().catch(console.error), 30000);
                }
            }

        } else {
            // 単一チャンネルの処理
            if (!message.channel.isTextBased()) {
                await message.reply('❌ このコマンドはサーバーのテキストチャンネル、アナウンスチャンネル、またはスレッドでのみ使用できます。');
                return;
            }
            const targetChannel = message.channel as GuildTextBasedChannel; // ChannelType.GuildText ; // 型は GuildTextBasedChannel

            // ボットの権限チェック (deleteMessagesInChannel内でも行われるが、早期リターン用にここでも)
            if (!botMember.permissionsIn(targetChannel.id).has(PermissionsBitField.Flags.ManageMessages)) {
                await message.reply('❌ 私にはこのチャンネルでメッセージを管理する権限がありません。ロール設定を確認してください。');
                return;
            }

            const result = await deleteMessagesInChannel(targetChannel, botMember, amount);

            // コマンドメッセージ削除
            message.delete().catch(e => {
                if (e.code !== 10008) console.error("コマンドメッセージ削除エラー (single):", e);
            });

            if (result.error && result.deletedCount === 0 && message.channel.type === ChannelType.GuildText) {
                const replyMsg = await message.channel.send(`ℹ️ ${result.error}`); // エラーではなく情報として表示
                setTimeout(() => replyMsg.delete().catch(console.error), 7000);
            } else if (result.error && message.channel.type === ChannelType.GuildText) { // 削除も一部成功したがエラーもある場合など（通常は発生しにくい）
                const replyMsg = await message.channel.send(`⚠️ ${result.deletedCount}件削除しましたが、問題も発生しました: ${result.error}`);
                setTimeout(() => replyMsg.delete().catch(console.error), 7000);
            }
            else {
                if (message.channel.type === ChannelType.GuildText) {
                    const replyMsg = await message.channel.send(`✅ ${result.deletedCount} 件のメッセージを削除しました。(14日以上前のメッセージは対象外)`);
                    setTimeout(() => replyMsg.delete().catch(console.error), 5000);
                }
            }
        }
    }
};

registerCommand(clearCommand);