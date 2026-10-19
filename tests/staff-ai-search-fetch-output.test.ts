import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import {
    searchChannelMessagesHandler, fetchDiscordMessageHandler,
} from '../src/commands/staff/subcommands/ai-tools/channelSearch.ts';
import { staffOutputFileHandler, isStaffFileOutputRequest } from '../src/commands/staff/subcommands/ai-tools/fileOutput.ts';
import { fetchPublicUrlHandler } from '../src/commands/staff/subcommands/ai-tools/fetchPublicUrl.ts';
import { selectStaffToolNames } from '../src/commands/staff/subcommands/StaffAIToolRouting.ts';

const guildId = '123456789012345678';
const channelId = '223456789012345678';
const userId = '323456789012345678';
const botId = '423456789012345678';
const older = [
    { id: '523456789012345678', content: '最近の普通の話' },
    { id: '523456789012345677', content: '昔の会話に大事なキーワード' },
    { id: '523456789012345676', content: 'もっと昔のキーワードが出現' },
].map(item => ({
    ...item, createdAt: new Date('2026-09-01T12:00:00Z'),
    author: { id: userId, username: 'test', bot: false },
    attachments: new Collection(), member: null,
}));

function fixture({ allowedUser = true, allowedBot = true, sameGuild = true } = {}) {
    const calls: unknown[] = [];
    const channel = {
        id: channelId, guildId: sameGuild ? guildId : '999999999999999999',
        isTextBased: () => true,
        permissionsFor: (member: { id: string }) => ({
            has: (_: unknown) => member.id === userId ? allowedUser : allowedBot,
        }),
        messages: {
            fetch: async (query: any) => {
                calls.push(query);
                if (typeof query === 'string') return older.find(x => x.id === query) || null;
                if (query.around) return new Collection(older.map(x => [x.id, x]));
                return new Collection(older
                    .filter(x => !query.before || BigInt(x.id) < BigInt(query.before))
                    .slice(0, query.limit).map(x => [x.id, x]));
            },
        },
    };
    const interaction = {
        user: { id: userId }, guildId, channelId, client: { user: { id: botId } },
        guild: {
            channels: { fetch: async (id: string) => id === channelId ? channel : null },
            members: { fetch: async (id: string) => id === userId ? { id: userId } : null },
        },
    };
    return { interaction, calls };
}

test('staff AIは古いチャンネル発言を検索しID・URLから直接fetchできる', async () => {
    const { interaction, calls } = fixture();
    const result = JSON.parse(await searchChannelMessagesHandler({
        query: 'キーワード', scan_limit: 100, limit: 5,
    }, interaction) as string);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].message_id, '523456789012345677');
    assert.equal(result.scanned, 3);
    assert.deepEqual(calls, [
        { limit: 100 },
        { around: older[1].id, limit: 21 },
        { around: older[2].id, limit: 21 },
    ]);
    assert.deepEqual(result.results[0].context.before.map((m: any) => m.message_id), [older[2].id]);
    assert.deepEqual(result.results[0].context.after.map((m: any) => m.message_id), [older[0].id]);
    assert.equal(result.results[0].context.status, 'ok');
    const fetched = JSON.parse(await fetchDiscordMessageHandler({
        message_id: '523456789012345676',
    }, interaction) as string);
    assert.match(fetched.content, /もっと昔のキーワード/);
    assert.equal(fetched.author_id, userId);
    const viaUrl = JSON.parse(await fetchDiscordMessageHandler({
        message_url: 'https://discord.com/channels/' + guildId + '/' + channelId + '/523456789012345677',
    }, interaction) as string);
    assert.equal(viaUrl.message_id, '523456789012345677');
});

