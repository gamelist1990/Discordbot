import { EmbedBuilder, TextChannel, User, Client } from "discord.js";
import { currentConfig, PREFIX, saveConfig, registerCommand, isAdmin, isGlobalAdmin } from "../..";
import { Command } from "../../types/command";
async function fetchAndFormatUser(client: Client, userId: string): Promise<string> {
  try {
    const user = await client.users.fetch(userId);
    return `• ${user.tag} (\`${user.id}\`)`;
  } catch {
    return `• 不明なユーザー (\`${userId}\`)`;
  }
}
async function createAdminListEmbed(client: Client, title: string, adminIds: string[]): Promise<EmbedBuilder> {
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(title);
  if (!adminIds || adminIds.length === 0) {
    embed.setDescription("現在、管理者は登録されていません。");
  } else {
    const adminListPromises = adminIds.map(id => fetchAndFormatUser(client, id));
    const adminListFormatted = await Promise.all(adminListPromises);
    embed.setDescription(adminListFormatted.join("\n"));
  }
  return embed;
}
const adminCommand: Command = {
  name: "admin",
  description: "管理者設定を管理します (グローバル / ギルド)。",
  admin: true,
  usage: "admin <global|guild> <add|remove|list> [userID]",
  aliases: ['admins'],
  execute: async (client, message, args) => {
    const scope = args[0]?.toLowerCase();
    const action = args[1]?.toLowerCase();
    const targetUserId = args[2];
    if (!scope || (scope !== 'global' && scope !== 'guild')) {
      await message.reply(`❌ スコープが無効です。\`global\` または \`guild\` を指定してください。\n使い方: \`${PREFIX}${adminCommand.usage}\``);
      return;
    }
    if (!action || !['add', 'remove', 'list'].includes(action)) {
      await message.reply(`❌ アクションが無効です。\`add\`, \`remove\`, または \`list\` を指定してください。\n使い方: \`${PREFIX}${adminCommand.usage}\``);
      return;
    }
    if ((action === 'add' || action === 'remove') && !targetUserId) {
      await message.reply(`❌ ${action === 'add' ? '追加' : '削除'}するユーザーのIDを指定してください。\n使い方: \`${PREFIX}admin ${scope} ${action} <userID>\``);
      return;
    }
    if (targetUserId && !/^\d+$/.test(targetUserId)) {
      await message.reply(`❌ 無効なユーザーID形式です。数字のみで指定してください。`);
      return;
    }
    const authorId = message.author.id;
    let guildId: string | undefined;
    let canManage = false;
    if (scope === 'guild') {
      if (!message.guild) {
        await message.reply("❌ ギルド管理者設定はサーバー内でのみ実行できます。");
        return;
      }
      guildId = message.guild.id;
      canManage = isAdmin(authorId, guildId);
      if (!canManage) {
        await message.reply('❌ このギルドの管理者を設定する権限がありません。');
        return;
      }
    } else {
      canManage = isGlobalAdmin(authorId);
      if (!canManage) {
        await message.reply('❌ グローバル管理者を設定する権限がありません。');
        return;
      }
    }
    if (!currentConfig.globalAdmins) currentConfig.globalAdmins = [];
    if (!currentConfig.guildAdmins) currentConfig.guildAdmins = {};
    if (guildId && !currentConfig.guildAdmins[guildId]) {
      currentConfig.guildAdmins[guildId] = [];
    }
    let user: User | null = null;
    if (targetUserId) {
      try {
        user = await client.users.fetch(targetUserId);
      } catch {
        if (action === 'add' || action === 'remove') {
          await message.reply(`❌ 指定されたユーザーID ${targetUserId} のユーザーを見つけられませんでした。IDを確認してください。`);
          return;
        }
      }
    }
    try {
      switch (action) {
        case 'add':
          if (!user || !targetUserId) {
            await message.reply(`❌ 追加するユーザーを特定できませんでした。`);
            return;
          }
          if (scope === 'global') {
            if (currentConfig.globalAdmins!.includes(targetUserId)) {
              await message.reply(`ℹ️ ユーザー ${user.tag} (${targetUserId}) は既にグローバル管理者です。`); return;
            }
            currentConfig.globalAdmins!.push(targetUserId);
            if (await saveConfig(currentConfig)) {
              await message.reply(`✔ ユーザー ${user.tag} (${targetUserId}) をグローバル管理者に追加しました。`);
            } else {
              currentConfig.globalAdmins!.pop();
              await message.reply("❌ 設定の保存中にエラーが発生しました。");
            }
          } else {
            if (!guildId) return;
            if (currentConfig.guildAdmins![guildId]!.includes(targetUserId)) {
              await message.reply(`ℹ️ ユーザー ${user.tag} (${targetUserId}) は既にこのギルドの管理者です。`); return;
            }
            currentConfig.guildAdmins![guildId]!.push(targetUserId);
            if (await saveConfig(currentConfig)) {
              await message.reply(`✔ ユーザー ${user.tag} (${targetUserId}) を ${message.guild?.name} の管理者に追加しました。`);
            } else {
              currentConfig.guildAdmins![guildId]!.pop();
              await message.reply("❌ 設定の保存中にエラーが発生しました。");
            }
          }
          break;
        case 'remove':
          if (!user || !targetUserId) {
            await message.reply(`❌ 削除するユーザーを特定できませんでした。`); return;
          }
          if (scope === 'global' && authorId === targetUserId) {
            await message.reply("❌ 自分自身をグローバル管理者から削除することはできません。"); return;
          }
          let adminList: string[] | undefined;
          let listName: string;
          let successMsg: string;
          if (scope === 'global') {
            adminList = currentConfig.globalAdmins;
            listName = "グローバル管理者";
            successMsg = `✔ ユーザー ${user.tag} (${targetUserId}) をグローバル管理者から削除しました。`;
          } else {
            if (!guildId) return;
            adminList = currentConfig.guildAdmins![guildId];
            listName = `${message.guild?.name} の管理者`;
            successMsg = `✔ ユーザー ${user.tag} (${targetUserId}) を ${message.guild?.name} の管理者から削除しました。`;
          }
          if (!adminList) {
            await message.reply(`❌ ${listName}リストが見つかりません。`); return;
          }
          const indexToRemove = adminList.indexOf(targetUserId);
          if (indexToRemove === -1) {
            await message.reply(`ℹ️ ユーザーID ${targetUserId} は${listName}リストに存在しません。`); return;
          }
          const removedId = adminList.splice(indexToRemove, 1)[0];
          if (await saveConfig(currentConfig)) {
            await message.reply(successMsg);
          } else {
            adminList.splice(indexToRemove, 0, removedId);
            await message.reply("❌ 設定の保存中にエラーが発生しました。");
          }
          break;
        case 'list':
          let listTitle: string;
          let idsToList: string[] | undefined;
          if (scope === 'global') {
            listTitle = "👑 グローバル管理者リスト";
            idsToList = currentConfig.globalAdmins;
          } else {
            if (!guildId) return;
            listTitle = `👑 ${message.guild?.name} の管理者リスト`;
            idsToList = currentConfig.guildAdmins![guildId];
          }
          if (!idsToList) {
            await message.reply(`❌ ${scope === 'global' ? 'グローバル' : 'ギルド'} 管理者リストの取得に失敗しました。`); return;
          }
          const embed = await createAdminListEmbed(client, listTitle, idsToList);
          if (message.channel instanceof TextChannel) {
            await message.channel.send({ embeds: [embed] });
          } else {
            await message.reply({ embeds: [embed] });
          }
          break;
      }
    } catch (error) {
      console.error(`Admin command execution error (Scope: ${scope}, Action: ${action}, User: ${targetUserId}):`, error);
      await message.reply('❌ コマンドの実行中に予期せぬエラーが発生しました。');
    }
  },
};
registerCommand(adminCommand);