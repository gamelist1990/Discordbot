import { globalPreviewRegistry } from './PreviewRegistry.js';

// Use the packaged site icon as default image for previews
const SITE_ICON_PATH = '/assets/icon.png';

// Home page
globalPreviewRegistry.register(/^\/$|^\/index(\.html)?$/i, async (path) => {
    return {
        title: 'Home',
        description: 'このサイトへようこそ — 管理ダッシュボード、フィードバック、タスク管理などの操作をブラウザから行えます。最新の更新や重要なお知らせはここから確認してください。',
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

// Todo index (if site has /todo)
globalPreviewRegistry.register(/^\/todo$|^\/todo\/$/i, async (path) => {
    return {
        title: 'Todo',
        description: 'このページではサイトの作業予定（Todo）や優先タスクの一覧を確認できます。貢献や修正の予定を素早く把握するのに便利です。',
        image: SITE_ICON_PATH,
        url: path,
        type: 'website'
    };
});
