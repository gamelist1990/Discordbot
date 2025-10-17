import {
    ChatInputCommandInteraction,
    ModalSubmitInteraction,
    MessageFlags,
    EmbedBuilder,
    TextInputStyle
} from 'discord.js';
import { ModalBuilderBase, registerModalHandler } from '../../../utils/Modal.js';
import { Logger } from '../../../utils/Logger.js';

/**
 * /staff info サブコマンド
 * モーダルで Title と Message を入力し、アナウンス風に送信
 */

export const subcommandHandler = {
    name: 'info',
    description: 'アナウンス情報をモーダル経由で送信（Title 有: Embed, 無: テキスト）',
    
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        // Modal Builder を使用してモーダルを作成
        const modal = new StaffInfoModalBuilder().build();

        // モーダルを表示
        await interaction.showModal(modal);
    }
};

/**
 * /staff info モーダル送信ハンドラー
 */
export const handleStaffInfoModal = async (interaction: ModalSubmitInteraction): Promise<void> => {
    try {
        const title = interaction.fields.getTextInputValue('info_title').trim();
        const message = interaction.fields.getTextInputValue('info_message').trim();

        // Message フィールドのバリデーション
        if (!message) {
            await interaction.reply({
                content: '❌ メッセージを入力してください。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // チャンネル取得
        const channel = interaction.channel;
        if (!channel || !('send' in channel)) {
            await interaction.reply({
                content: '❌ テキストチャンネルで実行してください。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Title がある場合は Embed で送信、ない場合はテキストで送信
        if (title) {
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(message)
                .setColor('#5865F2')
                .setTimestamp();

            await (channel as any).send({ embeds: [embed] });
            Logger.info(`✅ スタッフアナウンス送信（Embed）: ${title}`);

            await interaction.reply({
                content: '✅ アナウンスを送信しました（Embed形式）',
                flags: MessageFlags.Ephemeral
            });
        } else {
            await (channel as any).send(message);
            Logger.info(`✅ スタッフアナウンス送信（テキスト）`);

            await interaction.reply({
                content: '✅ アナウンスを送信しました（テキスト形式）',
                flags: MessageFlags.Ephemeral
            });
        }
    } catch (error) {
        Logger.error('❌ /staff info モーダル処理エラー:', error);

        const errorMessage = 'アナウンスの送信に失敗しました。';
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: errorMessage }).catch(() => {});
        } else {
            await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
};


/**
 * /staff info Modal Builder
 * アナウンス送信用の Modal を構築
 */
class StaffInfoModalBuilder extends ModalBuilderBase {
    constructor() {
        super('staff_info_modal', 'アナウンス情報入力');

        // Title フィールド（オプション）
        this.addInput('info_title', 'タイトル（オプション）', TextInputStyle.Short, {
            placeholder: '例: 重要なお知らせ',
            maxLength: 256,
            required: false
        });

        // Message フィールド（必須、Markdown対応）
        this.addInput('info_message', 'メッセージ（Markdown対応）', TextInputStyle.Paragraph, {
            placeholder: '例: **太字**、*斜体*、`コード`、```コードブロック``` などに対応',
            maxLength: 4000,
            required: true
        });
    }
}


// Modal ハンドラーを登録
registerModalHandler('staff_info_modal', handleStaffInfoModal);
