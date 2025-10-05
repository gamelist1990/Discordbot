import { PermissionLevel, DynamicCommandOptions, CommandBuilderCallback } from '../../types/enhanced-command.js';
import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { database } from '../../core/Database.js';

const command: DynamicCommandOptions = {
    name: 'db',
    description: 'データベース操作のテストコマンド',
    permissionLevel: PermissionLevel.OP,
    
    builder: ((eb: SlashCommandBuilder) => {
        return eb
            .addSubcommand(subcommand =>
                subcommand
                    .setName('set')
                    .setDescription('データを保存します')
                    .addStringOption(option =>
                        option.setName('key')
                            .setDescription('保存するキー')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('value')
                            .setDescription('保存する値')
                            .setRequired(true))
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('get')
                    .setDescription('データを取得します')
                    .addStringOption(option =>
                        option.setName('key')
                            .setDescription('取得するキー')
                            .setRequired(true))
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('delete')
                    .setDescription('データを削除します')
                    .addStringOption(option =>
                        option.setName('key')
                            .setDescription('削除するキー')
                            .setRequired(true))
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('list')
                    .setDescription('すべてのキーを表示します')
            );
    }) as CommandBuilderCallback,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'set': {
                    const key = interaction.options.getString('key', true);
                    const value = interaction.options.getString('value', true);
                    
                    await database.set(key, { value, savedAt: new Date().toISOString(), savedBy: interaction.user.id });
                    
                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ データを保存しました')
                        .addFields(
                            { name: 'キー', value: key, inline: true },
                            { name: '値', value: value, inline: true }
                        )
                        .setTimestamp();
                    
                    await interaction.reply({ embeds: [embed] });
                    break;
                }

                case 'get': {
                    const key = interaction.options.getString('key', true);
                    const data = await database.get(key);

                    if (!data) {
                        await interaction.reply({ content: `❌ キー \`${key}\` は存在しません。`, flags: MessageFlags.Ephemeral });
                        return;
                    }

                    const embed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('📦 データ取得')
                        .addFields(
                            { name: 'キー', value: key, inline: false },
                            { name: '値', value: JSON.stringify(data, null, 2), inline: false }
                        )
                        .setTimestamp();

                    await interaction.reply({ embeds: [embed] });
                    break;
                }

                case 'delete': {
                    const key = interaction.options.getString('key', true);
                    await database.delete(key);

                    const embed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('🗑️ データを削除しました')
                        .addFields({ name: 'キー', value: key })
                        .setTimestamp();

                    await interaction.reply({ embeds: [embed] });
                    break;
                }

                case 'list': {
                    const keys = await database.keys();

                    const embed = new EmbedBuilder()
                        .setColor('#ffff00')
                        .setTitle('📋 データベースキー一覧')
                        .setDescription(keys.length > 0 ? keys.map(k => `\`${k}\``).join(', ') : '保存されているデータはありません')
                        .setFooter({ text: `合計: ${keys.length} 個` })
                        .setTimestamp();

                    await interaction.reply({ embeds: [embed] });
                    break;
                }
            }
        } catch (error) {
            console.error('データベース操作エラー:', error);
            await interaction.reply({ content: '❌ データベース操作中にエラーが発生しました。', flags: MessageFlags.Ephemeral });
        }
    }
};

export default command;
