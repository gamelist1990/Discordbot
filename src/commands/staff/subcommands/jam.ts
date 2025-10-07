import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import crypto from 'crypto';

/**
 * Jam サブコマンドハンドラー
 */
export const subcommandHandler = {
    name: 'jam',
    description: 'スタッフ用Jamboard（ホワイトボード・Todoツール）を開く',
    
    builder: (subcommand: any) => {
        return subcommand
            .setName('jam')
            .setDescription('スタッフ用Jamboard（ホワイトボード・Todoツール）を開く')
            .addStringOption((option: any) =>
                option
                    .setName('type')
                    .setDescription('開くJamboardの種類')
                    .setRequired(false)
                    .addChoices(
                        { name: 'スタッフ共有Jamboard', value: 'staff' },
                        { name: '個人用Jamboard', value: 'personal' }
                    )
            );
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ このコマンドはサーバー内でのみ使用できます。',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const type = interaction.options.getString('type') || 'staff';

        try {
            // セッショントークンを生成
            const sessionToken = crypto.randomBytes(32).toString('hex');
            
            // TODO: セッションを保存する処理を追加
            // 実際の実装では、SettingsServer のセッションマップに追加する必要がある
            
            // JamboardのURLを生成
            const baseUrl = process.env.WEB_BASE_URL || 'http://localhost:3000';
            let jamboardUrl: string;

            if (type === 'staff') {
                jamboardUrl = `${baseUrl}/staff/jamboard/${sessionToken}?type=staff`;
            } else {
                jamboardUrl = `${baseUrl}/staff/jamboard/${sessionToken}?type=personal`;
            }

            // 埋め込みメッセージを作成
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎨 Jamboard へのアクセス')
                .setDescription(
                    type === 'staff'
                        ? 'スタッフ全員が共有できるJamboardです。\nホワイトボードでアイデアを共有したり、Todoを管理できます。'
                        : '個人用のJamboardです。\n他のユーザーを招待してコラボレーションできます。'
                )
                .addFields(
                    {
                        name: '📋 利用可能な機能',
                        value: '• ホワイトボード（自由に描画）\n• Todoリスト\n• リアルタイム同期',
                        inline: false
                    },
                    {
                        name: '🔐 アクセス方法',
                        value: '下のボタンをクリックしてJamboardを開いてください。\nDiscordアカウントで認証が必要です。',
                        inline: false
                    }
                )
                .setFooter({ text: 'セッションは1時間有効です' })
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

            console.log(`Jamboard アクセス生成: ${interaction.user.tag} (${type})`);
        } catch (error) {
            console.error('Jam コマンドエラー:', error);
            await interaction.reply({
                content: '❌ Jamboardのアクセスリンク生成中にエラーが発生しました。',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};

export default subcommandHandler;
