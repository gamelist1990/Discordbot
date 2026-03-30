import { Events, Interaction, StringSelectMenuInteraction, ButtonInteraction } from 'discord.js';
import { BotClient } from './BotClient.js';
import { CommandRegistry } from './CommandRegistry.js';
import { EnhancedSlashCommand } from '../types/enhanced-command.js';
import { cooldownManager } from '../utils/CooldownManager.js';
import { Logger } from '../utils/Logger.js';
import { Event } from '../types/events.js';
import { executeModalHandler } from '../utils/Modal.js';

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
        this.registerMessageEvents();
        this.registerUserEvents();
        this.registerVoiceEvents();
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

        this.botClient.client.on(Events.GuildMemberAdd, async (member) => {
            try {
                const { antiCheatManager } = await import('./anticheat/AntiCheatManager.js');
                await antiCheatManager.onGuildMemberAdd(member);
            } catch (error) {
                Logger.debug('Failed to handle AntiCheat on guildMemberAdd:', error);
            }
        });

        this.botClient.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
            try {
                if (oldMember.partial || newMember.partial) {
                    return;
                }
                const { antiCheatManager } = await import('./anticheat/AntiCheatManager.js');
                await antiCheatManager.onGuildMemberUpdate(oldMember as any, newMember as any);
            } catch (error) {
                Logger.debug('Failed to handle AntiCheat on guildMemberUpdate:', error);
            }
        });
    }

    /**
     * InteractionCreate イベント（スラッシュコマンドが実行されたとき）
     */
    private registerInteractionCreateEvent(): void {
        this.botClient.client.on(Events.InteractionCreate, async (interaction: Interaction) => {
            // Handle Modal submissions (staff info など)
            if (interaction.isModalSubmit()) {
                await executeModalHandler(interaction);
                return;
            }

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
                        ephemeral: true
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
                            ephemeral: true
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
                            ephemeral: true
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
                    await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => {});
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
                }
            }
        });
    }

    /**
     * SelectMenu および Button インタラクションのハンドリング（ロールパネル）
     */
    private async handleInteraction(interaction: Interaction): Promise<void> {
        if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;
        if (interaction.customId.startsWith('rolepanel:')) {
            const { default: rolePanelCommand } = await import('../commands/staff/subcommands/rolepanel.js');
            await rolePanelCommand.handleInteraction(interaction as StringSelectMenuInteraction | ButtonInteraction);
            return;
        }

        if (interaction.customId.startsWith('corefeature:')) {
            const { default: corePanelCommand } = await import('../commands/staff/subcommands/corepanel.js');
            await corePanelCommand.handleInteraction(interaction as ButtonInteraction);
        }
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

    /**
     * メッセージイベント（XP付与用）
     */
    private registerMessageEvents(): void {
        this.botClient.client.on(Events.MessageCreate, async (message) => {
            // Bot のメッセージは無視
            if (message.author.bot) return;
            
            // ギルド内のみ
            if (!message.guild) return;

            try {
                const { coreFeatureManager } = await import('./corepanel/CoreFeatureManager.js');
                const handled = await coreFeatureManager.onMessage(message);
                if (handled) {
                    return;
                }
            } catch (error) {
                Logger.debug('Failed to handle core feature room on messageCreate:', error);
            }

            try {
                const { interviewRoomManager } = await import('./interview/InterviewRoomManager.js');
                const handled = await interviewRoomManager.onMessage(message);
                if (handled) {
                    return;
                }
            } catch (error) {
                Logger.debug('Failed to handle interview room on messageCreate:', error);
            }

            try {
                // Rank XP 処理
                const { rankManager } = await import('./RankManager.js');
                const member = message.member;
                if (member) {
                    const roleIds = Array.from(member.roles.cache.keys());
                    await rankManager.handleMessageXp(
                        message.guild.id,
                        message.author.id,
                        message.channel.id,
                        roleIds
                    );
                }
            } catch (error) {
                // XP付与エラーは無視（ログに記録のみ）
                Logger.debug('Failed to add message XP:', error);
            }
            // AntiCheat 処理
            try {
                const { antiCheatManager } = await import('./anticheat/AntiCheatManager.js');
                await antiCheatManager.onMessage(message);
            } catch (error) {
                Logger.debug('Failed to handle AntiCheat on messageCreate:', error);
            }
        });
    }

    /**
     * ボイスチャンネルイベント（XP付与用）
     */
    private registerVoiceEvents(): void {
        this.botClient.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
            // Bot は無視
            if (newState.member?.user.bot) return;

            try {
                const { rankManager } = await import('./RankManager.js');

                // VC参加
                if (!oldState.channel && newState.channel) {
                    rankManager.vcJoin(newState.member!.id);
                }

                // VC退出
                if (oldState.channel && !newState.channel) {
                    await rankManager.vcLeave(oldState.guild.id, oldState.member!.id);
                }

                // VC移動（チャンネル変更）
                if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
                    // 退出扱いで計算してから再度参加
                    await rankManager.vcLeave(oldState.guild.id, oldState.member!.id);
                    rankManager.vcJoin(newState.member!.id);
                }
            } catch (error) {
                // XP付与エラーは無視（ログに記録のみ）
                Logger.debug('Failed to handle VC XP:', error);
            }
        });
    }

    private registerUserEvents(): void {
        this.botClient.client.on(Events.UserUpdate, async (oldUser, newUser) => {
            try {
                if (('partial' in oldUser && oldUser.partial) || ('partial' in newUser && newUser.partial)) {
                    return;
                }
                const { antiCheatManager } = await import('./anticheat/AntiCheatManager.js');
                await antiCheatManager.onUserAvatarUpdate(oldUser as any, newUser as any);
            } catch (error) {
                Logger.debug('Failed to handle AntiCheat on userUpdate:', error);
            }
        });
    }
}

