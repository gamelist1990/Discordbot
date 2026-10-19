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
    assert.equal(calls.length, 1);
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
