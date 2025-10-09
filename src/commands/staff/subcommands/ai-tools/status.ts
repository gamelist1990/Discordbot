// src/commands/staff/subcommands/ai-tools/status.ts
import { OpenAITool, ToolHandler } from '../../../../types/openai';
import { ChatInputCommandInteraction } from 'discord.js';

/**
 * サーバーステータス情報取得ツール
 * サーバーのメンバー数、オンライン数、オフライン数などを取得します
 */
export const statusToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'get_server_status',
        description: 'Discordサーバーの現在のステータス情報（メンバー数、オンライン数、オフライン数など）を取得します。',
        parameters: {
            type: 'object',
            properties: {
                include_bots: {
                    type: 'boolean',
                    description: 'Bot を含めるかどうか。デフォルトは false（含めない）',
                    default: false
                }
            },
            required: []
        }
    }
};

export const statusToolHandler: ToolHandler = async (args: { include_bots?: boolean }, context?: any) => {
    try {
        // context から interaction を取得
        if (!context || !context.guild) {
            return { error: 'このコマンドはサーバー内でのみ使用できます' };
        }

        const interaction = context as ChatInputCommandInteraction;
        const guild = interaction.guild;

        if (!guild) {
            return { error: 'ギルド情報を取得できませんでした' };
        }

        // メンバー情報を取得（キャッシュにない場合はフェッチ）
        await guild.members.fetch();

        const includeBots = args.include_bots ?? false;
        const allMembers = guild.members.cache;

        // Bot を除外するかどうか
        const targetMembers = includeBots 
            ? allMembers 
            : allMembers.filter(member => !member.user.bot);

        // オンライン・オフライン・その他のステータスをカウント
        let onlineCount = 0;
        let offlineCount = 0;
        let idleCount = 0;
        let dndCount = 0;

        // プレゼンス情報が利用可能かチェック
        const presenceAvailable = guild.presences.cache.size > 0;

        targetMembers.forEach(member => {
            // プレゼンス情報を guild.presences から取得
            const presence = guild.presences.cache.get(member.id);
            const status = presence?.status;
            
            if (status === 'online') onlineCount++;
            else if (status === 'idle') idleCount++;
            else if (status === 'dnd') dndCount++;
            else offlineCount++; // status が undefined または 'offline' の場合
        });

        // プレゼンス情報が取得できない場合の警告
        const warning = !presenceAvailable 
            ? '\n\n⚠️ 注意: プレゼンス情報（オンライン状態）が取得できていません。Bot の Intents 設定で `GUILD_PRESENCES` が有効になっているか確認してください。' 
            : '';

        const result = {
            server_name: guild.name,
            total_members: targetMembers.size,
            online: onlineCount,
            offline: offlineCount,
            idle: idleCount,
            dnd: dndCount,
            bots_included: includeBots,
            fetched_at: new Date().toISOString(),
            warning: warning || undefined,
            presence_data_available: presenceAvailable
        };

        return result;

    } catch (error) {
        console.error('Error in statusToolHandler:', error);
        return { 
            error: `ステータス取得中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}` 
        };
    }
};
