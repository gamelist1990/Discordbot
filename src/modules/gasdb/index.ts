import { EmbedBuilder, Message, GuildTextBasedChannel, AttachmentBuilder } from "discord.js";
import { PREFIX, registerCommand } from "../.."; // パスは環境に合わせてください
import { Command } from "../../types/command";
import { Buffer } from 'buffer';
import { GasDbApiClient } from "../../System/gas/gasDbApiClient";
import { ApiResponse } from "../../System/gas/types";


/**
 * GAS Web App のURL (dbコマンド用)。環境変数から取得するか、直接記述します。
 */
const GAS_API_URL_DB_COMMAND = process.env.GAS_DB_API_URL_GENERAL || "https://script.google.com/macros/s/AKfycbzv_iQWI9VthNqDMJpyXe3JPczX7b2OP2b-pj3z0w54IPUwdgdUS4FOwv8O8lyit7OCOA/exec"; // ★必ず実際のURLに置き換える

/**
 * dbコマンドのデフォルトシート名。ユーザーが --sheet で指定しなかった場合に使われる。
 */
const DEFAULT_SHEET_DB_COMMAND = process.env.GAS_DB_DEFAULT_SHEET_GENERAL || "jsonDB_v4";

/**
 * dbコマンド全体で使う共通の合言葉 (任意)。
 * ユーザーが --auth で指定しなかった場合、かつこの値が設定されていれば使われる。
 */
const COMMON_AUTH_KEY_DB_COMMAND: string | undefined = process.env.GAS_DB_COMMON_AUTH_KEY_GENERAL || undefined;


