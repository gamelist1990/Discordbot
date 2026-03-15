import fs from 'fs/promises';
import path from 'path';
import { Logger } from '../../utils/Logger.js';
import { STATE_FILE } from './constants.js';
import type { IntegrationState } from './types.js';

const DEFAULT_STATE: IntegrationState = {
    messageId: null,
    lastOnlineAt: null,
};

export async function loadIntegrationState(): Promise<IntegrationState> {
    try {
        const raw = await fs.readFile(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<IntegrationState>;

        return {
            messageId: typeof parsed.messageId === 'string' ? parsed.messageId : null,
            lastOnlineAt: typeof parsed.lastOnlineAt === 'number' ? parsed.lastOnlineAt : null,
        };
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
            Logger.warn('[Guild890315487962095637] Failed to load integration state:', error);
        }

        return { ...DEFAULT_STATE };
    }
}

export async function saveIntegrationState(state: IntegrationState): Promise<void> {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}