test('依頼者・Botの権限不足や別サーバーは検索もfetchも拒否', async () => {
    for (const setting of [{ allowedUser: false }, { allowedBot: false }, { sameGuild: false }]) {
        const { interaction, calls } = fixture(setting);
        assert.match(String(await searchChannelMessagesHandler({ query: 'キーワード' }, interaction)), /DISCORD_(ERROR|DENIED)/);
        assert.match(String(await fetchDiscordMessageHandler({ message_id: older[1].id }, interaction)), /DISCORD_(ERROR|DENIED)/);
        assert.equal(calls.length, 0);
    }
    const { interaction } = fixture();
    assert.match(String(await fetchDiscordMessageHandler({
        message_url: 'https://discord.com/channels/999999999999999999/' + channelId + '/' + older[1].id,
    }, interaction)), /FETCH_DENIED/);
    assert.match(String(await fetchDiscordMessageHandler({
        message_url: 'https://discord.com.evil.example/channels/' + guildId + '/' + channelId + '/' + older[1].id,
    }, interaction)), /FETCH_DENIED/);
});

test('staff AIは検索を100件ずつページングしscan_limitを尊重する', async () => {
    const { interaction } = fixture();
    const pages: any[] = [];
    (interaction.guild.channels.fetch as any) = async () => ({
        id: channelId, guildId,
        isTextBased: () => true, permissionsFor: () => ({ has: () => true }),
        messages: { fetch: async (args: any) => {
            if (args.around) return new Collection([[args.around, { ...older[0], id: args.around }]]);
            pages.push(args);
            const base = 800000000000000000n - BigInt(pages.length * 100);
            return new Collection(Array.from({ length: args.limit }, (_, i) => {
                const mid = String(base - BigInt(i));
                return [mid, { ...older[0], id: mid, content: pages.length === 2 && i === 4 ? 'TARGET' : 'other' }];
            }));
        } },
    });
    const raw = await searchChannelMessagesHandler({ query: 'TARGET', scan_limit: 220, limit: 12 }, interaction) as string;
    const result = JSON.parse(raw);
    assert.equal(result.scanned, 220);
    assert.equal(result.results.length, 1);
    assert.deepEqual(pages.map(p => p.limit), [100, 100, 20]);
    assert.ok(pages[1].before);
});


test('周辺文脈の取得範囲は前後0〜20件で指定可能、オフにもできる', async () => {
    const { interaction, calls } = fixture();
    const limited = JSON.parse(await searchChannelMessagesHandler({
        query: 'キーワード', context_before: 1, context_after: 0, limit: 1,
    }, interaction) as string);
    assert.deepEqual(limited.results[0].context.before.map((x: any) => x.message_id), [older[2].id]);
    assert.deepEqual(limited.results[0].context.after, []);
    assert.equal(limited.results[0].context.requested_before, 1);
    assert.equal(limited.results[0].context.requested_after, 0);
    assert.equal((calls[1] as any).limit, 2);
    const { interaction: other, calls: withoutCalls } = fixture();
    const without = JSON.parse(await searchChannelMessagesHandler({
        query: 'キーワード', include_context: false, limit: 1,
    }, other) as string);
    assert.equal(without.results[0].context, undefined);
    assert.equal(withoutCalls.length, 1);
});

test('周辺取得の障害は検索結果を失わせず、unavailableとして通知する', async () => {
    const { interaction } = fixture();
    const original = interaction.guild.channels.fetch;
    (interaction.guild.channels.fetch as any) = async (id: string) => {
        const channel = await original(id);
        if (!channel) return null;
        const oldFetch = channel.messages.fetch;
        channel.messages.fetch = async (arg: any) => {
            if (arg.around) throw new Error('Discord temporarily unavailable');
            return oldFetch(arg);
        };
        return channel;
    };
    const result = JSON.parse(await searchChannelMessagesHandler({ query: 'キーワード', limit: 1 }, interaction) as string);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].context.status, 'unavailable');
    assert.match(result.results[0].context.error, /失敗/);
});

