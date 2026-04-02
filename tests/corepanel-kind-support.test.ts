import test from 'node:test';
import assert from 'node:assert/strict';

import { getCorePanelKindLabel } from '../src/core/corepanel/panelMessage.ts';

test('getCorePanelKindLabel supports request panel kind', () => {
    assert.equal(getCorePanelKindLabel('request'), 'リクエスト');
});
