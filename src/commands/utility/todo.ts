import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import config from '../../config';

/**
 * Todo コマンドハンドラー
 */
export const commandHandler = {
    name: 'todo',
    description: 'Todo管理ツールを開く',

    builder: (command: any) => {
        return command
            .setName('todo')
            .setDescription('Todo管理ツールを開く');
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
            // TodoのURLを生成（guildId を含める）
            const baseUrl = config.WEB_BASE_URL;
            const guildId = interaction.guild.id;
            const todoUrl = `${baseUrl}/todo/${guildId}`;

            // 埋め込みメッセージを作成
            const embed = new EmbedBuilder()
                .setColor(0x4285F4) // Google Blue
                .setTitle('📝 Todo管理ツール')
                .setDescription(
                    'プロジェクトとタスクを効率的に管理できます。\n' +
                    'Todoセッションを作成し、チームメンバーと共有しましょう。'
                )
                .addFields(
                    {
                        name: '✨ 主な機能',
                        value: 
                            '• 最大3つのTodoセッションを作成\n' +
                            '• タスクの優先度とタグ管理\n' +
                            '• チームメンバーとの共有（閲覧者・編集者）\n' +
                            '• お気に入り登録',
                        inline: false
                    },
                    {
                        name: '🔐 アクセス方法',
                        value: '下のボタンをクリックしてTodoツールを開いてください。\nDiscordアカウントでログインが必要です。',
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Google Material Design' });

            await interaction.reply({
                embeds: [embed],
                components: [
                    {
                        type: 1, // ACTION_ROW
                        components: [
                            {
                                type: 2, // BUTTON
                                style: 5, // LINK
                                label: 'Todoツールを開く',
                                url: todoUrl,
                                emoji: { name: '📝' }
                            }
                        ]
                    }
                ],
                flags: MessageFlags.Ephemeral
            });

            console.log(`Todo URL送信: ${interaction.user.tag} (guild: ${guildId})`);
        } catch (error) {
            console.error('Todo コマンドエラー:', error);
            await interaction.reply({
                content: '❌ Todo URLの送信中にエラーが発生しました。',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};

export default commandHandler;
