import test from 'node:test';
import assert from 'node:assert/strict';
import { SlashCommandSubcommandBuilder } from 'discord.js';
import timeoutCommand, { parseDurationToMs } from '../src/commands/staff/subcommands/timeout.ts';

function makeInteraction(duration: string, options: { moderatable?: boolean; rolePosition?: number } = {}) {
    const replies: any[] = [];
    const calls: Array<number | null> = [];
    const target = {
        id: 'target',
        manageable: true,
        moderatable: options.moderatable ?? true,
        roles: { highest: { comparePositionTo: () => options.rolePosition ?? -1 } },
        permissions: { has: () => false },
        timeout: async (durationMs: number | null) => { calls.push(durationMs); },
    };
    const actor = { roles: { highest: {} } };
    const interaction = {
        guild: {
            ownerId: 'owner',
            members: {
                me: { permissions: { has: () => true } },
                fetch: async (id: string) => id === 'target' ? target : actor,
            },
        },
        memberPermissions: { has: () => true },
        user: { id: 'actor', tag: 'actor' },
        options: {
            getUser: () => ({ id: 'target', tag: 'target', toString: () => '<@target>' }),
            getString: (name: string) => name === 'duration' ? duration : null,
        },
        deferReply: async () => {},
        editReply: async (payload: any) => { replies.push(payload); },
    };
    return { interaction: interaction as any, replies, calls };
}

test('timeout の duration は必須で、複合時間と上限を処理する', async () => {
    const data = timeoutCommand.builder(new SlashCommandSubcommandBuilder()).toJSON();
    assert.equal(data.options?.find(option => option.name === 'duration')?.required, true);
    assert.equal(parseDurationToMs('1h30m'), 5_400_000);
    assert.equal(parseDurationToMs(' 2d3h4m5s '), 183_845_000);
    for (const invalid of ['0s', '1h30', '1h junk', '1e99d', '999999999999999999d']) {
        assert.equal(parseDurationToMs(invalid), null);
    }

    const set = makeInteraction('1h30m');
    await timeoutCommand.execute(set.interaction);
    assert.deepEqual(set.calls, [5_400_000]);

    const overLimit = makeInteraction('29d');
    await timeoutCommand.execute(overLimit.interaction);
    assert.deepEqual(overLimit.calls, []);
    assert.match(overLimit.replies[0].content, /28 日/);
});

test('clear は moderatable が false の対象も解除できる', async () => {
    const clear = makeInteraction('clear', { moderatable: false });
    await timeoutCommand.execute(clear.interaction);
    assert.deepEqual(clear.calls, [null]);
});

test('実行者と同位以上のロールは操作できない', async () => {
    const blocked = makeInteraction('5m', { rolePosition: 0 });
    await timeoutCommand.execute(blocked.interaction);
    assert.deepEqual(blocked.calls, []);
    assert.match(blocked.replies[0].content, /上位のロール/);
});
