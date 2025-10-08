import { ChatInputCommandInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

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
        } catch (err) {
            console.error('Failed to show modal for /staff issue:', err);
            await interaction.reply({ content: 'モーダルを開けませんでした。Bot にモーダルの使用権限があるか確認してください。', flags: 64 });
        }
    }
};
