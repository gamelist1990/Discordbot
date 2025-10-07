import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
// lazy import config to avoid circular deps at runtime
// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('../../../config').default;

/**
 * Jam コマンドハンドラー
 */
export const commandHandler = {
    name: 'jam',
    description: 'Jamboard（ホワイトボード・Todoツール）を開く',

    builder: (command: any) => {
        return command
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
            // JamboardのURLを生成（guildId を含める）
            const baseUrl = config.WEB_BASE_URL;
            const guildId = interaction.guild.id;
            const jamboardUrl = `${baseUrl}/jamboard/${guildId}`;

            // 埋め込みメッセージを作成
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎨 Jamboard へのアクセス')
                .setDescription(
                    'コラボレーションツールです。\nホワイトボードでアイデアを共有したり、Todoを管理できます。'
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

            console.log(`Jamboard URL送信: ${interaction.user.tag} (guild: ${guildId})`);
        } catch (error) {
            console.error('Jam コマンドエラー:', error);
            await interaction.reply({
                content: '❌ Jamboard URLの送信中にエラーが発生しました。',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};

export default commandHandler;