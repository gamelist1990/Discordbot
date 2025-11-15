import {
    ChatInputCommandInteraction,
    EmbedBuilder,
} from 'discord.js';
    // MessageFlags removed as it is unused
import config from '../../config';


/**
 * /staff privatechat サブコマンドを処理
 * すべての操作はWeb UIで行う
 */
export async function handlePrivateChatSubcommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await openManagementUI(interaction);
}

/**
 * Web UI 管理画面を開く
 */
async function openManagementUI(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await interaction.reply({
            content: '❌ このコマンドはサーバー内でのみ使用できます。',
            ephemeral: true
        });
        return;
    }

    // SettingsServer インスタンスを取得
    const settingsServer = (interaction.client as any).settingsServer;

    if (!settingsServer) {
        await interaction.reply({
            content: '❌ Web UI管理機能が利用できません。設定サーバーが起動していない可能性があります。',
            ephemeral: true
        });
        return;
    }

    try {
        const managementUrl = `${config.WEB_BASE_URL}/staff/privatechat`;



        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🖥️ プライベートチャット管理画面')
            .setDescription(
                `以下のURLからWeb UIでプライベートチャットを管理できます：\n\n` +
                `${managementUrl}\n\n` +
                `⚠️ このURLは他の人と共有しないでください。`
            )

            .addFields(
                {
                    name: '💡 Web UIでできること',
                    value:
                        '• プライベートチャットの作成\n' +
                        '• アクティブなチャットの一覧表示\n' +
                        '• チャットの削除\n' +
                        '• チャット統計の確認',
                    inline: false
                }
            )

            .setTimestamp()
            .setFooter({ text: 'すべての操作はブラウザから行えます' });

        await interaction.reply({ embeds: [embed], ephemeral: true });

    } catch (error) {
        console.error('Web UI管理画面エラー:', error);
        if (interaction.replied) {
            await interaction.followUp({
                content: '❌ 管理画面URLの生成中にエラーが発生しました。',
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: '❌ 管理画面URLの生成中にエラーが発生しました。',
                ephemeral: true
            });
        }
    }
}

export default null;
