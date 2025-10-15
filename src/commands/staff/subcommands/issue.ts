import { ChatInputCommandInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalSubmitInteraction, Interaction, MessageFlags } from 'discord.js';
import type { ExtendedClient } from '../../../types/discord';
import { Event } from '../../../types/events';

/**
 * /staff issue サブコマンド
 * モーダルを表示してタイトルと説明を入力させ、ユーザに GitHub の prefilled issue URL を提示する。
 */
export default {
    name: 'issue',
    description: '機能要望やバグ報告のための Issue 作成リンクを生成します（モーダルで入力）',

    builder: (subcommand: any) => {
        return subcommand
            .setName('issue')
            .setDescription('Issue 作成用のモーダルを開きます');
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        // モーダルを表示
        const modal = new ModalBuilder()
            .setCustomId('staff_issue_modal')
            .setTitle('Issue を作成（リンクを生成）');

        const titleInput = new TextInputBuilder()
            .setCustomId('issue_title')
            .setLabel('タイトル（必須）')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('例: 機能要望 — サーバーのステータス切替')
            .setRequired(true)
            .setMaxLength(100);

        const bodyInput = new TextInputBuilder()
            .setCustomId('issue_body')
            .setLabel('詳細（任意）')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('再現手順、期待する動作、環境などを記載してください。')
            .setRequired(false)
            .setMaxLength(4000);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(bodyInput)
        );

        try {
            await interaction.showModal(modal);

            // EventManager を使ってモーダル送信を待機（タイムアウト付き）
            const eventManager = (interaction.client as ExtendedClient).eventManager;
            if (!eventManager) throw new Error('EventManager not available on client');

            const submitted = await new Promise<ModalSubmitInteraction>(async (resolve, reject) => {
                const timer = setTimeout(() => {
                    // タイムアウト
                    reject(new Error('TIMEOUT'));
                }, 60_000);

                // 一度だけ受け取る
                const listenerId = eventManager.register(
                    Event.INTERACTION_CREATE,
                    async (payload: Interaction) => {
                        try {
                            if (payload.isModalSubmit?.() && payload.customId === 'staff_issue_modal' && payload.user?.id === interaction.user.id) {
                                clearTimeout(timer);
                                // 登録解除
                                eventManager.unregister(listenerId);
                                resolve(payload as ModalSubmitInteraction);
                            }
                        } catch (e) {
                            // ignore
                        }
                    },
                    { once: true }
                );
            });

            // 送信されたモーダルを処理
            const title = submitted.fields.getTextInputValue('issue_title') || '';
            const body = submitted.fields.getTextInputValue('issue_body') || '';

            const base = 'https://github.com/gamelist1990/Discordbot/issues/new';
            const params = new URLSearchParams();
            if (title) params.set('title', title);
            if (body) params.set('body', body + '\n');
            const url = `${base}?${params.toString()}`;

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setLabel('GitHub で Issue を作成')
                    .setStyle(ButtonStyle.Link)
                    .setURL(url)
            );

            await submitted.reply({ content: '以下のリンクを開き、内容を確認のうえ Issue を作成してください。', components: [row], flags: MessageFlags.Ephemeral });
        } catch (err: any) {
            if (err && err.message === 'TIMEOUT') {
                await interaction.reply({ content: 'モーダル入力がタイムアウトしました。再度 /staff issue を実行してください。', flags: MessageFlags.Ephemeral } as any).catch(() => {});
                return;
            }

            console.error('Failed to show/process modal for /staff issue:', err);
            await interaction.reply({ content: 'モーダルを開けませんでした。Bot にモーダルの使用権限があるか確認してください。', flags: 64 } as any).catch(() => {});
        }
    }
};