test('検索がヒット上限でページ途中に止まっても次ページのヒットを飛ばさない', async () => {
    const { interaction } = fixture();
    const first = JSON.parse(await searchChannelMessagesHandler({ query: 'キーワード', limit: 1, include_context: false }, interaction) as string);
    assert.equal(first.scanned, 2);
    assert.equal(first.next_before, older[1].id);
    const second = JSON.parse(await searchChannelMessagesHandler({ query: 'キーワード', limit: 1, before: first.next_before, include_context: false }, interaction) as string);
    assert.equal(second.results[0].message_id, older[2].id);
});

test('最大20件ずつの周辺取得とQwopus用の返却文字数上限を守る', async () => {
    const { interaction } = fixture();
    const center = 823456789012345600n;
    const hits = Array.from({ length: 15 }, (_, n) => ({
        ...older[0], id: String(center - BigInt(n * 100)), content: 'SEARCH ' + '重要な会話'.repeat(170),
    }));
    const aroundQueries: any[] = [];
    (interaction.guild.channels.fetch as any) = async () => ({
        id: channelId, guildId, isTextBased: () => true,
        permissionsFor: () => ({ has: () => true }),
        messages: { fetch: async (args: any) => {
            if (!args.around) return new Collection(hits.map(hit => [hit.id, hit]));
            aroundQueries.push(args);
            const centerId = BigInt(args.around);
            return new Collection(Array.from({ length: 41 }, (_, index) => {
                const msgId = String(centerId + BigInt(index - 20));
                return [msgId, { ...older[0], id: msgId, content: '前後の会話'.repeat(80) }];
            }));
        } },
    });
    const raw = await searchChannelMessagesHandler({
        query: 'SEARCH', limit: 15, context_before: 100, context_after: 100,
    }, interaction) as string;
    const result = JSON.parse(raw);
    assert.equal(result.results.length, 15);
    assert.equal(aroundQueries.length, 15);
    assert.ok(aroundQueries.every(query => query.limit === 41));
    assert.ok(raw.length <= 40_000, 'tool output exceeded budget: ' + raw.length);
    assert.ok(result.results.some((hit: any) => hit.context.truncated_for_budget));
    assert.ok(result.results.every((hit: any) => hit.context.requested_before === 20 && hit.context.requested_after === 20));
});

test('staff AIのoutput_fileは本物のDiscord添付URLを返す', async () => {
    const sends: any[] = [];
    const interaction = {
        guildId, channelId,
        followUp: async (payload: any) => {
            sends.push(payload);
            return { attachments: new Collection([['a', {
                name: 'result.md', url: 'https://cdn.discordapp.com/attachments/result.md',
            }]]) };
        },
    };
    const output = await staffOutputFileHandler({ filename: 'result.md', content: '# 完了' }, interaction) as string;
    assert.match(output, /FILE_UPLOADED/);
    assert.match(output, /cdn.discordapp.com/);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].files[0].name, 'result.md');
    assert.deepEqual(sends[0].allowedMentions.parse, []);
    const bad = await staffOutputFileHandler({ filename: '../private.md', content: 'bad' }, interaction);
    assert.match(String(bad), /FILE_ERROR/);
    assert.equal(sends.length, 1);
});

test('スタッフの検索・URL直接fetch・ファイル生成を意図に沿って選択', () => {
    assert.ok(selectStaffToolNames('去年のチャンネルの会話を検索して').has('search_channel_messages'));
    assert.ok(selectStaffToolNames('このDiscordメッセージリンクを確認').has('fetch_discord_message'));
    assert.ok(selectStaffToolNames('https://example.com/ の内容を直接見て').has('fetch_url'));
    assert.ok(selectStaffToolNames('READMEファイルを作成して').has('output_file'));
    assert.equal(isStaffFileOutputRequest('READMEファイルを作成して'), true);
    assert.equal(isStaffFileOutputRequest('おはよう'), false);
});

test('公開URL取得は実ページを読み、localhostを拒否する', async () => {
    const bad = await fetchPublicUrlHandler({ url: 'http://127.0.0.1:12345/' });
    assert.match(String(bad), /FETCH_BLOCKED/);
});
