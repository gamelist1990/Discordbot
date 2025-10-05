import { EmbedBuilder } from 'discord.js';
import { PREFIX, registerCommand } from '../..';
import { Command } from '../../types/command';
import fetch from 'node-fetch';

const AVAILABLE_GAMES = [
    'wars', 'dr', 'hide', 'sg', 'murder', 'sky', 'ctf', 'drop', 'ground',
    'build', 'party', 'bridge', 'grav', 'bed','main'
] as const;

type GameId = typeof AVAILABLE_GAMES[number];

const GAME_NAMES: Record<GameId, string> = {
    wars: 'Treasure Wars',
    dr: 'DeathRun',
    hide: 'Hide and Seek',
    sg: 'Survival Games',
    murder: 'Murder Mystery',
    sky: 'SkyWars',
    ctf: 'Capture the Flag',
    drop: 'Block Drop',
    ground: 'Ground Wars',
    build: 'Just Build',
    party: 'Block Party',
    main: 'Overall (Main Games)',
    bridge: 'The Bridge',
    grav: 'Gravity',
    bed: 'BedWars'
};

async function fetchPlayHiveData(endpoint: string): Promise<any> {
    const baseUrl = 'https://api.playhive.com/v0';
    const url = `${baseUrl}${endpoint}`;
    console.log(`Fetching: ${url}`);

    try {
        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('NotFound');
            }
            let errorBody: any = {};
            try {
                errorBody = await response.json();
            } catch (parseError) { }
            console.error(`API Error ${response.status}: ${response.statusText}`, errorBody);
            throw new Error(`APIリクエスト失敗 ステータス: ${response.status}`);
        }

        const text = await response.text();
        if (!text) {
            console.warn(`API returned empty response for ${url}`);
            throw new Error('APIから空のレスポンスが返されました。');
        }
        try {
            return JSON.parse(text);
        } catch (e) {
            console.error(`Failed to parse JSON response from ${url}:`, text);
            throw new Error('APIからのJSONレスポンスの解析に失敗しました。');
        }
    } catch (error: any) {
        if (error.message === 'NotFound') {
            throw error;
        }
        console.error(`Error fetching PlayHive API (${url}):`, error);
        throw new Error(`PlayHive APIへの接続中にエラーが発生しました: ${error.message}`);
    }
}

