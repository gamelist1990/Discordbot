import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { SlashCommand } from '../../types/command.js';
import { BotClient } from '../platform/BotClient.js';
import { CommandRegistry } from './CommandRegistry.js';
import { DynamicCommandOptions } from '../../types/enhanced-command.js';
import { Logger } from '../../utils/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * コマンドローダー
 * src/commands/ 配下のコマンドファイルを自動的に読み込む
 * 新旧両方のコマンド形式をサポート
 */
export class CommandLoader {
    private botClient: BotClient;
    private registry: CommandRegistry;
    private commandsDir: string;

    constructor(botClient: BotClient, commandsDir?: string) {
        this.botClient = botClient;
        this.registry = new CommandRegistry(botClient);
        // __dirname は src/core/commands なので、実コマンドがある src/commands まで2階層戻る
        this.commandsDir = commandsDir || path.resolve(__dirname, '../../commands');
    }

    /**
     * すべてのコマンドを読み込む
     */
    async loadAll(): Promise<void> {
        try {
            Logger.info(`📂 コマンドディレクトリ: ${this.commandsDir}`);
            
            const exists = await this.directoryExists(this.commandsDir);
            if (!exists) {
                Logger.warn(`⚠️ コマンドディレクトリが存在しません: ${this.commandsDir}`);
                await fs.mkdir(this.commandsDir, { recursive: true });
                Logger.info('📁 コマンドディレクトリを作成しました');
                return;
            }

            const files = await this.getCommandFiles(this.commandsDir);
            Logger.info(`📦 コマンドファイル数: ${files.length}`);

            for (const file of files) {
                await this.loadCommandFile(file);
            }

            if (this.botClient.commands.size === 0) {
                throw new Error(
                    `コマンドが1件も読み込まれませんでした。探索先を確認してください: ${this.commandsDir}`
                );
            }

            Logger.success(`✅ ${this.botClient.commands.size} 個のコマンドを読み込みました`);
        } catch (error) {
            Logger.error('❌ コマンド読み込みエラー:', error);
            throw error;
        }
    }

    /**
     * コマンドファイルを再帰的に取得
     */
    private async getCommandFiles(dir: string): Promise<string[]> {
        const files: string[] = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                // staff/subcommands ディレクトリは除外（サブコマンドとしてstaffコマンドで管理されるため）
                if (entry.name === 'subcommands' && path.basename(dir) === 'staff') {
                    continue;
                }
                // サブディレクトリを再帰的に探索
                const subFiles = await this.getCommandFiles(fullPath);
                files.push(...subFiles);
            } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
                // .ts または .js ファイルのみ
                files.push(fullPath);
            }
        }

        return files;
    }

    /**
     * コマンドファイルを読み込んで登録
     */
    private async loadCommandFile(filePath: string): Promise<void> {
        try {
            // 空白や # などを含むWindowsパスも安全にimportできるURLへ変換
            const fileUrl = pathToFileURL(filePath).href;
            const module = await import(fileUrl);
            
            const commandExport = module.default || module.command;

            if (!commandExport) {
                Logger.warn(`⚠️ 無効なコマンドファイル: ${filePath}`);
                return;
            }

            // 新形式（DynamicCommandOptions）をチェック
            if (this.isDynamicCommand(commandExport)) {
                this.registry.registerCommand(commandExport);
                return;
            }

            // 旧形式（SlashCommand）をチェック
            if (this.isSlashCommand(commandExport)) {
                // permissionLevelがある場合は新形式として扱うが、元の builder を保持して
                // サブコマンド等が失われないようにする
                if (commandExport.permissionLevel !== undefined) {
                    // SlashCommandBuilder から名前/説明を安全に取得
                    const dataAny: any = commandExport.data;
                    const json = typeof dataAny.toJSON === 'function' ? dataAny.toJSON() : {};
                    const name = dataAny.name ?? json.name;
                    const description = dataAny.description ?? json.description ?? this.getCommandDescription(commandExport.data);

                    const dynamicCommand: DynamicCommandOptions = {
                        name: name,
                        description: description,
                        permissionLevel: commandExport.permissionLevel,
                        cooldown: (commandExport as any).cooldown,
                        guildOnly: (commandExport as any).guildOnly,
                        // 元の builder を返すことでサブコマンド定義を保持
                        builder: (_) => dataAny as any,
                        execute: commandExport.execute,
                    };
                    this.registry.registerCommand(dynamicCommand);
                } else {
                    this.botClient.registerCommand(commandExport);
                }
                return;
            }

            Logger.warn(`⚠️ 認識できないコマンド形式: ${filePath}`);
        } catch (error) {
            Logger.error(`❌ コマンドファイル読み込みエラー [${filePath}]:`, error);
        }
    }

    /**
     * 新形式（DynamicCommandOptions）かチェック
     */
    private isDynamicCommand(obj: any): obj is DynamicCommandOptions {
        return obj.name && obj.description && typeof obj.execute === 'function';
    }

    /**
     * 旧形式（SlashCommand）かチェック
     */
    private isSlashCommand(obj: any): obj is SlashCommand {
        return obj.data && typeof obj.execute === 'function';
    }

    /**
     * SlashCommandBuilder から説明を取得
     */
    private getCommandDescription(builder: any): string {
        return builder.description || 'No description';
    }

    /**
     * ディレクトリが存在するかチェック
     */
    private async directoryExists(dir: string): Promise<boolean> {
        try {
            await fs.access(dir);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * CommandRegistry を取得
     */
    getRegistry(): CommandRegistry {
        return this.registry;
    }
}
