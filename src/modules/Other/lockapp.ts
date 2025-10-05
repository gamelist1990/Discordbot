import {
    PermissionsBitField,
    PermissionOverwriteOptions,
    Role,
    ChannelType,
    GuildBasedChannel,
    Collection,
    TextChannel,
    GuildChannel
} from "discord.js";
import { PREFIX, registerCommand } from "../..";
import { Command } from "../../types/command";

const lockAppCommand: Command = {
    name: 'lockapp',
    description: '指定ロールに対し、該当ロールの権限設定があるチャンネル or 全チャンネルで指定権限（アプリ使用/招待作成/全員メンション）を無効化します。',
    admin: true,
    usage: `lockapp <type> [default | @everyone | <roleID>]
    <type>: applock | invitelock | mentionlock`,
    execute: async (_client, message, args) => {
        if (!message.guild) {
            await message.reply('❌ このコマンドはサーバー内でのみ実行できます。');
            return;
        }

        if (!message.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            await message.reply('❌ Botにチャンネル管理権限がありません。権限を確認してください。');
            return;
        }

        if (!message.guild.members.me?.permissions.has(PermissionsBitField.Flags.ViewChannel)) {
            await message.reply('❌ Botにチャンネル表示権限がありません。ロール指定時の権限確認のため必要です。');
            return;
        }

        if (args.length < 1) {
            await message.reply(`❌ 引数が不足しています。\n使い方: \`${PREFIX}${lockAppCommand.usage}\``);
            return;
        }

        const lockType = args[0]?.toLowerCase();
        const roleArg = args[1]?.toLowerCase();

        let permissionToUpdate: PermissionOverwriteOptions = {};
        let permissionName: string = '';
        let auditLogReasonType: string = '';

        switch (lockType) {
            case 'applock':
                permissionToUpdate = { UseExternalApps: false };
                permissionName = '外部アプリの使用';
                auditLogReasonType = 'applock';
                break;
            case 'invitelock':
                permissionToUpdate = { CreateInstantInvite: false };
                permissionName = '招待を作成';
                auditLogReasonType = 'invitelock';
                break;
            case 'mentionlock':
                permissionToUpdate = { MentionEveryone: false };
                permissionName = '@everyone、@here、全てのロールへのメンション';
                auditLogReasonType = 'mentionlock';
                break;
            default:
                await message.reply(`❌ 無効な処理タイプです: \`${lockType}\`\n利用可能なタイプ: \`applock\`, \`invitelock\`, \`mentionlock\`\n使い方: \`${PREFIX}${lockAppCommand.usage}\``);
                return;
        }

        let targetRole: Role | undefined | null = null;
        let isEveryoneRole = false;

        if (!roleArg || roleArg === 'default' || roleArg === '@everyone') {
            targetRole = message.guild.roles.everyone;
            isEveryoneRole = true;
        } else {
            if (!/^\d+$/.test(roleArg)) {
                await message.reply(`❌ 無効なロールID形式です。数字のみで指定するか、'default' または '@everyone' を指定してください。\n使い方: \`${PREFIX}${lockAppCommand.usage}\``);
                return;
            }
            try {
                targetRole = await message.guild.roles.fetch(roleArg);
                if (!targetRole) {
                    await message.reply(`❌ 指定されたロールIDが見つかりません: \`${roleArg}\``);
                    return;
                }
            } catch (error) {
                console.error(`❌ lockappコマンド (${lockType}) でロール取得エラー (ID: ${roleArg}):`, error);
                await message.reply(`❌ 指定されたロールIDが見つかりません: \`${roleArg}\``);
                return;
            }
        }

        if (!targetRole) {

            await message.reply('❌ 対象ロールの特定に失敗しました。');
            return;
        }


        let channelsToProcess: Collection<string, GuildBasedChannel>;
        let targetDescription: string;

        if (isEveryoneRole) {

            channelsToProcess = message.guild.channels.cache.filter(ch => 'permissionOverwrites' in ch);
            targetDescription = `サーバー内の全チャンネル (${channelsToProcess.size} チャンネル)`;
        } else {

            channelsToProcess = message.guild.channels.cache.filter(ch =>
                'permissionOverwrites' in ch &&
                ch.permissionOverwrites.cache.has(targetRole!.id)
            );
            targetDescription = `\`${targetRole.name}\` ロールに権限設定があるチャンネル (${channelsToProcess.size} チャンネル)`;

            if (channelsToProcess.size === 0) {
                await message.reply(`ℹ️ \`${targetRole.name}\` ロールに権限が設定されているチャンネルが見つかりませんでした。処理をスキップします。`);
                return;
            }
        }


        const totalChannelsToProcess = channelsToProcess.size;

        const processingMessage = await message.reply(`⏳ \`${targetRole.name}\` ロールに対し、${targetDescription}で「${permissionName}」権限を無効化しています...`);

        let updatedCount = 0;
        let failedCount = 0;
        let skippedCount = 0;
        const failedChannels: string[] = [];
        const skippedChannelTypes: Set<string> = new Set();

        const auditLogReason = `${auditLogReasonType}コマンド実行 by ${message.author.tag}`;


        for (const channel of channelsToProcess.values()) {

            if ('permissionOverwrites' in channel && typeof (channel as GuildChannel).permissionOverwrites?.edit === 'function') {
                try {
                    await (channel as GuildChannel).permissionOverwrites.edit(targetRole.id, permissionToUpdate, { reason: auditLogReason });
                    updatedCount++;
                } catch (error: any) {
                    failedCount++;
                    failedChannels.push(`${channel.name} (${ChannelType[channel.type]})`);
                    console.error(`❌ チャンネル[${channel.name}] (${channel.id}, Type: ${ChannelType[channel.type]}) の「${permissionName}」権限更新に失敗:`, error.message);
                }
            } else {

                skippedCount++;
                skippedChannelTypes.add(ChannelType[channel.type] || 'UnknownType');
                console.warn(`❓ チャンネル[${channel.name}] (${channel.id}) は permissionOverwrites.edit をサポートしていません。スキップします。 (タイプ: ${ChannelType[channel.type]})`);
            }


        }

        let resultMessage = `✅ 完了 (\`${lockType}\`): \`${targetRole.name}\` ロールの「${permissionName}」権限を更新しました。\n`;
        resultMessage += `📊 対象チャンネル総数: ${totalChannelsToProcess}\n`;
        resultMessage += `👍 成功: ${updatedCount} チャンネル\n`;
        if (failedCount > 0) {
            resultMessage += `👎 失敗: ${failedCount} チャンネル (${failedChannels.slice(0, 3).join(', ')}${failedCount > 3 ? '...' : ''})\n`;
            resultMessage += `ℹ️ 失敗理由の例: Bot権限不足など。詳細はコンソールログを確認してください。\n`;
        }
        if (skippedCount > 0) {

            resultMessage += `⏭️ スキップ: ${skippedCount} チャンネル (タイプ: ${Array.from(skippedChannelTypes).join(', ')})\n`;
            resultMessage += `ℹ️ スキップ理由: 予期せぬチャンネルタイプ、または権限上書き非対応。\n`;
        }
        if (lockType === 'mentionlock' && updatedCount > 0) {
            resultMessage += `⚠️ 注意: \`mentionlock\` は主にテキスト/アナウンスチャンネルで有効です。他のタイプのチャンネルでは権限を設定しても効果がない場合があります。\n`;
        }


        try {
            await processingMessage.edit(resultMessage);
        } catch (editError) {
            console.error(`❌ lockapp (${lockType}) 完了メッセージの編集に失敗:`, editError);

            try {
                const channel = message.channel as TextChannel;
                await channel.send(resultMessage);
            } catch (sendError) {
                console.error(`❌ lockapp (${lockType}) 完了メッセージの送信にも失敗:`, sendError);
            }
        }
    }
};


registerCommand(lockAppCommand);