import { Events, Interaction, MessageFlags, StringSelectMenuInteraction, ButtonInteraction } from 'discord.js';
import { BotClient } from './BotClient.js';
import { CommandRegistry } from './CommandRegistry.js';
import { EnhancedSlashCommand } from '../types/enhanced-command.js';
import { cooldownManager } from '../utils/CooldownManager.js';
import { Logger } from '../utils/Logger.js';
import { Event } from '../types/events.js';

/**
 * Discord イベントハンドラー
 */
export class EventHandler {
    private botClient: BotClient;
    private registry: CommandRegistry | null = null;

    constructor(botClient: BotClient) {
        this.botClient = botClient;
    }

    /**
     * CommandRegistry を設定
     */
    setRegistry(registry: CommandRegistry): void {
        this.registry = registry;
    }

    /**
     * すべてのイベントリスナーを登録
     */
    registerAll(): void {
        this.registerReadyEvent();
        this.registerInteractionCreateEvent();
        this.registerGuildEvents();
        this.registerErrorEvents();
    }

    /**
     * Ready イベント(Bot が起動完了したとき)
     */
    private registerReadyEvent(): void {
        this.botClient.client.once(Events.ClientReady, (client) => {
            Logger.success(`🤖 Bot 起動完了: ${client.user.tag}`);
            Logger.info(`📊 サーバー数: ${client.guilds.cache.size}`);
            Logger.info(`👥 ユーザー数: ${client.users.cache.size}`);

            // EventManager経由でカスタムイベントも発火
            this.botClient.eventManager.emit(Event.READY, client);
        });
    }

    /**
     * ギルドイベント（サーバー参加/退出時）
     */
    private registerGuildEvents(): void {
        // サーバー参加時に自動的にコマンドをデプロイ
        this.botClient.client.on(Events.GuildCreate, async (guild) => {
            try {
                Logger.info(`🎉 新しいサーバーに参加: ${guild.name}`);
                Logger.info(`📝 コマンドを自動デプロイしています...`);
                
                const clientId = this.botClient.getClientId();
                const commandData = Array.from(this.botClient.commands.values()).map(cmd => cmd.data.toJSON());
                
                await this.botClient.client.rest.put(
                    `/applications/${clientId}/guilds/${guild.id}/commands`,
                    { body: commandData }
                );
                
                Logger.success(`✅ ${guild.name} にコマンドをデプロイしました`);
            } catch (error) {
                Logger.error(`❌ コマンドデプロイエラー (${guild.name}):`, error);
            }
        });

        // メンバー退出時: 参加していたプライベートチャットから削除し、通知を行う
        this.botClient.client.on(Events.GuildMemberRemove, async (member) => {
            try {
                // 遅延インポートで PrivateChatManager を取得
                const { PrivateChatManager } = await import('./PrivateChatManager.js');

                // そのギルドのすべてのチャットを検索し、該当ユーザーがメンバーであれば削除
                const chats = await PrivateChatManager.getChatsByGuild(member.guild.id);
                for (const chat of chats) {
                    try {
                        const members = await PrivateChatManager.getMembers(member.guild, chat.chatId);
                        if (members.includes(member.id)) {
                            await PrivateChatManager.removeMember(member.guild, chat.chatId, member.id);
                            // removeMember 内で通知を送るように実装済み
                        }
                    } catch (err) {
                        // 個別チャットの削除失敗はログにとどめる
                        Logger.warn(`Failed to remove member ${member.id} from chat ${chat.chatId}: ${String(err)}`);
                    }
                }
            } catch (error) {
                Logger.error('Error handling GuildMemberRemove:', error);
            }
        });
    }

