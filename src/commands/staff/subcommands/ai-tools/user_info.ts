import { OpenAITool, ToolHandler } from '../../../../types/openai';
import { ChatInputCommandInteraction } from 'discord.js';

/**
 * 指定ユーザーの詳細情報を取得するツール
 * args: { user_id?: string }
 * - user_id を省略した場合はコマンド発行者を対象にします
 */
export const userInfoToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'get_user_details',
        description: '指定されたユーザー（ギルド内）の詳細情報を取得します（roles, join date, account creation, permissions 等）。',
        parameters: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '対象ユーザーの Discord ID。省略するとコマンド実行ユーザーを対象にします。' }
            },
            required: []
        }
    }
};

export const userInfoToolHandler: ToolHandler = async (args: { user_id?: string }, context?: any) => {
    try {
        if (!context || !context.guild) {
            return { error: 'このツールはサーバー内でのみ使用できます' };
        }

        const interaction = context as ChatInputCommandInteraction;
        const guild = interaction.guild!;

        const userId = args.user_id || interaction.user.id;

        let member;
        try {
            member = await guild.members.fetch(userId);
        } catch (err) {
            return { error: `ユーザー ${userId} をギルドから取得できませんでした` };
        }

        const user = member.user;

        const roles = Array.from(member.roles.cache.values() as any[])
            .sort((a: any, b: any) => (b.position || 0) - (a.position || 0))
            .map((r: any) => ({ id: r.id, name: r.name, color: r.hexColor || r.color || null, position: r.position }));

        // permissions.toArray() が利用可能なら配列で返す
        let permissions: string[] = [];
        try {
            permissions = (member.permissions as any).toArray ? (member.permissions as any).toArray() : [];
        } catch (e) {
            permissions = [];
        }

        const result = {
            id: user.id,
            username: user.username,
            discriminator: (user as any).discriminator,
            tag: user.tag,
            is_bot: user.bot,
            display_name: (member as any).displayName || undefined,
            joined_at: member.joinedAt ? member.joinedAt.toISOString() : undefined,
            created_at: user.createdAt ? user.createdAt.toISOString() : undefined,
            avatar_url: user.displayAvatarURL ? user.displayAvatarURL() : undefined,
            roles,
            permissions,
        };

        return result;
    } catch (error) {
        console.error('Error in userInfoToolHandler:', error);
        return { error: `ユーザー情報取得中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}` };
    }
};
