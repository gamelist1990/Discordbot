import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    MessageFlags
} from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { SlashCommand } from '../../types/command.js';
import { PermissionLevel } from '../../web/types/permission.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * サブコマンドハンドラーの型定義
 */
interface SubcommandHandler {
    name: string;
    description: string;
    builder?: (subcommand: any) => any;
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

/**
 * 動的に読み込まれたサブコマンドハンドラー
 */
const subcommandHandlers = new Map<string, SubcommandHandler>();

/**
 * サブコマンドを動的に読み込む
 */
async function loadSubcommands(): Promise<void> {
    const subcommandsDir = path.join(__dirname, 'subcommands');
    
    try {
        // subcommands ディレクトリが存在するか確認
        await fs.access(subcommandsDir);
        
        const files = await fs.readdir(subcommandsDir);
        
        for (const file of files) {
            if (file.endsWith('.ts') || file.endsWith('.js')) {
                const filePath = path.join(subcommandsDir, file);
                const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;
                
                try {
                    const module = await import(fileUrl);
                    const handler = module.default || module.subcommandHandler;
                    
                    if (handler && handler.name && typeof handler.execute === 'function') {
                        subcommandHandlers.set(handler.name, handler);
                        console.log(`✅ Staff subcommand loaded: ${handler.name}`);
                    }
                } catch (error) {
                    console.error(`❌ Failed to load subcommand from ${file}:`, error);
                }
            }
        }
    } catch (error) {
        // subcommands ディレクトリが存在しない場合は警告のみ
        console.warn('⚠️  Staff subcommands directory not found. Using default subcommands only.');
    }
}

/**
 * スタッフコマンドを構築する
 */
async function buildStaffCommand(): Promise<SlashCommand> {
    // サブコマンドを動的に読み込む
    await loadSubcommands();
    
    const builder = new SlashCommandBuilder()
        .setName('staff')
        .setDescription('スタッフ向けの管理機能')
        .setDMPermission(false);
    
    // デフォルトのサブコマンドを追加（後方互換性のため）
    builder.addSubcommand(subcommand =>
        subcommand
            .setName('help')
            .setDescription('スタッフコマンドのヘルプを表示')
            .addIntegerOption(option =>
                option
                    .setName('page')
                    .setDescription('表示するページ番号')
                    .setRequired(false)
                    .setMinValue(1)
            )
    );
    
    builder.addSubcommand(subcommand =>
        subcommand
            .setName('privatechat')
            .setDescription('プライベートチャット管理（Web UIで操作）')
    );
    
    // 動的に読み込まれたサブコマンドを追加
    for (const [name, handler] of subcommandHandlers) {
        if (handler.builder) {
            builder.addSubcommand(handler.builder);
        } else {
            builder.addSubcommand(subcommand =>
                subcommand
                    .setName(name)
                    .setDescription(handler.description)
            );
        }
    }
    
    return {
        data: builder as SlashCommandBuilder,
        permissionLevel: PermissionLevel.STAFF,
        async execute(interaction: ChatInputCommandInteraction): Promise<void> {
            const subcommand = interaction.options.getSubcommand(false);

                try {
                    // サブコマンドが指定されていない場合はヘルプを表示
                    if (!subcommand) {
                        const { handleHelpSubcommand } = await import('./help.js');
                        await handleHelpSubcommand(interaction);
                        return;
                    }

                    // デフォルトのサブコマンド処理
                    if (subcommand === 'help') {
                    const { handleHelpSubcommand } = await import('./help.js');
                    await handleHelpSubcommand(interaction);
                    return;
                }
                
                if (subcommand === 'privatechat') {
                    const { handlePrivateChatSubcommand } = await import('./privatechat.js');
                    await handlePrivateChatSubcommand(interaction);
                    return;
                }
                
                // 動的に読み込まれたサブコマンド処理
                const handler = subcommandHandlers.get(subcommand);
                if (handler) {
                    await handler.execute(interaction);
                    return;
                }
                
                // 不明なサブコマンド
                await interaction.reply({
                    content: `❌ 不明なサブコマンド: ${subcommand}`,
                    flags: MessageFlags.Ephemeral
                });
            } catch (error) {
                console.error(`Staff command error (${subcommand}):`, error);
                
                
                const errorMessage = error instanceof Error ? error.message : '不明なエラー';
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.editReply({
                        content: `❌ コマンドの実行中にエラーが発生しました: ${errorMessage}`
                    });
                } else {
                    await interaction.reply({
                        content: `❌ コマンドの実行中にエラーが発生しました: ${errorMessage}`,
                        flags: MessageFlags.Ephemeral
                    });
                }
            }
        }
    };
}

// コマンドを構築してエクスポート
const staffCommand = await buildStaffCommand();

export default staffCommand;
