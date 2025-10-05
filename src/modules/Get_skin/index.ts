import { EmbedBuilder, Message, TextChannel } from "discord.js";
import { PREFIX, registerCommand } from "../..";
import { Command } from "../../types/command";


const getSkinCommand: Command = {
    name: 'get_skin',
    description: '指定されたMinecraftユーザー名(BE/Geyser)のスキン情報を表示します。',
    admin: false,
    usage: 'get_skin <userName>',
    execute: async (_client, message: Message, args: string[]) => {
        const userName = args[0];

        if (!userName) {
            await message.reply(`❌ スキン情報を取得するユーザー名を指定してください。\n使い方: \`${PREFIX}get_skin <userName>\``);
            return;
        }

        let xuid: string | null = null;
        try {
            const xuidResponse = await fetch(`https://api.geysermc.org/v2/xbox/xuid/${encodeURIComponent(userName)}`);

            if (!xuidResponse.ok) {
                if (xuidResponse.status === 404) {
                    await message.reply(`❌ \`${userName}\` が見つかりませんでした。GeyserMCに接続したことがある有効なXboxゲーマータグを指定してください。`);
                } else {
                    // その他のHTTPエラー
                    await message.reply(`❌ XUIDの取得中にエラーが発生しました (HTTPステータス: ${xuidResponse.status})。`);
                    console.error(`Geyser API (XUID) エラー: ${xuidResponse.status} - ${await xuidResponse.text()}`);
                }
                return;
            }

            const xuidData: { xuid: string } = await xuidResponse.json();
            if (!xuidData || !xuidData.xuid) {
                await message.reply(`❌ APIから有効なXUIDを取得できませんでした。`);
                console.error(`Geyser API (XUID) 無効なレスポンス:`, xuidData);
                return;
            }
            xuid = xuidData.xuid;

        } catch (error: any) {
            console.error(`❌ get_skinコマンド (XUID取得) でエラーが発生 (ユーザー名: ${userName}):`, error);
            await message.reply(`❌ XUIDの取得中にネットワークエラーまたは予期せぬエラーが発生しました。`);
            return;
        }

        if (!xuid) {
            await message.reply(`❌ 不明なエラーによりXUIDを取得できませんでした。`);
            return;
        }


         try {
            const skinResponse = await fetch(`https://api.geysermc.org/v2/skin/${xuid}`);

            if (!skinResponse.ok) {
                // XUIDが見つからない、またはスキン情報がない場合
                await message.reply(`❌ XUID \`${xuid}\` に関連するスキン情報の取得中にエラーが発生しました (HTTPステータス: ${skinResponse.status})。`);
                console.error(`Geyser API (Skin) エラー: ${skinResponse.status} - ${await skinResponse.text()}`);
                return;
            }

            interface SkinData {
                texture_id: string;
                last_update: number;

            }

            const skinData: SkinData = await skinResponse.json();

            if (!skinData || !skinData.texture_id || typeof skinData.last_update !== 'number') {
                await message.reply(`❌ APIから有効なスキン情報を取得できませんでした。`);
                console.error(`Geyser API (Skin) 無効なレスポンス:`, skinData);
                return;
            }

            const textureId = skinData.texture_id;
            const skinImageUrl = `http://textures.minecraft.net/texture/${textureId}`;
            const lastUpdateTimestamp = Math.floor(skinData.last_update / 1000);

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(`👤 ${userName}`)
                .addFields(
                    { name: 'ユーザー名', value: `\`${userName}\``, inline: true },
                    { name: 'XUID', value: `\`${xuid}\``, inline: true },
                    { name: '最終更新日時', value: `<t:${lastUpdateTimestamp}:F> (<t:${lastUpdateTimestamp}:R>)` },
                    { name: 'テクスチャID', value: `\`${textureId}\``}
                )
                .setImage(skinImageUrl)
                .setTimestamp() 
                .setFooter({ text: 'Powered by GeyserMC API & textures.minecraft.net' });


            const channel = message.channel as TextChannel;
            await channel.send({ embeds: [embed] });

        } catch (error: any) {
            console.error(`❌ get_skinコマンド (スキン情報取得) でエラーが発生 (XUID: ${xuid}):`, error);
            await message.reply(`❌ スキン情報の取得中にネットワークエラーまたは予期せぬエラーが発生しました。`);
        }
    }
};

registerCommand(getSkinCommand);
