import { GuildMember, EmbedBuilder } from "discord.js";
import { PREFIX, registerCommand } from "../.."; // パスは環境に合わせてください
import { Command } from "../../types/command";


const showCommand: Command = {
    name: 'show',
    description: '指定したユーザーIDのサーバー内情報を表示します。', // 説明を修正
    admin: true,
    usage: 'show <userID>',
    execute: async (_client, message, args) => {
        const targetUserId = args[0];

        if (!targetUserId) {
            await message.reply(`❌ 情報を表示するユーザーのIDを指定してください。\n使い方: \`${PREFIX}show <userID>\``);
            return;
        }

        if (!/^\d+$/.test(targetUserId)) {
            await message.reply(`❌ 無効なユーザーID形式です。数字のみで指定してください。`);
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`👤 ユーザー情報: ${targetUserId}`)
            .setColor(0x0099FF);

        let member: GuildMember | null = null;
        if (message.guild) {
            try {
                member = await message.guild.members.fetch(targetUserId);
            } catch (error: any) {
                if (error.code !== 10007 && error.code !== 10013) { // Unknown Member/User 以外はエラーログ
                    console.error(`❌ showコマンドでメンバー情報取得エラー (ID: ${targetUserId}):`, error);
                }
                //メンバーが見つからなくても処理を続行（Discordユーザー情報を表示するため）
            }
        } else {
            await message.reply('⚠️ このコマンドはサーバー外ではユーザーのDiscord情報のみ表示し、サーバー固有情報は表示できません。');
        }


        if (member) {
            const user = member.user;
            embed.setTitle(`👤 ユーザー情報: ${user.tag}`)
                .setColor(member.displayHexColor === '#000000' ? 0x0099FF : member.displayHexColor)
                .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
                .addFields(
                    { name: 'ID', value: `\`${user.id}\``, inline: true },
                    { name: 'ニックネーム', value: member.nickname || 'なし', inline: true },
                    { name: '現在のステータス', value: member.presence?.status || 'offline', inline: true },
                    { name: 'アカウント作成日時', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)` },
                    { name: 'サーバー参加日時', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)` : '不明' }
                );

            const roles = member.roles.cache
                .filter(role => role.id !== message.guild?.id) // @everyone ロールを除外
                .map(role => `<@&${role.id}>`)
                .join(' ') || 'なし';
            if (roles.length <= 1024) { // Embed field value limit
                embed.addFields({ name: `ロール (${member.roles.cache.size - 1})`, value: roles });
            } else {
                embed.addFields({ name: `ロール (${member.roles.cache.size - 1})`, value: '多数のため表示省略' });
            }

            let voiceStateInfo = 'ボイスチャンネルに参加していません';
            if (member.voice.channel) {
                voiceStateInfo = `チャンネル: <#${member.voice.channel.id}>\n`;
                voiceStateInfo += `ミュート状態: `;
                const muteStates: string[] = [];
                if (member.voice.serverMute) muteStates.push('サーバーM');
                if (member.voice.selfMute) muteStates.push('自身M');
                if (member.voice.serverDeaf) muteStates.push('サーバーS');
                if (member.voice.selfDeaf) muteStates.push('自身S');
                voiceStateInfo += muteStates.length > 0 ? muteStates.join(' / ') : 'なし';
            }
            embed.addFields({ name: 'ボイスステータス', value: voiceStateInfo });

            if (member.communicationDisabledUntilTimestamp) {
                const timeoutEnd = Math.floor(member.communicationDisabledUntilTimestamp / 1000);
                embed.addFields({ name: 'タイムアウト中', value: `終了日時: <t:${timeoutEnd}:F> (<t:${timeoutEnd}:R>)` });
                embed.setColor(0xFFCC00); // タイムアウト中は黄色系に
            }
        } else {
            // サーバーメンバーでない場合、Discordユーザーとしての情報を取得試行
            try {
                const user = await _client.users.fetch(targetUserId);
                embed.setTitle(`👤 Discordユーザー情報: ${user.tag}`)
                    .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
                    .addFields(
                        { name: 'ID', value: `\`${user.id}\``, inline: true },
                        { name: 'アカウント作成日時', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)` }
                    );
                if (message.guild) { // サーバー内で実行されているがメンバーでない場合
                    embed.addFields({ name: 'サーバー情報', value: 'このサーバーのメンバーではありません。' });
                }
            } catch (userFetchError: any) {
                // Unknown User エラーコードは 10013
                if (userFetchError.code !== 10013) {
                    console.error(`showコマンドでDiscordユーザー情報取得エラー (ID: ${targetUserId}):`, userFetchError);
                }
                // メンバーでもなく、Discordユーザーとしても見つからなかった場合
                embed.addFields({ name: 'Discordユーザー情報', value: 'ユーザー情報の取得に失敗しました。IDが間違っているか、ユーザーが存在しない可能性があります。' });
            }
        }

        // BAN情報取得処理は削除

        embed.setTimestamp();

        try {
            await message.reply({ embeds: [embed] });
        } catch (replyError) {
            console.error("❌ showコマンドでの返信エラー:", replyError);
            // メッセージ送信に失敗した場合のフォールバックも検討できる
            // await message.channel.send("ユーザー情報の表示中にエラーが発生しました。").catch(console.error);
        }
    }
};

registerCommand(showCommand);