import {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ModalSubmitInteraction
} from 'discord.js';
import { Logger } from './Logger.js';

/**
 * Modal ハンドラー型定義
 */
export type ModalHandler = (interaction: ModalSubmitInteraction) => Promise<void>;

/**
 * Modal ハンドラー レジストリ
 */
const modalHandlers = new Map<string, ModalHandler>();

/**
 * Modal ハンドラーを登録
 */
export const registerModalHandler = (customId: string, handler: ModalHandler): void => {
    modalHandlers.set(customId, handler);
    Logger.info(`📋 Modal ハンドラー登録: ${customId}`);
};

/**
 * Modal ハンドラーを取得
 */
export const getModalHandler = (customId: string): ModalHandler | undefined => {
    return modalHandlers.get(customId);
};

/**
 * Modal ハンドラーを実行
 */
export const executeModalHandler = async (interaction: ModalSubmitInteraction): Promise<boolean> => {
    const handler = getModalHandler(interaction.customId);
    if (!handler) {
        Logger.warn(`⚠️ 不明な Modal customId: ${interaction.customId}`);
        return false;
    }

    try {
        await handler(interaction);
        return true;
    } catch (error) {
        Logger.error(`❌ Modal ハンドラー実行エラー [${interaction.customId}]:`, error);

        const { MessageFlags } = await import('discord.js');
        const errorMessage = 'モーダルの処理中にエラーが発生しました。';
        
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: errorMessage }).catch(() => {});
        } else {
            await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return false;
    }
};

/**
 * Modal Builder 基底クラス
 * Builder パターンで Modal を構築
 */
export abstract class ModalBuilderBase {
    protected modal: ModalBuilder;
    protected inputs: TextInputBuilder[] = [];

    constructor(customId: string, title: string) {
        this.modal = new ModalBuilder()
            .setCustomId(customId)
            .setTitle(title);
    }

    /**
     * TextInput を追加
     */
    addInput(
        customId: string,
        label: string,
        style: TextInputStyle = TextInputStyle.Short,
        options: {
            placeholder?: string;
            maxLength?: number;
            required?: boolean;
        } = {}
    ): this {
        const input = new TextInputBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(style);

        if (options.placeholder) input.setPlaceholder(options.placeholder);
        if (options.maxLength !== undefined) input.setMaxLength(options.maxLength);
        if (options.required !== undefined) input.setRequired(options.required);

        this.inputs.push(input);
        return this;
    }

    /**
     * Modal をビルド
     */
    build(): ModalBuilder {
        // Reset components
        this.modal.setComponents([]);

        // Add all inputs as separate rows
        for (const input of this.inputs) {
            const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
            this.modal.addComponents(row);
        }

        return this.modal;
    }
}

