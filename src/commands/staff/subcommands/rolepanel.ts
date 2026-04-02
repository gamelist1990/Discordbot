import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType,
    SlashCommandSubcommandBuilder,
    SlashCommandStringOption,
    SlashCommandChannelOption,
    ButtonInteraction,
    GuildMemberRoleManager,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalSubmitInteraction
} from 'discord.js';

import { RolePresetManager } from '../../../core/RolePresetManager.js';
import config from '../../../config.js';
import { registerModalHandler } from '../../../utils/Modal.js';

/**
 * ロールが操作可能かどうかをチェック
 */
function canManageRole(role: any, botMember: any): boolean {
    return role && role.position < botMember.roles.highest.position;
}

function resolveAuthUrl(preset: any): string {
    if (typeof preset?.authUrl === 'string' && preset.authUrl.trim()) {
        return preset.authUrl.trim();
    }
    const base = (config as any)?.BASE_URL;
    if (typeof base === 'string' && base.trim()) {
        return `${base.replace(/\/+$/g, '')}/api/auth/discord`;
    }
    return '/api/auth/discord';
}

type AuthCodeRecord = {
    guildId: string;
    presetId: string;
    userId: string;
    code: string;
    roles: string[];
    expiresAt: number;
};

type AuthMathRecord = {
    guildId: string;
    presetId: string;
    userId: string;
    questions: Array<{ label: string; answer: number }>;
    roles: string[];
    expiresAt: number;
};

type PanelPresetSummary = {
    description: string;
    panelType?: 'toggle' | 'grant_missing';
    authType?: 'none' | 'web' | 'code' | 'math';
};

const AUTH_TTL_MS = 10 * 60 * 1000;
const ONE_DIGIT_MIN = 1;
const ONE_DIGIT_MAX = 9;
const authCodeRecords = new Map<string, AuthCodeRecord>();
const authMathRecords = new Map<string, AuthMathRecord>();
const authGrantRecords = new Map<string, {
    guildId: string;
    presetId: string;
    userId: string;
    roles: string[];
    expiresAt: number;
}>();

