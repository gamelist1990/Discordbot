import type { ChatInputCommandInteraction } from 'discord.js';

type QueueTicket = {
    resolve: (release: (() => void) | null) => void;
    timeout: ReturnType<typeof setTimeout>;
};

const MAX_WAITING_REQUESTS = 20;
const MAX_QUEUE_WAIT_MS = 12 * 60 * 1000;
const waitingRequests: QueueTicket[] = [];
let requestActive = false;

function createRelease(): () => void {
    let released = false;
    return () => {
        if (released) return;
        released = true;

        const next = waitingRequests.shift();
        if (!next) {
            requestActive = false;
            return;
        }

        clearTimeout(next.timeout);
        next.resolve(createRelease());
    };
}

/** Acquire the single foreground /staff ai slot, showing a visible queue state while waiting. */
export async function acquireStaffAIRequest(
    interaction: ChatInputCommandInteraction,
): Promise<(() => void) | null> {
    if (!requestActive) {
        requestActive = true;
        return createRelease();
    }

    if (waitingRequests.length >= MAX_WAITING_REQUESTS) {
        await interaction.editReply({
            content: '⌛ AIへのリクエストが混み合っています。少し待ってからもう一度送ってください。',
            allowedMentions: { parse: [] },
        }).catch(error => console.warn('[StaffAIQueue] Could not report a full queue:', error));
        return null;
    }

    let resolveTicket!: QueueTicket['resolve'];
    const turn = new Promise<(() => void) | null>(resolve => { resolveTicket = resolve; });
    const ticket: QueueTicket = {
        resolve: resolveTicket,
        timeout: setTimeout(() => {
            const index = waitingRequests.indexOf(ticket);
            if (index === -1) return;
            waitingRequests.splice(index, 1);
            ticket.resolve(null);
        }, MAX_QUEUE_WAIT_MS),
    };
    ticket.timeout.unref?.();
    waitingRequests.push(ticket);

    await interaction.editReply({
        content: '⏳ **AI処理待ち**\n先行するリクエストが完了すると、自動で順番に開始します。',
        allowedMentions: { parse: [] },
    }).catch(error => console.warn('[StaffAIQueue] Could not show queue status:', error));

    const release = await turn;
    if (release) return release;

    await interaction.editReply({
        content: '⌛ 待機時間が長くなったため、このリクエストを終了しました。もう一度送信してください。',
        allowedMentions: { parse: [] },
    }).catch(error => console.warn('[StaffAIQueue] Could not report a queue timeout:', error));
    return null;
}
