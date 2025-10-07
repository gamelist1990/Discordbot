import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';

/**
 * Jam サブコマンドハンドラー
 */
export const subcommandHandler = {
    name: 'jam',
    description: 'Jamboard（ホワイトボード・Todoツール）を開く',
    
    builder: (subcommand: any) => {
        return subcommand
            .setName('jam')
            .setDescription('Jamboard（ホワイトボード・Todoツール）を開く');
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ このコマンドはサーバー内でのみ使用できます。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        try {
            // JamboardのURLを生成（常に /jamboard）
            const baseUrl = process.env.WEB_BASE_URL || 'http://localhost:3000';
            const jamboardUrl = `${baseUrl}/jamboard`;

            // 埋め込みメッセージを作成
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎨 Jamboard へのアクセス')
                .setDescription(
                    'スタッフ向けコラボレーションツールです。\nホワイトボードでアイデアを共有したり、Todoを管理できます。'
                )
                .addFields(
                    {
                        name: '📋 利用可能な機能',
                        value: '• ホワイトボード（自由に描画）\n• Todoリスト\n• リアルタイム同期',
                        inline: false
                    },
                    {
                        name: '🔐 アクセス方法',
                        value: '下のボタンをクリックしてJamboardを開いてください。\nDiscordアカウントでログインが必要です。',
                        inline: false
                    }
                )
                .setTimestamp();

            await interaction.reply({
                embeds: [embed],
                components: [
                    {
                        type: 1, // ACTION_ROW
                        components: [
                            {
                                type: 2, // BUTTON
                                style: 5, // LINK
                                label: 'Jamboard を開く',
                                url: jamboardUrl,
                                emoji: { name: '🎨' }
                            }
                        ]
                    }
                ],
                flags: MessageFlags.Ephemeral
            });

            console.log(`Jamboard URL送信: ${interaction.user.tag}`);
        } catch (error) {
            console.error('Jam コマンドエラー:', error);
            await interaction.reply({
                content: '❌ Jamboard URLの送信中にエラーが発生しました。',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};

export default subcommandHandler;
