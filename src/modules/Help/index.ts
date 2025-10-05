import { EmbedBuilder, TextChannel } from 'discord.js';
import { registerCommand, commands, PREFIX, isAdmin } from '../../index';
import { Command } from '../../types/command';
const ITEMS_PER_PAGE = 8;
const helpCommand: Command = {
    name: 'help',
    description: '利用可能なコマンドの一覧や詳細を表示します。',
    aliases: ['h', '?'],
    usage: 'help [コマンド名 | ページ番号]',
    execute: async (_client, message, args) => {
        const authorIsAdmin = isAdmin(message.author.id, message.guild?.id);
        const allCommandObjects = Array.from(commands.values());
        const uniqueCommandObjects = [...new Set(allCommandObjects)];
        const availableCommandsArray = uniqueCommandObjects
            .filter(cmd => !cmd.admin || authorIsAdmin)
            .sort((a, b) => a.name.localeCompare(b.name));
        if (args.length === 0 || /^\d+$/.test(args[0])) {
            let page = 1;
            if (args.length > 0 && /^\d+$/.test(args[0])) {
                page = parseInt(args[0], 10);
            }
            const totalPages = Math.ceil(availableCommandsArray.length / ITEMS_PER_PAGE);
            page = Math.max(1, Math.min(page, totalPages || 1));
            const startIndex = (page - 1) * ITEMS_PER_PAGE;
            const endIndex = startIndex + ITEMS_PER_PAGE;
            const commandsToShow = availableCommandsArray.slice(startIndex, endIndex);
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('🤖 利用可能なコマンド')
                .setDescription(`プレフィックス: \`${PREFIX}\`\n詳細: \`${PREFIX}help [コマンド名]\``);
            if (commandsToShow.length > 0) {
                let commandList = '';
                commandsToShow.forEach(cmd => {
                    const adminMark = cmd.admin ? '👑 ' : '';
                    commandList += `**\`${PREFIX}${cmd.name}\`**: ${adminMark}${cmd.description || '説明なし'}\n`;
                });
                embed.addFields({ name: `コマンドリスト (ページ ${page}/${totalPages})`, value: commandList });
            } else if (page > 1) {
                embed.addFields({ name: 'コマンドリスト', value: `ページ ${page} には表示するコマンドがありません。` });
            } else {
                embed.addFields({ name: 'コマンドリスト', value: '現在利用可能なコマンドはありません。' });
            }
            embed.setFooter({ text: `全${availableCommandsArray.length}コマンド | ${totalPages > 1 ? `他のページを見るには \`${PREFIX}help [ページ番号]\`` : ''}` });
            if (message.channel instanceof TextChannel) {
                await message.channel.send({ embeds: [embed] });
            } else {
                try {
                    await message.author.send({ embeds: [embed] });
                } catch (dmError) {
                    console.warn(`Help command fallback DM failed for ${message.author.tag}:`, dmError);
                }
            }
        } else {
            const commandName = args[0].toLowerCase();
            const command = commands.get(commandName) || Array.from(commands.values()).find(cmd => cmd.aliases?.includes(commandName));
            if (!command) {
                await message.reply(`❓ コマンド \`${commandName}\` は見つかりませんでした。\nコマンド一覧を見るには \`${PREFIX}help\` を実行してください。`);
                return;
            }
            if (command.admin && !authorIsAdmin) {
                console.log(`🚫 権限拒否: ${message.author.tag} が管理者コマンド ${command.name} のヘルプを試行`);
                await message.reply(`❓ コマンド \`${commandName}\` は見つかりませんでした。(または権限がありません)`);
                return;
            }
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`コマンド詳細: \`${PREFIX}${command.name}\``)
                .setDescription(command.description || '説明なし');
            if (command.admin) {
                embed.setTitle(`👑 コマンド詳細: \`${PREFIX}${command.name}\` (管理者専用)`);
            }
            if (command.aliases && command.aliases.length > 0) {
                embed.addFields({ name: 'エイリアス', value: command.aliases.map(a => `\`${PREFIX}${a}\``).join(', ') });
            }
            const usage = command.usage || command.name;
            embed.addFields({ name: '使い方', value: `\`${PREFIX}${usage}\`` });
            if (message.channel instanceof TextChannel) {
                await message.channel.send({ embeds: [embed] });
            } else {
                try {
                    await message.author.send({ embeds: [embed] });
                } catch (dmError) {
                    console.warn(`Help command detail fallback DM failed for ${message.author.tag}:`, dmError);
                }
            }
        }
    }
};
const aboutCommand: Command = {
    name: 'about',
    description: 'このツールについて表示します。',
    execute: async (_client, message, _args) => {
        if (message) {
            const mes = `**Discord 管理ツール (TypeScript版)**
- 現在色々機能を追加中
- 開発運営元: こう君`;
            await message.reply(mes);
        }
    }
};
registerCommand(helpCommand, 'static(help)');
registerCommand(aboutCommand, 'static(about)');