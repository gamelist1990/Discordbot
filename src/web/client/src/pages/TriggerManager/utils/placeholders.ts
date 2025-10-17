/**
 * プレースホルダー情報とユーティリティ
 */

export interface Placeholder {
    name: string;
    description: string;
    example: string;
}

export const PLACEHOLDERS: Placeholder[] = [
    // ユーザー関連
    {
        name: '{user.id}',
        description: 'メッセージ作成者のユーザーID',
        example: '123456789012345678'
    },
    {
        name: '{user.name}',
        description: 'メッセージ作成者のユーザー名',
        example: 'username'
    },
    {
        name: '{user.tag}',
        description: 'メッセージ作成者のユーザー名#タグ',
        example: 'username#1234'
    },
    {
        name: '{user.createdAt}',
        description: 'メッセージ作成者のアカウント作成日時',
        example: '2020-01-01T00:00:00.000Z'
    },
    {
        name: '{author}',
        description: 'メッセージ作成者のユーザー名（{user.name} と同じ）',
        example: 'username'
    },
    {
        name: '{author.id}',
        description: 'メッセージ作成者のユーザーID',
        example: '123456789012345678'
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
        name: '{author.mention}',
        description: 'メッセージ作成者へのメンション (@ユーザー名)',
        example: '@username'
    },
    {
        name: '{author.tag}',
        description: 'メッセージ作成者のユーザー名#タグ',
        example: 'username#1234'
    },
    
    // ギルド関連
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
    
    // チャンネル関連
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
        name: '{channel.topic}',
        description: 'チャンネルトピック',
        example: 'Welcome to our server!'
    },
    {
        name: '{channel.mention}',
        description: 'チャンネルへのメンション (#チャンネル名)',
        example: '#general'
    },
    
    // メッセージ関連
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
        name: '{message.length}',
        description: 'メッセージの文字数',
        example: '12'
    },
    {
        name: '{message.words}',
        description: 'メッセージの単語数',
        example: '2'
    },
    
    // 添付ファイル関連
    {
        name: '{attachments.count}',
        description: '添付ファイルの数',
        example: '1'
    },
    
    // その他
    {
        name: '{mention}',
        description: 'メッセージ内のメンション（未使用）',
        example: '@user'
    },
    {
        name: '{time}',
        description: '現在の日時（ISO形式、{timestamp} と同じ）',
        example: '2025-10-17T12:34:56Z'
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
    },
    {
        name: '{date.now}',
        description: '現在の日時（ISO形式、{timestamp} と同じ）',
        example: '2025-10-17T12:34:56Z'
    },
    
    // ボイス関連
    {
        name: '{voice.channel}',
        description: 'ユーザーが参加中のボイスチャンネル名',
        example: 'General Voice'
    },
    {
        name: '{voice.channel.id}',
        description: 'ユーザーが参加中のボイスチャンネルID',
        example: '876543210987654321'
    },
    
    // プレゼンス関連
    {
        name: '{presence.status}',
        description: 'ユーザーのオンラインステータス',
        example: 'online'
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
