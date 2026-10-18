import { EmbedBuilder } from 'discord.js';
import { PERSONALITY_ARCHETYPES } from './constants.js';
import { CoreFeaturePanelKind } from './types.js';

export function getCorePanelKindLabel(panelKind: CoreFeaturePanelKind): string {
    if (panelKind === 'personality') {
        return '性格診断';
    }
    if (panelKind === 'request') {
        return 'リクエスト';
    }
    if (panelKind === 'othello') {
        return 'オセロ';
    }
    if (panelKind !== 'combined') {
        return panelKind;
    }
    return '統合';
}

export function buildRegisteredCorePanelEmbed(
    panelKind: CoreFeaturePanelKind,
    spectatorRoleId: string | null,
    feature?: { label: string; description: string; emoji: string; color: number }
): EmbedBuilder {
    if (!feature || ['combined', 'personality', 'request'].includes(panelKind)) {
        return buildCorePanelEmbed(panelKind, spectatorRoleId);
    }

    return new EmbedBuilder()
        .setTitle(`${feature.emoji} ${feature.label}パネル`)
        .setColor(feature.color)
        .setDescription(feature.description)
        .setFooter({ text: 'CorePanel feature registry' })
        .setTimestamp();
}

export function buildCorePanelEmbed(panelKind: CoreFeaturePanelKind, _spectatorRoleId: string | null): EmbedBuilder {
    if (panelKind === 'personality') {
        return new EmbedBuilder()
            .setTitle('性格診断パネル')
            .setColor(0x4f8cff)
            .setDescription([
                'このパネルでは、AI 性格診断だけを個別に利用できます。',
                '',
                `AI と1対1で面談し、${Object.keys(PERSONALITY_ARCHETYPES).length}種類の性格ロールから1つを判定します。`,
                '判定結果には観測した傾向タグも付きます。',
                '判定後は専用ロールを付与し、再挑戦は1週間後です。'
            ].join('\n'))
            .setFooter({ text: '性格診断室は結果後または五分間無操作で自動整理されます。' })
            .setTimestamp();
    }


    if (panelKind === 'request') {
        const requestCategoryName = '作成カテゴリ名';
        return new EmbedBuilder()
            .setTitle(`${requestCategoryName}パネル`)
            .setColor(0x2f9e44)
            .setDescription([
                `${requestCategoryName}機能だけを個別に利用できます。`,
                '',
                '機能追加、改善案、バグ報告などを送信できます。',
                '送信後は専用スレッド（チャンネル）が作成され、進捗管理されます。'
            ].join('\n'))
            .setFooter({ text: 'Create by Koukunn' })
            .setTimestamp();
    }

    if (panelKind === 'othello') {
        return new EmbedBuilder()
            .setTitle('⚫ オセロパネル')
            .setColor(0x1b9b67)
            .setDescription([
                '番号付きの盤面画像を見ながら、Discord のボタンでオセロを遊べます。',
                '',
                '**Bot戦**',
                'Easy・Normal・Hard の3段階から難易度を選択できます。',
                '',
                '**ランクマッチ**',
                '人間同士でマッチングし、勝敗に応じてオセロレーティングが変動します。',
                '盤面画像の番号と操作ボタンの番号は対応しています。'
            ].join('\n'))
            .setFooter({ text: '投了・1時間無操作は負けとなります。終了後約5分で部屋を削除します。' })
            .setTimestamp();
    }

    return new EmbedBuilder()
        .setTitle('Core機能パネル')
        .setColor(0x5865f2)
        .setDescription([
            'このパネルでは、AI 性格診断・オセロ・リクエストをまとめて利用できます。',
            '',
            '**性格診断**',
            `AI と1対1で面談し、${Object.keys(PERSONALITY_ARCHETYPES).length}種類の性格ロールから1つを判定します。`,
            '判定結果には観測した傾向タグも付きます。',
            '判定後は専用ロールを付与し、再挑戦は1週間後です。',
            '',
            '**オセロ**',
            'Easy・Normal・Hard のBot戦と、人間同士のランクマッチを遊べます。',
            '番号付き盤面画像とボタンで、置く場所を分かりやすく操作できます。',
            '',
            '**リクエスト**',
            '機能追加、改善案、バグ報告などを送信できます。',
            '送信後は専用チャンネルが作成され、進捗管理されます。'
        ].join('\n'))
        .setFooter({ text: 'オセロは投了・時間切れでも勝敗を記録し、終了後の部屋を自動整理します。' })
        .setTimestamp();
}
