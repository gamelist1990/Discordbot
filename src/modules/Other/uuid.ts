import { Message, AttachmentBuilder } from "discord.js";
import { v4 as uuidv4 } from 'uuid';
import { PREFIX, registerCommand } from "../.."; 
import { Command } from "../../types/command"; 

async function generateUuids(message: Message, args: string[]) {
    let count = 1; 
    if (args[0]) {
        const parsedCount = parseInt(args[0], 10);
        if (isNaN(parsedCount)) {
            await message.reply(`❌ 生成数は数字で指定してください。\n使い方: \`${PREFIX}uuid [生成数 (1-5)]\` または \`${PREFIX}uuid\` + manifest.json添付`);
            return;
        }
        if (parsedCount < 1 || parsedCount > 5) {
            await message.reply(`❌ 生成数は1から5の間で指定してください。`);
            return;
        }
        count = parsedCount;
    }
    const uuids: string[] = [];
    for (let i = 0; i < count; i++) {
        uuids.push(uuidv4());
    }

    try {
        await message.reply(`✅ UUID(v4)を${count}個生成しました:\n\`\`\`\n${uuids.join('\n')}\n\`\`\``);
    } catch (error) {
        console.error('UUIDコマンド(通常生成)実行中にエラー:', error);
        await message.reply('❌ UUIDの生成中にエラーが発生しました。');
    }
}

async function processManifestAttachment(message: Message, attachment: any): Promise<void> {
    if (!attachment || !attachment.url) {
        await message.reply('❌ 添付ファイルの取得に失敗しました。');
        return;
    }

    try {
        const response = await fetch(attachment.url);
        if (!response.ok) {
            throw new Error(`ファイルのダウンロードに失敗しました (${response.status}): ${response.statusText}`);
        }
        const manifestContent = await response.text();

        // JSONとしてパース
        let manifestData: any;
        try {
            manifestData = JSON.parse(manifestContent);
        } catch (parseError) {
            console.error('Manifest JSON パースエラー:', parseError);
            await message.reply(`❌ 添付された \`manifest.json\` は有効なJSON形式ではありません。\n\`\`\`${parseError instanceof Error ? parseError.message : String(parseError)}\`\`\``);
            return;
        }
        let uuidUpdated = false;

        if (manifestData.header && typeof manifestData.header === 'object' && 'uuid' in manifestData.header) {
            manifestData.header.uuid = uuidv4();
            uuidUpdated = true;
        } else {
            console.warn('manifest.json の header または header.uuid が見つかりません。');
        }
        if (manifestData.modules && Array.isArray(manifestData.modules)) {
            manifestData.modules.forEach((module: any) => {
                if (module && typeof module === 'object' && 'uuid' in module) {
                    module.uuid = uuidv4();
                    uuidUpdated = true;
                }
            });
        } else {
            console.warn('manifest.json の modules が見つからないか、配列ではありません。');
        }

        if (!uuidUpdated) {
            await message.reply(`❌ 添付された \`manifest.json\` に更新可能なUUIDフィールド (\`header.uuid\` または \`modules[...].uuid\`) が見つかりませんでした。`);
            return;
        }

        const updatedManifestJsonString = JSON.stringify(manifestData, null, 4);
        const updatedAttachment = new AttachmentBuilder(Buffer.from(updatedManifestJsonString, 'utf-8'), { name: 'manifest.json' });

        await message.reply({
            content: `✅ 添付された \`manifest.json\` のUUIDを更新しました。`,
            files: [updatedAttachment] 
        });

    } catch (error: any) {
        console.error('❌ manifest.json 処理中にエラー:', error);
        await message.reply(`❌ 添付ファイルの処理中に予期せぬエラーが発生しました。\n\`\`\`${error.message}\`\`\``);
    }
}


const uuidCommand: Command = {
    name: 'uuid',
    description: 'UUID(v4)を生成、または添付されたmanifest.jsonのUUIDを更新します。',
    admin: false,
    usage: `uuid [生成数(1-5)] | uuid + manifest.json添付ファイル`, 
    execute: async (_client, message: Message, args: string[]) => {
        const manifestAttachment = message.attachments.find(att => att.name?.toLowerCase() === 'manifest.json');

        if (manifestAttachment) {
            await processManifestAttachment(message, manifestAttachment);
        } else {
            await generateUuids(message, args);
        }
    }
};


registerCommand(uuidCommand);