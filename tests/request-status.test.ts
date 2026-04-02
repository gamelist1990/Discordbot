import test from 'node:test';
import assert from 'node:assert/strict';

import { getRequestStatusColor, getRequestStatusLabel } from '../src/core/corepanel/request/RequestFeature.ts';

test('request status waiting has label and color', () => {
    assert.equal(getRequestStatusLabel('waiting'), '情報待ち');
    assert.equal(getRequestStatusColor('waiting'), 0xf59e0b);
});