function generateAuthToken(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

function cleanupExpiredAuthRecords(): void {
    const now = Date.now();
    for (const [token, record] of authCodeRecords.entries()) {
        if (record.expiresAt <= now) {
            authCodeRecords.delete(token);
        }
    }
    for (const [token, record] of authMathRecords.entries()) {
        if (record.expiresAt <= now) {
            authMathRecords.delete(token);
        }
    }
    for (const [token, record] of authGrantRecords.entries()) {
        if (record.expiresAt <= now) {
            authGrantRecords.delete(token);
        }
    }
}

function makeOneDigitMathQuestion(): { label: string; answer: number } {
    const left = Math.floor(Math.random() * ONE_DIGIT_MAX) + ONE_DIGIT_MIN;
    const right = Math.floor(Math.random() * ONE_DIGIT_MAX) + ONE_DIGIT_MIN;
    const plus = Math.random() >= 0.5;
    if (plus) {
        return { label: `${left} + ${right}`, answer: left + right };
    }
    const a = Math.max(left, right);
    const b = Math.min(left, right);
    return { label: `${a} - ${b}`, answer: a - b };
}

function generateSixDigitCode(): string {
    return `${Math.floor(Math.random() * 900000) + 100000}`;
}

function getAuthRecordKey(guildId: string, presetId: string, userId: string): string {
    return `${guildId}:${presetId}:${userId}`;
}

function buildPanelUsageDescription(preset: PanelPresetSummary): string {
    const panelType = preset.panelType || 'toggle';
    const authType = preset.authType || 'none';

    const lines: string[] = [];
    if (panelType === 'grant_missing') {
        lines.push('• ボタンをクリックして不足ロールの付与を開始');
        if (authType === 'none') {
            lines.push('• 不足ロールをそのまま一括付与');
        } else if (authType === 'web') {
            lines.push('• Web認証完了後に不足ロールを一括付与');
        } else if (authType === 'code') {
            lines.push('• ダイアログで認証コードを入力すると不足ロールを一括付与');
        } else if (authType === 'math') {
            lines.push('• ダイアログで計算問題(3問)に正解すると不足ロールを一括付与');
        } else {
            lines.push('• 認証方式を確認してから利用してください');
        }
        lines.push('• すでに所持しているロールはスキップされます');
    } else {
        lines.push('• ボタンをクリックしてロール管理を開始');
        lines.push('• 現在のロール状態を確認可能');
        lines.push('• ロールの追加/削除が可能');
    }

    return (
        preset.description +
        '\n\n**使い方:**' +
        `\n${lines.join('\n')}` +
        '\n\n**注意:** ボットより上位のロールは操作不可'
    );
}

/**
 * /staff rolepanel サブコマンド
 */
const rolePanelSubcommand = {
    name: 'rolepanel',
    description: 'ロールパネルを投稿または管理します',

    builder: (subcommand: SlashCommandSubcommandBuilder) => {
        return subcommand
            .setName('rolepanel')
            .setDescription('ロールパネルを投稿します')
            .addStringOption((opt: SlashCommandStringOption) =>
                opt.setName('preset')
                    .setDescription('使用するプリセットID')
                    .setRequired(true)
            )
            .addChannelOption((opt: SlashCommandChannelOption) =>
                opt.setName('channel')
                    .setDescription('パネルを投稿するチャンネル（省略時は現在のチャンネル）')
                    .setRequired(false)
            );
    },

    /**
     * インタラクションのハンドリング（ロールパネル）
     */
    async handleInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
        if (!interaction.customId.startsWith('rolepanel:')) return;

        try {
            const parts = interaction.customId.split(':');
            // parts: ['rolepanel', guildId, presetId, action]
            const guildId = parts[1];
            const presetId = parts[2];
            const action = parts[3];

            if (!interaction.guild || interaction.guild.id !== guildId) {
                await interaction.reply({
                    content: '❌ このパネルは別のサーバー用です。',
                    ephemeral: true
                });
                return;
            }

            const member = interaction.member;
            if (!member) {
                await interaction.reply({
                    content: '❌ メンバー情報を取得できませんでした。',
                    ephemeral: true
                });
                return;
            }

            // プリセットを取得
            const preset = await RolePresetManager.getPreset(guildId, presetId);
            if (!preset) {
                await interaction.reply({
                    content: '❌ このプリセットは削除されました。',
                    ephemeral: true
                });
                return;
            }

            // ボタンクリックの場合はロール選択メニューを表示
            if (interaction.isButton() && action === 'manage') {
                await this.showRoleSelectionMenu(interaction as ButtonInteraction, preset);
                return;
            }

            if (interaction.isButton() && action === 'auth_modal') {
                const modalType = parts[4];
                await this.showAuthModal(interaction as ButtonInteraction, preset, modalType);
                return;
            }

            if (interaction.isButton() && action === 'grant') {
                const token = parts[4];
                await this.handleGrantButton(interaction as ButtonInteraction, preset, token);
                return;
            }

            // SelectMenu選択の場合はロール変更処理
            if (interaction.isStringSelectMenu() && action === 'select') {
                await this.handleRoleChange(interaction as StringSelectMenuInteraction, preset);
                return;
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'エラー';

            if (interaction.deferred) {
                await interaction.editReply({
                    content: `❌ エラー: ${errorMsg}`
                });
            } else {
                await interaction.reply({
                    content: `❌ エラー: ${errorMsg}`,
                    ephemeral: true
                });
            }
        }
    },

    /**
     * ボタンクリック時の処理 - ロール選択メニューを表示
     */
    async showRoleSelectionMenu(interaction: ButtonInteraction, preset: any): Promise<void> {
        const member = interaction.member as any;
        if (!member) return;

        if ((preset.panelType || 'toggle') === 'grant_missing') {
            await this.handleGrantMissingEntry(interaction, preset);
            return;
        }

        // 現在のロール状態を取得
        const currentRoles = member.roles.cache.map((r: any) => r.id);

        // SelectMenuのオプションを作成
        const options: StringSelectMenuOptionBuilder[] = [];
        for (const roleId of preset.roles) {
            const role = interaction.guild!.roles.cache.get(roleId);
            if (!role) continue;

            const hasRole = currentRoles.includes(roleId);
            const option = new StringSelectMenuOptionBuilder()
                .setLabel(role.name)
                .setValue(roleId)
                .setDescription(`現在の状態: ${hasRole ? '付与済み' : '未付与'}`)
                .setEmoji(hasRole ? '✅' : '⬜')
                .setDefault(hasRole);

            options.push(option);
        }

        if (options.length === 0) {
            await interaction.reply({
                content: '❌ 選択可能なロールが見つかりません。',
                ephemeral: true
            });
            return;
        }

        // SelectMenuを作成
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`rolepanel:${interaction.guild!.id}:${preset.id}:select`)
            .setPlaceholder('ロールを選択')
            .setMinValues(0)
            .setMaxValues(options.length);

        // オプションを追加
        if (options.length > 0) {
            selectMenu.addOptions(...options);
        }

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(selectMenu);

        await interaction.reply({
            content: `🎭 **${preset.name}** - ロールを選択してください`,
            components: [row],
            ephemeral: true
        });
    },

    /**
     * SelectMenu選択時の処理 - ロール変更処理
     */
    async handleRoleChange(interaction: StringSelectMenuInteraction, preset: any): Promise<void> {
        const member = interaction.member as any;
        if (!member) return;

        await interaction.deferUpdate();

        const selectedRoleIds = interaction.values;
        const currentRoles = (member.roles as GuildMemberRoleManager).cache.map(r => r.id);
        const results: string[] = [];
        const errors: string[] = [];
        const botMember = interaction.guild!.members.me;

        // プリセット内のロールとの差分を計算
        for (const roleId of preset.roles) {
            const role = interaction.guild!.roles.cache.get(roleId);
            if (!role) continue;

            const isSelected = selectedRoleIds.includes(roleId);
            const hasRole = currentRoles.includes(roleId);

            // 選択されているが持っていない → 追加
            if (isSelected && !hasRole) {
                try {
                    if (!canManageRole(role, botMember)) {
                        errors.push(`${role.name}: 権限不足`);
                        continue;
                    }

                    await (member.roles as GuildMemberRoleManager).add(role);
                    results.push(`✅ ${role.name} を追加`);
                } catch (error) {
                    errors.push(`${role.name}: エラー`);
                }
            }
            // 選択されていないが持っている → 削除
            else if (!isSelected && hasRole) {
                try {
                    await (member.roles as GuildMemberRoleManager).remove(role);
                    results.push(`➖ ${role.name} を削除`);
                } catch (error) {
                    errors.push(`${role.name}: エラー`);
                }
            }
        }

        // 結果を表示
        let message = '';
        if (results.length > 0) {
            message += results.join('\n');
        }
        if (results.length === 0 && errors.length === 0) {
            message = '✅ 変更はありませんでした。';
        }
        if (errors.length > 0) {
            message += '\n\n**エラー:**\n' + errors.join('\n');
        }

        // 元のドロップダウンメッセージを結果に更新
        await interaction.editReply({
            content: message,
            components: []
        });
    },

    async handleGrantMissingEntry(interaction: ButtonInteraction, preset: any): Promise<void> {
        cleanupExpiredAuthRecords();

        const member = interaction.member as any;
        if (!member || !interaction.guild) return;

        const botMember = interaction.guild.members.me;
        const currentRoles = (member.roles as GuildMemberRoleManager).cache.map((r) => r.id);
        const missingRoleIds = (preset.roles || []).filter((roleId: string) => !currentRoles.includes(roleId));

        if (missingRoleIds.length === 0) {
            await interaction.reply({
                content: '✅ すでに必要なロールをすべて所持しています。このパネルでは追加できるロールがありません。',
                ephemeral: true
            });
            return;
        }

        if ((preset.authType || 'none') === 'none') {
            const message = await this.grantMissingRoles(interaction.guild.id, preset.id, member, botMember, missingRoleIds);
            await interaction.reply({ content: message, ephemeral: true });
            return;
        }

        const authType = preset.authType || 'none';
        if (authType === 'web') {
            const token = generateAuthToken('grant');
            authGrantRecords.set(token, {
                guildId: interaction.guild.id,
                presetId: preset.id,
                userId: interaction.user.id,
                roles: missingRoleIds,
                expiresAt: Date.now() + AUTH_TTL_MS
            });

            const authUrl = resolveAuthUrl(preset);
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setLabel('Web認証を開く')
                    .setStyle(ButtonStyle.Link)
                    .setURL(authUrl),
                new ButtonBuilder()
                    .setCustomId(`rolepanel:${interaction.guild.id}:${preset.id}:grant:${token}`)
                    .setLabel('認証後に一括付与')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );
            await interaction.reply({
                content: `🔐 Web認証を完了してから「認証後に一括付与」を押してください。\n認証URL: ${authUrl}`,
                components: [row],
                ephemeral: true
            });
            return;
        }

        const authKey = getAuthRecordKey(interaction.guild.id, preset.id, interaction.user.id);
        if (authType === 'code') {
            const code = generateSixDigitCode();
            authCodeRecords.set(authKey, {
                guildId: interaction.guild.id,
                presetId: preset.id,
                userId: interaction.user.id,
                code,
                roles: missingRoleIds,
                expiresAt: Date.now() + AUTH_TTL_MS
            });
            await this.showAuthModal(interaction, preset, 'code');
            return;
        }

        if (authType === 'math') {
            const questions = [makeOneDigitMathQuestion(), makeOneDigitMathQuestion(), makeOneDigitMathQuestion()];
            authMathRecords.set(authKey, {
                guildId: interaction.guild.id,
                presetId: preset.id,
                userId: interaction.user.id,
                questions,
                roles: missingRoleIds,
                expiresAt: Date.now() + AUTH_TTL_MS
            });
            await this.showAuthModal(interaction, preset, 'math');
            return;
        }

        await interaction.reply({
            content: '❌ 不明な認証方式です。',
            ephemeral: true
        });
    },

    async showAuthModal(interaction: ButtonInteraction, preset: any, modalType: string): Promise<void> {
        if (!interaction.guild) return;
        const key = getAuthRecordKey(interaction.guild.id, preset.id, interaction.user.id);

        if (modalType === 'code') {
            const record = authCodeRecords.get(key);
            if (!record || record.expiresAt <= Date.now()) {
                authCodeRecords.delete(key);
                await interaction.reply({ content: '❌ 認証コードが期限切れです。もう一度パネルを押してください。', ephemeral: true });
                return;
            }

            const modal = new ModalBuilder()
                .setCustomId('rolepanel_auth_code_modal')
                .setTitle('Code 認証');
            const codeInput = new TextInputBuilder()
                .setCustomId('code')
                .setLabel('表示されたコードを入力')
                .setPlaceholder(`認証コード: ${record.code}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(12);
            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(codeInput));
            await interaction.showModal(modal);
            return;
        }

        if (modalType === 'math') {
            const record = authMathRecords.get(key);
            if (!record || record.expiresAt <= Date.now()) {
                authMathRecords.delete(key);
                await interaction.reply({ content: '❌ 計算認証が期限切れです。もう一度パネルを押してください。', ephemeral: true });
                return;
            }

            const modal = new ModalBuilder()
                .setCustomId('rolepanel_auth_math_modal')
                .setTitle('計算認証 (3問)');
            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder().setCustomId('q1').setLabel(record.questions[0].label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder().setCustomId('q2').setLabel(record.questions[1].label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder().setCustomId('q3').setLabel(record.questions[2].label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5)
                )
            );
            await interaction.showModal(modal);
            return;
        }

        await interaction.reply({ content: '❌ 不明な認証モーダルです。', ephemeral: true });
    },

    async handleGrantButton(interaction: ButtonInteraction, preset: any, token: string): Promise<void> {
        cleanupExpiredAuthRecords();
        const respond = async (content: string): Promise<void> => {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content, ephemeral: true });
                return;
            }
            await interaction.update({ content, components: [] });
        };
        const record = authGrantRecords.get(token);
        if (!record || !interaction.guild) {
            await respond('❌ 認証情報が見つからないか期限切れです。');
            return;
        }

        if (
            record.guildId !== interaction.guild.id
            || record.presetId !== preset.id
            || record.userId !== interaction.user.id
            || record.expiresAt <= Date.now()
        ) {
            authGrantRecords.delete(token);
            await respond('❌ 認証情報が一致しません。もう一度やり直してください。');
            return;
        }

        const member = interaction.member as any;
        if (!member) {
            await respond('❌ メンバー情報を取得できませんでした。');
            return;
        }

        const botMember = interaction.guild.members.me;
        const currentRoles = (member.roles as GuildMemberRoleManager).cache.map((r) => r.id);
        const stillMissing = record.roles.filter((roleId) => !currentRoles.includes(roleId));
        const message = await this.grantMissingRoles(interaction.guild.id, preset.id, member, botMember, stillMissing);
        authGrantRecords.delete(token);
        await respond(message);
    },

    async grantMissingRoles(guildId: string, presetId: string, member: any, botMember: any, roleIds: string[]): Promise<string> {
        if (!member.guild) {
            return '❌ サーバー情報を取得できませんでした。';
        }

        if (roleIds.length === 0) {
            return '✅ すでに必要なロールをすべて所持しています。';
        }

        const results: string[] = [];
        const errors: string[] = [];
        for (const roleId of roleIds) {
            const role = member.guild.roles.cache.get(roleId);
            if (!role) continue;
            if (!canManageRole(role, botMember)) {
                errors.push(`${role.name}: 権限不足`);
                continue;
            }
            try {
                await (member.roles as GuildMemberRoleManager).add(role);
                results.push(`✅ ${role.name} を追加`);
                await RolePresetManager.logRoleChange({
                    timestamp: new Date().toISOString(),
                    guildId,
                    userId: member.id,
                    executorId: member.id,
                    presetId,
                    action: 'add',
                    roleId: role.id,
                    roleName: role.name,
                    success: true
                });
            } catch (error) {
                errors.push(`${role.name}: 追加失敗`);
            }
        }

        if (results.length === 0 && errors.length === 0) {
            return '✅ 変更はありませんでした。';
        }
        return [
            results.join('\n'),
            errors.length > 0 ? `\n**エラー:**\n${errors.join('\n')}` : ''
        ].join('').trim();
    },

    async grantRolesAfterAuth(
        interaction: ModalSubmitInteraction,
        record: { guildId: string; presetId: string; userId: string; roles: string[] }
    ): Promise<string> {
        if (!interaction.guild) {
            return '❌ サーバー内でのみ使用できます。';
        }
        const member = await interaction.guild.members.fetch(record.userId).catch(() => null);
        if (!member) {
            return '❌ メンバー情報を取得できませんでした（サーバーから退出した可能性があります）。';
        }
        const botMember = interaction.guild.members.me;
        const currentRoles = (member.roles as GuildMemberRoleManager).cache.map((r) => r.id);
        const stillMissing = record.roles.filter((roleId) => !currentRoles.includes(roleId));
        return this.grantMissingRoles(record.guildId, record.presetId, member, botMember, stillMissing);
    },

    async handleCodeModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
        cleanupExpiredAuthRecords();
        if (!interaction.guild) {
            await interaction.reply({ content: '❌ サーバー内でのみ使用できます。', ephemeral: true });
            return;
        }

        const record = Array.from(authCodeRecords.values()).find((entry) =>
            entry.guildId === interaction.guild!.id
            && entry.userId === interaction.user.id
            && entry.expiresAt > Date.now()
        );
        if (!record) {
            await interaction.reply({ content: '❌ 認証コードが見つかりません。もう一度やり直してください。', ephemeral: true });
            return;
        }

        const entered = interaction.fields.getTextInputValue('code').trim();
        if (entered !== record.code) {
            await interaction.reply({ content: '❌ コードが一致しません。', ephemeral: true });
            return;
        }

        authCodeRecords.delete(getAuthRecordKey(record.guildId, record.presetId, record.userId));
        const message = await this.grantRolesAfterAuth(interaction, record);

        await interaction.reply({
            content: `✅ 認証成功。\n${message}`,
            ephemeral: true
        });
    },

    async handleMathModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
        cleanupExpiredAuthRecords();
        if (!interaction.guild) {
            await interaction.reply({ content: '❌ サーバー内でのみ使用できます。', ephemeral: true });
            return;
        }

        const record = Array.from(authMathRecords.values()).find((entry) =>
            entry.guildId === interaction.guild!.id
            && entry.userId === interaction.user.id
            && entry.expiresAt > Date.now()
        );
        if (!record) {
            await interaction.reply({ content: '❌ 計算認証情報が見つかりません。もう一度やり直してください。', ephemeral: true });
            return;
        }

        const answers = [
            Number(interaction.fields.getTextInputValue('q1').trim()),
            Number(interaction.fields.getTextInputValue('q2').trim()),
            Number(interaction.fields.getTextInputValue('q3').trim())
        ];
        const ok = answers.every((value, index) => Number.isFinite(value) && value === record.questions[index].answer);
        if (!ok) {
            await interaction.reply({ content: '❌ 計算結果が正しくありません。', ephemeral: true });
            return;
        }

        authMathRecords.delete(getAuthRecordKey(record.guildId, record.presetId, record.userId));
        const message = await this.grantRolesAfterAuth(interaction, record);

        await interaction.reply({
            content: `✅ 計算認証に成功しました。\n${message}`,
            ephemeral: true
        });
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ このコマンドはサーバー内でのみ使用できます。',
                ephemeral: true
            });
            return;
        }

        // Bot権限チェック
        const botMember = interaction.guild.members.me;
        if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            await interaction.reply({
                content: '❌ Botに「ロールの管理」権限がありません。',
                ephemeral: true
            });
            return;
        }

        const presetId = interaction.options.getString('preset', true);
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

        // テキストチャンネルかどうかをチェック
        const isTextChannel = targetChannel?.type !== ChannelType.GuildVoice && targetChannel?.type !== ChannelType.GuildCategory;

        if (!targetChannel || !isTextChannel) {
            await interaction.reply({
                content: '❌ 有効なテキストチャンネルを指定してください。',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // プリセットを取得
            const preset = await RolePresetManager.getPreset(interaction.guild.id, presetId);

            if (!preset) {
                await interaction.editReply({
                    content: `❌ プリセット '${presetId}' が見つかりません。Web管理画面で作成してください。`
                });
                return;
            }

            // ロール情報をチェック
            const missingRoles: string[] = [];

            for (const roleId of preset.roles) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (!canManageRole(role, botMember)) {
                    missingRoles.push(role ? `${role.name} (権限不足)` : roleId);
                }
            }

            if (preset.roles.length === missingRoles.length) {
                await interaction.editReply({
                    content: `❌ プリセット内の有効なロールが見つかりませんでした。\n` +
                        `不足: ${missingRoles.join(', ')}`
                });
                return;
            }

            // Embedを作成
            const embed = new EmbedBuilder()
                .setTitle(`🎭 ${preset.name}`)
                .setDescription(buildPanelUsageDescription(preset))
                .setColor(0x5865F2)
                .setFooter({ text: `ID: ${preset.id}` })
                .setTimestamp();

            // ボタンを作成
            const roleButton = new ButtonBuilder()
                .setCustomId(`rolepanel:${interaction.guild.id}:${preset.id}:manage`)
                .setLabel((preset.panelType || 'toggle') === 'grant_missing' ? '不足ロールを受け取る' : 'ロールを管理する')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎭');

            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(roleButton);

            // パネルを投稿
            await (targetChannel as any).send({
                embeds: [embed],
                components: [row]
            });

            let warningText = '';
            if (missingRoles.length > 0) {
                warningText = `\n\n⚠️ 以下のロールはスキップされました: ${missingRoles.join(', ')}`;
            }

            await interaction.editReply({
                content: `✅ ロールパネル「${preset.name}」を ${targetChannel} に投稿しました！${warningText}`
            });

        } catch (error) {
            await interaction.editReply({
                content: `❌ エラー: ${error instanceof Error ? error.message : '不明'}`
            });
        }
    }
};

registerModalHandler('rolepanel_auth_code_modal', async (interaction) => {
    await rolePanelSubcommand.handleCodeModalSubmit(interaction);
});
registerModalHandler('rolepanel_auth_math_modal', async (interaction) => {
    await rolePanelSubcommand.handleMathModalSubmit(interaction);
});

export default rolePanelSubcommand;
