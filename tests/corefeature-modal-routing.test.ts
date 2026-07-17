import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModalSubmitInteraction } from 'discord.js';

import { CoreFeatureManager } from '../src/core/corepanel/CoreFeatureManager.ts';

test('registerModalRouteで登録したCorePanelモーダルをonModalSubmitが実行する', async () => {
    const manager = new CoreFeatureManager();
    const customId = 'corefeature:debate:create:combined:ai';
    let receivedCustomId = '';

    manager.registerModalRoute(customId, async (interaction) => {
        receivedCustomId = interaction.customId;
    });

    const handled = await manager.onModalSubmit({ customId } as ModalSubmitInteraction);

    assert.equal(handled, true);
    assert.equal(receivedCustomId, customId);
});

test('未登録でfeatureにも処理されないモーダルはfalseを返す', async () => {
    const manager = new CoreFeatureManager();
    const handled = await manager.onModalSubmit({
        customId: 'corefeature:unknown:modal',
    } as ModalSubmitInteraction);

    assert.equal(handled, false);
});