    /**
     * InteractionCreate イベント（スラッシュコマンドが実行されたとき）
     */
    private registerInteractionCreateEvent(): void {
        this.botClient.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
            // Handle SelectMenu and Button interactions (role panel)
            if (interaction.isStringSelectMenu() || interaction.isButton()) {
                await this.handleInteraction(interaction);
                return;
            }

            // ...existing code...
            if (!interaction.isChatInputCommand()) return;

            const command = this.botClient.commands.get(interaction.commandName) as EnhancedSlashCommand;

            if (!command) {
                Logger.warn(`⚠️ 未登録のコマンド: ${interaction.commandName}`);
                return;
            }

            try {
                // ギルド専用チェック
                if (command.guildOnly && !interaction.guild) {
                    await interaction.reply({ 
                        content: '❌ このコマンドはサーバー内でのみ使用できます。', 
                        flags: MessageFlags.Ephemeral 
                    });
                    return;
                }

                // 権限チェック
                if (this.registry && command.permissionLevel) {
                    const hasPermission = await this.registry.checkPermission(
                        interaction, 
                        command.permissionLevel
                    );

                    if (!hasPermission) {
                        // カスタムイベント発火: 権限拒否
                        this.botClient.eventManager.emit(Event.PERMISSION_DENIED, {
                            commandName: interaction.commandName,
                            user: interaction.user,
                            guild: interaction.guild!,
                            requiredPermission: command.permissionLevel.toString(),
                        });

                        await interaction.reply({ 
                            content: `❌ このコマンドを実行する権限がありません。（必要権限: ${command.permissionLevel}）`, 
                            flags: MessageFlags.Ephemeral 
                        });
                        return;
                    }
                }

                // クールダウンチェック
                if (command.cooldown) {
                    const timeLeft = cooldownManager.check(
                        interaction.commandName,
                        interaction.user.id,
                        command.cooldown
                    );

                    if (timeLeft) {
                        // カスタムイベント発火: クールダウン
                        this.botClient.eventManager.emit(Event.COOLDOWN_HIT, {
                            commandName: interaction.commandName,
                            user: interaction.user,
                            remainingTime: timeLeft,
                        });

                        await interaction.reply({
                            content: `⏳ クールダウン中です。${timeLeft.toFixed(1)}秒後に再実行できます。`,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                }

                Logger.command(interaction.commandName, interaction.user.id, interaction.guildId || undefined);
                
                // カスタムイベント発火: コマンド実行
                this.botClient.eventManager.emit(Event.COMMAND_EXECUTE, {
                    commandName: interaction.commandName,
                    user: interaction.user,
                    guild: interaction.guild || undefined,
                    interaction,
                });

                await command.execute(interaction);
            } catch (error) {
                Logger.error(`❌ コマンド実行エラー [/${interaction.commandName}]:`, error);
                
                // カスタムイベント発火: コマンドエラー
                this.botClient.eventManager.emit(Event.COMMAND_ERROR, {
                    commandName: interaction.commandName,
                    error: error as Error,
                    user: interaction.user,
                    guild: interaction.guild || undefined,
                });
                
                const errorMessage = 'コマンドの実行中にエラーが発生しました。';
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
                } else {
                    await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
                }
            }
        });
    }

    /**
     * SelectMenu および Button インタラクションのハンドリング（ロールパネル）
     */
    private async handleInteraction(interaction: Interaction): Promise<void> {
        // ロールパネルのインタラクションのみ処理
        if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;
        if (!interaction.customId.startsWith('rolepanel:')) return;

        // rolepanel.tsのhandleInteraction関数を呼び出し
        const { default: rolePanelCommand } = await import('../commands/staff/subcommands/rolepanel.js');
        await rolePanelCommand.handleInteraction(interaction as StringSelectMenuInteraction | ButtonInteraction);
    }

    /**
     * エラーイベント
     */
    private registerErrorEvents(): void {
        this.botClient.client.on(Events.Error, (error) => {
            Logger.error('❌ Discord クライアントエラー:', error);
        });

        this.botClient.client.on(Events.Warn, (warning) => {
            Logger.warn('⚠️ Discord クライアント警告:', warning);
        });
    }
}
