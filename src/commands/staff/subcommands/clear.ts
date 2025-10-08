import { ChatInputCommandInteraction, TextChannel, PermissionFlagsBits, MessageFlags } from 'discord.js';

export default {
    name: 'clear',
    description: 'このチャンネルのメッセージを指定数削除します（最大100件）',

    builder: (subcommand: any) => {
        return subcommand
            .setName('clear')
            .setDescription('チャンネルのメッセージを削除します')
            .addIntegerOption((opt: any) =>
                opt.setName('count')
                    .setDescription('削除するメッセージ数（1〜100）')
                    .setRequired(true)
            );
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({ content: '❌ このコマンドはサーバー内でのみ使用できます。', flags: MessageFlags.Ephemeral });
            return;
        }

        // 権限チェック
        const channel = interaction.channel as TextChannel | null;

        if (!channel) {
            await interaction.reply({ content: '❌ このチャンネルで実行できません。', flags: MessageFlags.Ephemeral });
            return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            await interaction.reply({ content: '❌ このコマンドを実行する権限がありません（Manage Messages）。', flags: MessageFlags.Ephemeral });
            return;
        }

        const count = interaction.options.getInteger('count', true);
        if (isNaN(count) || count < 1 || count > 100) {
            await interaction.reply({ content: '❌ 削除数は 1〜100 の間で指定してください。', flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // bulkDelete は 14日より古いメッセージは削除できない点に注意
            const deleted = await channel.bulkDelete(count, true);

            await interaction.editReply({ content: `✅ ${deleted.size} 件のメッセージを削除しました（ボット・埋め込み・メディア等を含みます）。` });
        } catch (err) {
            console.error('Clear command error:', err);
            await interaction.editReply({ content: '❌ メッセージの削除に失敗しました。権限やメッセージの年齢（14日以上）を確認してください。' });
        }
    }
};
