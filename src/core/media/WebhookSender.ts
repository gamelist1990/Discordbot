import { AttachmentBuilder, NewsChannel, TextChannel, WebhookClient } from 'discord.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Webhook 送信オプション
 */
export interface WebhookSendOptions {
    /** 表示されるユーザー名 (最大 80 文字) */
    username: string;
    /** 表示されるアバター URL */
    avatarUrl?: string;
    /** メッセージ本文 */
    content?: string;
    /** 添付するローカルファイルのパス配列 */
    filePaths?: string[];
}

/**
 * 指定テキストチャンネルに Bot が所有する Webhook を使って、
 * 任意のユーザー名・アイコンでメッセージを送信する汎用 API。
 *
 * チャンネルに Bot の Webhook がなければ自動作成する。
 * MANAGE_WEBHOOKS 権限が必要。
 */
export async function sendViaChannelWebhook(
    channel: TextChannel | NewsChannel,
    options: WebhookSendOptions
): Promise<void> {
    let webhooks;
    try {
        webhooks = await channel.fetchWebhooks();
    } catch {
        throw new Error(
            'Webhook の取得に失敗しました。Bot に MANAGE_WEBHOOKS 権限があるか確認してください。'
        );
    }

    const botId = channel.client.user?.id;
    let webhook = webhooks.find((wh) => wh.owner?.id === botId && wh.token);

    if (!webhook) {
        try {
            webhook = await channel.createWebhook({
                name: 'MediaRelay',
                reason: 'X media relay webhook (auto-created)',
            });
        } catch {
            throw new Error(
                'Webhook の作成に失敗しました。Bot に MANAGE_WEBHOOKS 権限があるか確認してください。'
            );
        }
    }

    if (!webhook.token) {
        throw new Error('Webhook の Token が取得できませんでした。');
    }

    const client = new WebhookClient({ id: webhook.id, token: webhook.token });

    try {
        const files: AttachmentBuilder[] = await Promise.all(
            (options.filePaths ?? []).map(async (filePath) => {
                const buffer = await readFile(filePath);
                return new AttachmentBuilder(buffer, { name: path.basename(filePath) });
            })
        );

        await client.send({
            username: (options.username.slice(0, 80) || 'User'),
            avatarURL: options.avatarUrl,
            content: options.content || undefined,
            files: files.length > 0 ? files : undefined,
            allowedMentions: { parse: [] },
        });
    } finally {
        client.destroy();
    }
}
