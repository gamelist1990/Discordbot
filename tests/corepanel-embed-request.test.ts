import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCorePanelEmbed } from '../src/core/corepanel/panelMessage.ts';

test('combined core panel embed includes request section', () => {
    const embed = buildCorePanelEmbed('combined', null).toJSON();
    assert.ok(embed.description?.includes('**リクエスト**'));
});
