/**
 * プレースホルダー情報とユーティリティ
 */

export interface Placeholder {
    name: string;
    description: string;
    example: string;
}

export const PLACEHOLDERS: Placeholder[] = [
    {
        name: '{author.id}',
        description: 'メッセージ作成者のユーザーID',
        example: '123456789012345678'
    },
    {
        name: '{author.mention}',
        description: 'メッセージ作成者へのメンション (@ユーザー名)',
        example: '@user'
    },
    {
        name: '{author.name}',
        description: 'メッセージ作成者のユーザー名',
        example: 'username'
    },
    {
        name: '{author.displayName}',
        description: 'メッセージ作成者の表示名（ニックネーム or ユーザー名）',
        example: 'Display Name'
    },
    {
        name: '{channel.id}',
        description: 'チャンネルID',
        example: '987654321098765432'
    },
    {
        name: '{channel.name}',
        description: 'チャンネル名',
        example: 'general'
    },
    {
        name: '{channel.mention}',
        description: 'チャンネルへのメンション (#チャンネル名)',
        example: '#channel'
    },
    {
        name: '{guild.id}',
        description: 'サーバー（ギルド）ID',
        example: '111111111111111111'
    },
    {
        name: '{guild.name}',
        description: 'サーバー（ギルド）名',
        example: 'My Server'
    },
    {
        name: '{guild.memberCount}',
        description: 'サーバーのメンバー数',
        example: '150'
    },
    {
        name: '{message.id}',
        description: 'メッセージID',
        example: '555555555555555555'
    },
    {
        name: '{message.content}',
        description: 'メッセージの内容',
        example: 'Hello world!'
    },
    {
        name: '{timestamp}',
        description: '現在の日時（ISO形式）',
        example: '2025-10-17T12:34:56Z'
    },
    {
        name: '{timestamp.unix}',
        description: 'Unixタイムスタンプ（秒）',
        example: '1729171496'
    }
];

export const EMOJI_PICKER_EMOJIS = [
    // スマイリー
    '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊',
    '😇', '🙂', '🙃', '😌', '😍', '🥰', '😘', '😗', '😚', '😙',
    '😋', '😛', '😜', '🤪', '😝', '😑', '😐', '😶', '😏', '😒',
    
    // 手
    '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞',
    '🫰', '🤟', '🤘', '🤙', '👍', '👎', '✊', '👊', '🤛', '🤜',
    
    // ハート
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
    
    // その他よく使うもの
    '⭐', '✨', '🔥', '💯', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇',
    '🍕', '🍔', '🍟', '🌮', '🍜', '🍱', '☕', '🍺', '🍷', '🍾',
    '⚽', '🏀', '🎮', '🎯', '🎲', '🎸', '🎹', '🎤', '🎧', '📱'
];
