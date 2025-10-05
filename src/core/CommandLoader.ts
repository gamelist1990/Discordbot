import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { SlashCommand } from '../types/command.js';
import { BotClient } from './BotClient.js';
import { CommandRegistry } from './CommandRegistry.js';
import { DynamicCommandOptions } from '../types/enhanced-command.js';
import { Logger } from '../utils/Logger.js';

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
        this.commandsDir = commandsDir || path.join(path.dirname(__dirname), 'commands');
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
            // Windows パスを URL 形式に変換
            const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;
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
                this.botClient.registerCommand(commandExport);
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
