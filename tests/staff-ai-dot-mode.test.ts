import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStaffAISettings } from '../src/commands/staff/subcommands/StaffAIDotMode.ts';

test('dot mode settings parser accepts set and status forms', () => {
    assert.deepEqual(parseStaffAISettings('mode dot true'), { kind: 'set', value: true });
    assert.deepEqual(parseStaffAISettings('mode dot false'), { kind: 'set', value: false });
    assert.deepEqual(parseStaffAISettings('mode dot'), { kind: 'status' });
});

test('dot mode settings parser normalizes case and spacing', () => {
    assert.deepEqual(parseStaffAISettings('  MODE   DOT   True '), { kind: 'set', value: true });
    assert.deepEqual(parseStaffAISettings('Mode Dot FALSE'), { kind: 'set', value: false });
});

test('dot mode settings parser rejects unknown input', () => {
    assert.deepEqual(parseStaffAISettings('mode dot yes'), { kind: 'invalid' });
    assert.deepEqual(parseStaffAISettings('dot true'), { kind: 'invalid' });
    assert.deepEqual(parseStaffAISettings('mode'), { kind: 'invalid' });
    assert.deepEqual(parseStaffAISettings(''), { kind: 'invalid' });
});
