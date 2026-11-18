import type { ChatInputCommandInteraction, GuildMember, Role } from 'discord.js';
import type { OpenAITool, ToolHandler } from '../../../../types/openai.js';

const DISCORD_ID = /^\d{17,20}$/;
const ROLE_MENTION = /^<@&(\d{17,20})>$/;
const MAX_SCAN = 10_000;
const MAX_LIMIT = 80;

export const roleMembersToolDefinition: OpenAITool = {
    type: 'function',
    function: {
        name: 'list_role_members',
        description: 'Discordサーバーのロール名、ロールメンション(<@&ID>)、ロールIDから、そのロールを持つメンバーの名前、ID、表示名、アバターURLを一覧取得。メンションでユーザーIDを指定する必要はない。件数が多いときはnext_afterで続きを取得。プロフィール画像は取得できるが、顔や本人の容姿は断定しない。',
        parameters: {
            type: 'object',
            properties: {
                role: { type: 'string', description: 'ロール名・ロールメンション（<@&ID>）・ロールIDのいずれか' },
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: '1回に表示する上限人数。初期値30、最大80' },
                after: { type: 'string', description: '続きを取得する場合のnext_after。初回は指定不要' },
                include_bots: { type: 'boolean', description: 'Botアカウントも含める。初期値true' },
            },
            required: ['role'],
            additionalProperties: false,
        },
    },
};

export function resolveRole(roles: Role[], input: string): { role?: Role; choices?: string[]; error?: string } {
    const value = input.trim();
    if (!value || value.length > 100) return { error: 'roleには100文字以内のロール名・ID・メンションを指定してください' };
    const roleId = value.match(ROLE_MENTION)?.[1] ?? (DISCORD_ID.test(value) ? value : null);
    if (roleId) {
        const found = roles.find(role => role.id === roleId);
        return found ? { role: found } : { error: '指定されたロールIDが見つかりません' };
    }
    const lower = value.toLocaleLowerCase();
    const exact = roles.filter(role => role.name.toLocaleLowerCase() === lower);
    const found = exact.length ? exact : roles.filter(role => role.name.toLocaleLowerCase().includes(lower));
    if (found.length === 1) return { role: found[0] };
    if (!found.length) return { error: '一致するロールが見つかりません。ロール名を確認してください' };
    return { error: '複数のロールが一致しました。名前かIDで絞り込んでください',
        choices: found.slice(0, 12).map(role => `${role.name} (${role.id})`) };
}

export const roleMembersToolHandler: ToolHandler = async (args: {
    role?: string; limit?: number; after?: string; include_bots?: boolean;
}, context?: unknown) => {
    const interaction = context as ChatInputCommandInteraction | undefined;
    if (!interaction?.guild || !interaction.guildId) {
        return { error: 'このツールはDiscordサーバー内でのみ利用できます' };
    }
    if (typeof args?.role !== 'string') return { error: 'roleを指定してください' };
    const guild = interaction.guild;
    try {
        const fetchedRoles = await guild.roles.fetch();
        const resolved = resolveRole([...fetchedRoles.values()], args.role);
        if (!resolved.role) return { error: resolved.error, ...(resolved.choices ? { choices: resolved.choices } : {}) };
        const role = resolved.role;
        const rawLimit = Number(args.limit);
        const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : 30;
        const after = args.after?.trim() || undefined;
        if (after && !DISCORD_ID.test(after)) return { error: 'afterはDiscordユーザーIDで指定してください' };
        const includeBots = args.include_bots !== false;
        const found: GuildMember[] = [];
        let cursor = after;
        let scanned = 0;
        let exhausted = false;
        // Discord's REST member list is paginated, unlike cache-based role.members.
        // Never claim complete membership based on a partial cache or scan window.
        while (scanned < MAX_SCAN && found.length < limit) {
            const batch = await guild.members.list({ limit: Math.min(1000, MAX_SCAN - scanned),
                ...(cursor ? { after: cursor } : {}) });
            const members = [...batch.values()].sort((a, b) => {
                const ai = BigInt(a.id), bi = BigInt(b.id);
                return ai < bi ? -1 : ai > bi ? 1 : 0;
            });
            if (!members.length) { exhausted = true; break; }
            for (const member of members) {
                cursor = member.id;
                scanned++;
                if (member.roles.cache.has(role.id) && (includeBots || !member.user.bot)) found.push(member);
                if (found.length >= limit || scanned >= MAX_SCAN) break;
            }
            if (members.length < 1000 && found.length < limit) { exhausted = true; break; }
        }
        return {
            server: guild.name,
            role: { id: role.id, name: role.name, member_count: role.members.size || undefined },
            members: found.map(member => ({
                id: member.id,
                username: member.user.username,
                display_name: member.displayName,
                bot: member.user.bot,
                avatar_url: member.displayAvatarURL(),
                joined_at: member.joinedAt?.toISOString() ?? null,
            })),
            returned: found.length,
            scanned,
            complete: exhausted,
            next_after: exhausted ? null : cursor,
            note: exhausted ? '指定した検索範囲をすべて確認しました。' :
                `続きがある可能性があります。next_afterをafterに渡して検索してください（最大走査${MAX_SCAN}件/呼び出し）。`,
        };
    } catch (error) {
        return { error: 'ロール所属メンバーを取得できませんでした。BotのGuildMembers IntentとDiscord APIアクセス権を確認してください。',
            detail: error instanceof Error ? error.message.slice(0, 180) : 'unknown' };
    }
};
