import { globalPreviewRegistry } from './PreviewRegistry.js';

// Use the packaged site icon as default image for previews
const SITE_ICON_PATH = '/assets/icon.png';

// Home page
globalPreviewRegistry.register(/^\/$|^\/index(\.html)?$/i, async (path) => {
    return {
        title: 'Home',
        description: 'このサイトへようこそ。管理ダッシュボード、サーバー運用、ランキング管理などの操作をブラウザから行えます。',
        image: SITE_ICON_PATH,
        url: path,
        type: 'website'
    };
});

// NotFound (404) - generic fallback
globalPreviewRegistry.register(/^\/404$|^\/notfound$/i, async (path) => {
    return {
        title: 'ページが見つかりません',
        description: '申し訳ありません。指定されたページは存在しないか、移動された可能性があります。トップページから目的の機能へアクセスしてください。',
        image: SITE_ICON_PATH,
        url: path,
        type: 'website'
    };
});