const hiveCommand: Command = {
    name: 'hive',
    description: 'PlayHiveの指定されたゲームのプレイヤー統計を取得します。',
    admin: false,
    usage: `hive getData <game> <username>\n利用可能なゲーム: ${AVAILABLE_GAMES.join(', ')}`,
    execute: async (_client, message, args) => {
        const action = args[0]?.toLowerCase();
        const gameIdInput = args[1]?.toLowerCase();
        const username = args[2];

        if (action === 'getdata') {
            if (!gameIdInput || !username) {
                await message.reply(`❌ 引数が不足しています。\n**使い方:** \`${PREFIX}hive getData <game> <username>\`\n**利用可能なゲーム:** \`${AVAILABLE_GAMES.join(', ')}\``);
                return;
            }

            if (!(AVAILABLE_GAMES as ReadonlyArray<string>).includes(gameIdInput)) {
                await message.reply(`❌ 無効なゲームIDです: \`${gameIdInput}\`\n**利用可能なゲーム:** \`${AVAILABLE_GAMES.join(', ')}\``);
                return;
            }
            const gameId = gameIdInput as GameId;
            const gameName = GAME_NAMES[gameId] || gameId;

            if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(username)) {
                await message.reply(`⚠️ 指定されたユーザー名 \`${username}\` はPlayHiveの形式と異なる可能性がありますが、続行します。`);
            }

            const processingMessage = await message.reply(`⏳ プレイヤー \`${username}\` の **${gameName}** 統計を取得中...`);

            try {
                const endpoint = `/game/all/${gameId}/${encodeURIComponent(username)}`;
                const stats = await fetchPlayHiveData(endpoint);

                const kills = stats.kills;
                const deaths = stats.deaths;
                const played = stats.played;
                const wins = stats.victories;
                const firstPlayedTimestamp = stats.first_played;
                const usernameCc = stats.username_cc || username;
                const playerUUID = stats.UUID;

                if (played == null || played === 0 || (kills == null && deaths == null && wins == null)) {
                    await processingMessage.edit(`❓ プレイヤー \`${usernameCc}\` は **${gameName}** をプレイしたことがないか、統計情報が見つかりません。`);
                    return;
                }

                let kdRatio: string = 'N/A';
                if (typeof kills === 'number' && typeof deaths === 'number') {
                    if (deaths === 0) {
                        kdRatio = kills > 0 ? `${kills.toLocaleString()} (∞)` : '0.00';
                    } else {
                        kdRatio = (kills / deaths).toFixed(2);
                    }
                } else if (typeof kills === 'number') {
                    kdRatio = `${kills.toLocaleString()} (∞)`;
                }

                let wlRatio: string = 'N/A';
                if (typeof wins === 'number' && typeof played === 'number' && played > 0) {
                    const losses = played - wins;
                    if (losses <= 0) {
                        wlRatio = wins > 0 ? `${wins.toLocaleString()} (∞)` : '0.00';
                    } else {
                        wlRatio = (wins / losses).toFixed(2);
                    }
                }

                const embed = new EmbedBuilder()
                    .setColor(0xFFAA00)
                    .setTitle(`📊 ${usernameCc} の ${gameName} 統計`)
                    .setThumbnail(`https://th.bing.com/th/id/R.c35f87e178e51e3ed966991b02f618ad?rik=DCI%2bgWTD2OzCJA&riu=http%3a%2f%2fpm1.aminoapps.com%2f8685%2fe330d619674ff9286884b09d8e75ca94f607ad27r1-400-400v2_uhq.jpg&ehk=y7%2f%2bDC%2bzqmonyXCrVoWFHVgebbaHdA2NQgcXmgH3VLE%3d&risl=&pid=ImgRaw&r=0`)
                    .addFields(
                        { name: 'Kills', value: typeof kills === 'number' ? kills.toLocaleString() : 'N/A', inline: true },
                        { name: 'Deaths', value: typeof deaths === 'number' ? deaths.toLocaleString() : 'N/A', inline: true },
                        { name: 'K/D Ratio', value: kdRatio, inline: true },
                        { name: 'Wins', value: typeof wins === 'number' ? wins.toLocaleString() : 'N/A', inline: true },
                        { name: 'Played', value: typeof played === 'number' ? played.toLocaleString() : 'N/A', inline: true },
                        { name: 'W/L Ratio', value: wlRatio, inline: true }
                    )
                    .setFooter({ text: 'データ提供: PlayHive API' })
                    .setTimestamp();

                if (typeof firstPlayedTimestamp === 'number') {
                    embed.addFields({ name: 'First Played', value: `<t:${firstPlayedTimestamp}:R>`, inline: true });
                }

                if (playerUUID) {
                    embed.setFooter({ text: `データ提供: PlayHive API | UUID: ${playerUUID}` });
                }

                await processingMessage.edit({ content: null, embeds: [embed] });

            } catch (error: any) {
                if (error.message === 'NotFound') {
                    try {
                        const searchEndpoint = `/player/search/${encodeURIComponent(username)}`;
                        const searchResults = await fetchPlayHiveData(searchEndpoint);

                        if (Array.isArray(searchResults) && searchResults.length > 0) {
                            const suggestions = searchResults
                                .slice(0, 5)
                                .map((p: { username: string }) => `\`${p.username}\``)
                                .join('\n');
                            await processingMessage.edit(`❌ プレイヤー \`${username}\` の **${gameName}** 統計が見つかりませんでした。\nプレイヤー自体は存在します。\n類似のユーザー名:\n${suggestions}`);
                        } else {
                            await processingMessage.edit(`❌ プレイヤー \`${username}\` はPlayHiveに見つかりませんでした。ユーザー名が正しいか確認してください。`);
                        }
                    } catch (searchError: any) {
                        console.error(`Player search fallback error for ${username}:`, searchError);
                        await processingMessage.edit(`❌ プレイヤー \`${username}\` が見つかりませんでした。ユーザー検索にも失敗しました。`);
                    }
                } else {
                    console.error(`Error processing 'hive getData' for ${username} (${gameId}):`, error);
                    await processingMessage.edit(`❌ **${gameName}** 統計情報の取得中にエラーが発生しました。(${error.message})`);
                }
            }

        } else {
            await message.reply(`❓ 不明なコマンド形式、または引数が不足しています。\n**使い方:** \`${PREFIX}hive getData <game> <username>\`\n**利用可能なゲーム:** \`${AVAILABLE_GAMES.join(', ')}\``);
        }
    }
};

registerCommand(hiveCommand);
