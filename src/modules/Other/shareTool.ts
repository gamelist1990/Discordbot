import { EmbedBuilder } from 'discord.js';
import { PREFIX, registerCommand } from '../..';
import { Command } from '../../types/command';
import fetch from 'node-fetch';
import vm from 'vm';

const TOOLS_DATA_URL = 'https://pexserver.github.io/tool/module/tool-details.js';
const TOOLS_SOURCE_URL = 'https://pexserver.github.io/tool/';
const ITEMS_PER_PAGE = 3;

interface ToolData {
    title: string;
    image?: string;
    imageLarge?: string;
    category: string;
    version: string;
    updated: string;
    description: string;
    detailedDescription?: string;
    downloadUrl?: string;
    docsUrl?: string;
    platform?: string;
    categoryType?: string;
    [key: `downloadUrl_${string}`]: string | undefined;
}

async function fetchAndParseToolsData(): Promise<Record<string, ToolData> | null> {
    try {
        const response = await fetch(TOOLS_DATA_URL);
        if (!response.ok) {
            console.error(`Failed to fetch tool data: ${response.status} ${response.statusText}`);
            throw new Error(`Failed to fetch tool data (Status: ${response.status})`);
        }
        const scriptContent = await response.text();
        const dataRegex = /const\s+toolsData\s*=\s*(\{[\s\S]*?\});/;
        const match = scriptContent.match(dataRegex);

        if (match && match[1]) {
            const toolsDataObjectString = match[1];
            const sandbox = {};
            const context = vm.createContext(sandbox);
            try {
                vm.runInContext(`result = ${toolsDataObjectString}`, context, { timeout: 1000 });
                const parsedData = context.result as Record<string, ToolData>;
                const firstKey = Object.keys(parsedData)[0];
                if (!firstKey || typeof parsedData[firstKey].title !== 'string') {
                    throw new Error('Parsed data does not look like valid toolsData.');
                }
                return parsedData;
            } catch (e: any) {
                console.error('Failed to evaluate toolsData object:', e);
                throw new Error(`Failed to parse tool data from script: ${e.message}`);
            }
        } else {
            console.error('Could not find toolsData definition in the fetched script.');
            throw new Error('Could not find toolsData in the script.');
        }
    } catch (error: any) {
        console.error('Error fetching or parsing tool data:', error);
        throw new Error(`Error fetching/parsing tool data: ${error.message}`);
    }
}

const shareToolCommand: Command = {
    name: 'sharetool',
    description: 'PEX Coder\'s Labで共有されているツールリストを表示します。',
    admin: false,
    usage: `sharetool list [page]`,
    execute: async (_client, message, args) => {
        const action = args[0]?.toLowerCase();

        if (action === 'list') {
            let page = 1;
            if (args[1]) {
                const pageArg = parseInt(args[1], 10);
                if (!isNaN(pageArg) && pageArg > 0) {
                    page = pageArg;
                } else {
                    await message.reply(`❌ 無効なページ番号です。正の整数を入力してください。`);
                    return;
                }
            }

            const processingMessage = await message.reply(`⏳ ツールリストを取得中... (ページ ${page})`);

            try {
                const toolsData = await fetchAndParseToolsData();
                if (!toolsData) {
                    await processingMessage.edit('❌ ツールデータの取得または解析に失敗しました。');
                    return;
                }

                const toolsArray = Object.entries(toolsData);
                const totalItems = toolsArray.length;

                if (totalItems === 0) {
                    await processingMessage.edit('ℹ️ 利用可能なツールが見つかりませんでした。');
                    return;
                }

                const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

                if (page > totalPages) {
                    await processingMessage.edit(`❌ ページ番号が範囲外です。総ページ数: ${totalPages}`);
                    return;
                }

                const startIndex = (page - 1) * ITEMS_PER_PAGE;
                const endIndex = startIndex + ITEMS_PER_PAGE;
                const itemsToShow = toolsArray.slice(startIndex, endIndex);

                const embed = new EmbedBuilder()
                    .setColor(0x00AAFF)
                    .setTitle(`🔧 PEX Coder's Lab ツールリスト (ページ ${page}/${totalPages})`)
                    .setDescription(`利用可能なツール (${startIndex + 1} - ${Math.min(endIndex, totalItems)} / ${totalItems}件)`)
                    .setFooter({ text: `データソース: ${TOOLS_SOURCE_URL}` })
                    .setTimestamp();

                itemsToShow.forEach(([toolId, tool]) => {
                    let value = `*${tool.description || '説明なし'}*\n`;
                    value += `**Version:** ${tool.version || 'N/A'} | **Updated:** ${tool.updated || 'N/A'}\n`;
                    value += `**[ダウンロード](${TOOLS_SOURCE_URL})**`;

                    embed.addFields({
                        name: `${tool.title || '無題のツール'} (\`${toolId}\`)`,
                        value: value,
                        inline: false
                    });
                });

                await processingMessage.edit({ content: null, embeds: [embed] });

            } catch (error: any) {
                console.error(`Error processing 'sharetool list':`, error);
                await processingMessage.edit(`❌ ツールリストの取得中にエラーが発生しました: ${error.message}`);
            }

        } else {
            await message.reply(`❓ 不明なコマンド形式、または引数が不足しています。\n**使い方:** \`${PREFIX}sharetool list [page]\``);
        }
    }
};

registerCommand(shareToolCommand);
