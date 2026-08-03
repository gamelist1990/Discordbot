import {
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    SlashCommandStringOption,
    SlashCommandSubcommandBuilder,
    TextChannel
} from 'discord.js';

const MAX_SLOWMODE_SECONDS = 6 * 60 * 60;

export default {
    name: 'slowmode',
    description: '現在のチャンネルのスローモードを設定します',

    builder: (subcommand: SlashCommandSubcommandBuilder) => {
        const durationOption = new SlashCommandStringOption()
            .setName('duration')
            .setDescription('スローモードの時間（例: 1s, 5m, 1h、解除は 0s または off）')
            .setRequired(true);

        return subcommand
            .setName('slowmode')
            .setDescription('現在のチャンネルのスローモードを設定します')
            .addStringOption(durationOption);
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ このコマンドはサーバー内でのみ使用できます。',
                ephemeral: true
            });
            return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
            await interaction.reply({
                content: '❌ このコマンドを実行する権限がありません（Manage Channels）。',
                ephemeral: true
            });
            return;
        }

        const channel = interaction.channel;
        if (!(channel instanceof TextChannel)) {
            await interaction.reply({
                content: '❌ スローモードを設定できるテキストチャンネルで実行してください。',
                ephemeral: true
            });
            return;
        }

        const botMember = interaction.guild.members.me;
        if (!botMember || !channel.permissionsFor(botMember).has(PermissionFlagsBits.ManageChannels)) {
            await interaction.reply({
                content: '❌ ボットにこのチャンネルを管理する権限がありません（Manage Channels）。',
                ephemeral: true
            });
            return;
        }

        const durationInput = interaction.options.getString('duration', true);
        const seconds = parseSlowmodeDuration(durationInput);

        if (seconds === null) {
            await interaction.reply({
                content: '❌ 時間の形式が正しくありません。例: `1s`、`5m`、`1h`。解除する場合は `0s` または `off` を指定してください。',
                ephemeral: true
            });
            return;
        }

        if (seconds > MAX_SLOWMODE_SECONDS) {
            await interaction.reply({
                content: '❌ スローモードは最大6時間まで設定できます。',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            await channel.setRateLimitPerUser(
                seconds,
                `Staff slowmode command by ${interaction.user.tag} (${interaction.user.id})`
            );

            if (seconds === 0) {
                await interaction.editReply({
                    content: `✅ ${channel} のスローモードを解除しました。`
                });
                return;
            }

            await interaction.editReply({
                content: `✅ ${channel} のスローモードを **${formatDuration(seconds)}** に設定しました。`
            });
        } catch (error) {
            console.error('Staff slowmode command error:', error);
            await interaction.editReply({
                content: '❌ スローモードの設定に失敗しました。ボットの権限とチャンネルの種類を確認してください。'
            });
        }
    }
};

function parseSlowmodeDuration(input: string): number | null {
    const normalized = input.trim().toLowerCase();

    if (normalized === 'off' || normalized === 'clear' || normalized === 'none') {
        return 0;
    }

    const match = /^(\d+)\s*(s|m|h)$/.exec(normalized);
    if (!match) {
        return null;
    }

    const value = Number(match[1]);
    if (!Number.isSafeInteger(value) || value < 0) {
        return null;
    }

    switch (match[2]) {
        case 's':
            return value;
        case 'm':
            return value * 60;
        case 'h':
            return value * 60 * 60;
        default:
            return null;
    }
}

function formatDuration(seconds: number): string {
    if (seconds % 3600 === 0) {
        return `${seconds / 3600}時間`;
    }

    if (seconds % 60 === 0) {
        return `${seconds / 60}分`;
    }

    return `${seconds}秒`;
}