const dbCommand: Command = {
    name: 'db',
    description: 'JSONデータベースを操作します (GAS API v4仕様)。',
    admin: true, // 汎用DB操作なので管理者に限定することが多い
    usage: `db <add|set id|get <id|all>|delete id|find> [JSON添付 or findの場合JSON文字列]\nオプション: --sheet <シート名> --auth <合言葉>`,
    execute: async (_client, message: Message, args: string[]) => {
        if (!message.guild || !message.channel || !message.channel.isTextBased() || message.channel.isDMBased()) {
            await message.reply('❌ このコマンドはサーバーのテキストチャンネルでのみ使用できます。').catch(console.error);
            return;
        }
        const channel: GuildTextBasedChannel = message.channel;

        let dbClient: GasDbApiClient;
        try {
            // GasDbApiClient を直接インスタンス化
            // URL、デフォルトシート名、このコマンド群で使う共通の合言葉を渡す
            dbClient = new GasDbApiClient(GAS_API_URL_DB_COMMAND, DEFAULT_SHEET_DB_COMMAND, COMMON_AUTH_KEY_DB_COMMAND);
        } catch (error) {
            console.error("❌ GasDbApiClient のインスタンス作成に失敗しました (db command):", error);
            await message.reply(`❌ データベースクライアントの準備に失敗しました。設定 (URL: ${GAS_API_URL_DB_COMMAND.substring(0, 30)}...) を確認してください。`);
            return;
        }

        const originalArgs = [...args];
        const subCommandArg = args.shift()?.toLowerCase();

        let sheetNameFromArg: string | undefined = undefined; // --sheet で指定されたシート名
        let authKeyFromArg: string | undefined = undefined; // --auth で指定された合言葉
        let remainingArgs: string[] = [];

        for (let i = 0; i < args.length; i++) {
            const currentArg = args[i].toLowerCase();
            if (currentArg === '--sheet') {
                if (i + 1 < args.length) {
                    sheetNameFromArg = args[i + 1];
                    i++;
                } else {
                    await channel.send('❌ `--sheet` オプションにはシート名を指定してください。'); return;
                }
            } else if (currentArg === '--auth') {
                if (i + 1 < args.length) {
                    authKeyFromArg = args[i + 1];
                    i++;
                } else {
                    await channel.send('❌ `--auth` オプションには合言葉を指定してください。'); return;
                }
            } else {
                remainingArgs.push(args[i]);
            }
        }

        const idArg = remainingArgs[0];
        const jsonDataStringArg = remainingArgs.slice(1).join(' ');

        let loadingMessage: Message | null = null;

        const handleApiResponse = async (response: ApiResponse<any>, successMessagePrefix: string, itemName?: string) => {
            if (loadingMessage) await loadingMessage.delete().catch(console.warn);
            if (response.success) {
                let displayData = response.data;
                let titleSuffix = itemName ? `: ${itemName}` : '';
                let replyContent = `✅ ${successMessagePrefix}${titleSuffix}`;
                if (response.status) replyContent += ` (Status: ${response.status})`;

                if (displayData && typeof displayData === 'object' && 'message' in displayData && Object.keys(displayData).length === 1) {
                    await message.reply(`${replyContent}: ${displayData.message}`).catch(console.error);
                } else if (displayData !== undefined && displayData !== null) {
                    const dataString = JSON.stringify(displayData, null, 2);
                    if (dataString.length <= 1900) {
                        const embed = new EmbedBuilder().setColor(0x00FF00).setTitle(replyContent).setDescription("```json\n" + dataString + "\n```").setTimestamp();
                        await message.reply({ embeds: [embed] }).catch(console.error);
                    } else {
                        const buffer = Buffer.from(dataString, 'utf-8');
                        const fileName = itemName ? `${itemName.replace(/[^a-z0-9]/gi, '_')}_data.json` : 'response_data.json';
                        const file = new AttachmentBuilder(buffer, { name: fileName });
                        await message.reply({ content: `${replyContent}\nデータをファイルで送信します。`, files: [file] }).catch(console.error);
                    }
                } else {
                    await message.reply(replyContent).catch(console.error);
                }
            } else {
                let errorMessage = `❌ 操作に失敗しました`;
                if (response.status) errorMessage += ` (Status: ${response.status})`;
                errorMessage += `。`;
                if (response.error) errorMessage += `\n理由: ${response.error}`;
                else if (response.originalErrorData && typeof response.originalErrorData === 'object' && 'message' in response.originalErrorData) errorMessage += `\n詳細: ${response.originalErrorData.message}`;
                else if (response.data && typeof response.data === 'object' && 'message' in response.data) errorMessage += `\n詳細: ${response.data.message}`;
                else if (typeof response.data === 'string') errorMessage += `\n詳細: ${response.data}`;
                if (response.originalErrorData?.rawResponse) errorMessage += `\nサーバー応答(一部): ${response.originalErrorData.rawResponse}`;
                console.error(`API Error (Status: ${response.status || 'N/A'}):`, response);
                await message.reply(errorMessage).catch(console.error);
            }
        };

        try {
            let jsonDataFromAttachment: any = null;
            if (['add', 'set'].includes(subCommandArg || '')) {
                if (message.attachments.size === 1) {
                    const attachment = message.attachments.first()!;
                    if (!attachment.name?.toLowerCase().endsWith('.json')) {
                        await channel.send(`❌ 添付ファイルは \`.json\` 形式である必要があります。`); return;
                    }
                    loadingMessage = await channel.send(`⏳ 添付ファイルを処理中...`);
                    const fetchResponse = await fetch(attachment.url);
                    if (!fetchResponse.ok) throw new Error(`添付ファイル (${attachment.name}) のダウンロードに失敗 (${fetchResponse.statusText})。`);
                    const jsonText = await fetchResponse.text();
                    try {
                        jsonDataFromAttachment = JSON.parse(jsonText);
                    } catch (e) {
                        throw new Error(`添付JSONの形式エラー: ${e instanceof Error ? e.message : String(e)}`);
                    }
                    if (loadingMessage) { await loadingMessage.delete().catch(console.warn); loadingMessage = null; }
                } else if (subCommandArg !== 'find') {
                    await channel.send(`❌ \`${subCommandArg}\` コマンドにはJSONファイルを1つ添付してください。`); return;
                }
            }

            /**
             * API呼び出し時に使用するシート名と合言葉を決定。
             * --sheet や --auth オプションで指定されていればそれを使い、
             * なければ GasDbApiClient インスタンスのデフォルト値 (defaultSheetName, instanceAuthKey) が使われる。
             * GasDbApiClient 側で、メソッド引数の sheetName/auth が undefined ならインスタンスのデフォルトを使う想定。
             */
            const finalSheetName = sheetNameFromArg; // undefined なら GasDbApiClient がデフォルトを使用
            const finalAuthKey = authKeyFromArg;     // undefined なら GasDbApiClient がインスタンスの共通合言葉を使用

            switch (subCommandArg) {
                case 'add': {
                    if (!jsonDataFromAttachment) {
                        await channel.send(`❌ \`add\` コマンドにはJSONファイルを添付してください。`); return;
                    }
                    loadingMessage = await channel.send(`⏳ 新規データを追加しています...`);
                    // addItem の第2引数が itemSpecificAuthKey, 第3引数が sheetName
                    const response = await dbClient.addItem(jsonDataFromAttachment, finalAuthKey, finalSheetName);
                    const newItemInfo = (response.success && response.data && typeof response.data === 'object' && 'id' in response.data)
                        ? `(ID: ${response.data.id})`
                        : '';
                    await handleApiResponse(response, `新規データを追加しました ${newItemInfo}`);
                    break;
                }
                case 'set': { // updateItemById
                    const itemId = idArg;
                    if (!itemId) {
                        await channel.send(`❌ 更新するデータのIDを指定してください。\n使い方: \`${PREFIX}db set <id>\` (JSONファイルを添付)`); return;
                    }
                    if (!jsonDataFromAttachment) {
                        await channel.send(`❌ \`set\` コマンドにはJSONファイルを添付してください。`); return;
                    }
                    loadingMessage = await channel.send(`⏳ ID「${itemId}」のデータを更新しています...`);
                    // updateItemById の第3引数が itemSpecificAuthKey, 第4引数が sheetName
                    const response = await dbClient.updateItemById(itemId, jsonDataFromAttachment, finalAuthKey, finalSheetName);
                    await handleApiResponse(response, "データを更新しました", itemId);
                    break;
                }
                case 'get': {
                    if (!idArg) {
                        await channel.send(`❌ 取得するデータのID または \`all\` を指定してください。\n使い方: \`${PREFIX}db get <id|all>\``); return;
                    }
                    if (idArg.toLowerCase() === 'all') {
                        loadingMessage = await channel.send("⏳ 全データを取得しています...");
                        // getAllItems の第1引数が accessAuthKey, 第2引数が sheetName
                        const response = await dbClient.getAllItems(finalAuthKey, finalSheetName);
                        const data = response.data as any[] | Record<string, any> | null | undefined;
                        const itemCount = response.success && data ? (Array.isArray(data) ? data.length : (typeof data === 'object' ? Object.keys(data).length : 0)) : 0;
                        if (response.success && itemCount === 0) {
                            if (loadingMessage) { await loadingMessage.delete().catch(console.warn); }
                            await message.reply("ℹ️ データが見つかりませんでした (0件)。").catch(console.error);
                            return;
                        }
                        await handleApiResponse(response, `全データ (${itemCount}件)`);
                    } else {
                        const getItemId = idArg;
                        loadingMessage = await channel.send(`⏳ ID「${getItemId}」のデータを取得しています...`);
                        // getItemById の第2引数が itemSpecificAuthKey, 第3引数が sheetName
                        const response = await dbClient.getItemById(getItemId, finalAuthKey, finalSheetName);
                        if (response.success && (response.data === null || response.data === undefined)) {
                            if (loadingMessage) { await loadingMessage.delete().catch(console.warn); }
                            await message.reply(`❓ ID「${getItemId}」のデータが見つかりませんでした。`).catch(console.error);
                            return;
                        }
                        await handleApiResponse(response, "データを取得しました", getItemId);
                    }
                    break;
                }
                case 'delete': {
                    const deleteId = idArg;
                    if (!deleteId) {
                        await channel.send(`❌ 削除するデータのIDを指定してください。\n使い方: \`${PREFIX}db delete <id>\``); return;
                    }
                    loadingMessage = await channel.send(`⏳ ID「${deleteId}」のデータを削除しています...`);
                    // deleteItemById の第2引数が itemSpecificAuthKey, 第3引数が sheetName
                    const response = await dbClient.deleteItemById(deleteId, finalAuthKey, finalSheetName);
                    await handleApiResponse(response, "データを削除しました", deleteId);
                    break;
                }
                case 'find': {
                    let query: object;
                    if (jsonDataFromAttachment) {
                        query = jsonDataFromAttachment;
                    } else if (jsonDataStringArg) {
                        try {
                            query = JSON.parse(jsonDataStringArg);
                        } catch (e) {
                            await channel.send(`❌ findクエリのJSON形式が正しくありません: ${e instanceof Error ? e.message : String(e)}\nJSON文字列を直接指定するか、JSONファイルを添付してください。`); return;
                        }
                    } else {
                        await channel.send(`❌ findクエリを指定してください (JSON文字列または添付ファイル)。`); return;
                    }
                    loadingMessage = await channel.send(`⏳ データを検索しています...`);
                    // findItems の第2引数が accessAuthKey, 第3引数が sheetName
                    const response = await dbClient.findItems(query, finalAuthKey, finalSheetName);
                    const data = response.data as any[] | null | undefined;
                    const itemCount = response.success && data ? data.length : 0;
                    await handleApiResponse(response, `検索結果 (${itemCount}件)`);
                    break;
                }
                case 'clearcache': {
                    loadingMessage = await channel.send(`⏳ キャッシュを無効化しています... (シート: ${finalSheetName || 'デフォルト'})`);
                    // invalidateCache の第1引数が sheetName (authは不要と仮定)
                    const response = await dbClient.invalidateCache(finalSheetName);
                    await handleApiResponse(response, `キャッシュを無効化しました`, finalSheetName || dbClient['defaultSheetName']); // dbClient.defaultSheetName を直接参照 (privateなので注意)
                    break;
                }
                case 'clearallcaches': {
                    loadingMessage = await channel.send(`⏳ 全てのキャッシュを無効化しています...`);
                    const response = await dbClient.invalidateAllCaches();
                    await handleApiResponse(response, `全てのキャッシュを無効化しました`);
                    break;
                }
                default:
                    await channel.send(
                        `❌ 不明なサブコマンドです。\n使い方: \`${PREFIX}${dbCommand.usage}\``
                    );
                    break;
            }
        } catch (error: any) {
            if (loadingMessage) {
                await loadingMessage.delete().catch(e => console.warn("Failed to delete loading message on error:", e));
            }
            console.error(`❌ dbコマンドで予期せぬエラー (Sub: ${subCommandArg}, Args: ${originalArgs.join(' ')}):`, error);
            await message.reply(`❌ コマンド処理中に予期せぬエラーが発生しました: ${error.message}`).catch(console.error);
        }
    }
};

registerCommand(dbCommand);