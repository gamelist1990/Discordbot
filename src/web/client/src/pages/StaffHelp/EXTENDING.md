# Extending the Staff Help System

このドキュメントは、スタッフヘルプシステムを拡張し、新しいサービスやコマンドを追加する方法を説明します。

## 新しいスタッフコマンドの追加

### 1. サブコマンドファイルの作成

`src/commands/staff/subcommands/` に新しいファイルを作成:

```typescript
// src/commands/staff/subcommands/mycommand.ts
import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';

export default {
    name: 'mycommand',
    description: 'あなたの新しいコマンドの説明',

    builder: (subcommand: any) => {
        return subcommand
            .setName('mycommand')
            .setDescription('あなたの新しいコマンドの説明')
            .addStringOption((opt: any) =>
                opt.setName('option1')
                    .setDescription('オプション1の説明')
                    .setRequired(true)
            )
            .addIntegerOption((opt: any) =>
                opt.setName('option2')
                    .setDescription('オプション2の説明')
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(100)
            );
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        // コマンドロジックをここに実装
        const option1 = interaction.options.getString('option1', true);
        const option2 = interaction.options.getInteger('option2') ?? 10;

        await interaction.reply({
            content: `実行しました: ${option1}, ${option2}`,
            flags: MessageFlags.Ephemeral
        });
    }
};
```

### 2. 自動登録

ファイルを保存するだけで、Bot起動時に自動的に登録されます。
`CommandLoader` が `subcommands/` ディレクトリを自動スキャンします。

### 3. ヘルプページへの反映

Webヘルプページも自動的に更新されます：
- コマンド名、説明が表示されます
- オプション情報（名前、型、必須/任意、説明）が表示されます
- 使用例が自動生成されます

## 新しいスタッフサービスの追加

### 1. バックエンドコントローラーの作成/拡張

`StaffController.ts` に新しいメソッドを追加:

```typescript
/**
 * 新しいサービスのデータ取得
 */
async getMyService(req: Request, res: Response): Promise<void> {
    const session = (req as any).session as SettingsSession;

    try {
        if (!session.guildId) {
            res.status(400).json({ error: 'Invalid session: missing guild ID' });
            return;
        }

        // サービスロジックをここに実装
        const data = {
            // あなたのデータ
        };

        res.json(data);
    } catch (error) {
        console.error('サービスエラー:', error);
        res.status(500).json({ error: 'Failed to fetch service data' });
    }
}
```

### 2. ルートの追加

`src/web/routes/staff.ts` に新しいルートを追加:

```typescript
// 新しいサービスのエンドポイント
router.get('/myservice/:token', auth.validateToken, controller.getMyService.bind(controller));
```

### 3. フロントエンドページの作成

#### ページコンポーネント

`src/web/client/src/pages/MyService/index.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { validateToken } from '../../services/api';
import AppHeader from '../../components/Common/AppHeader';
import styles from './MyService.module.css';

const MyServicePage: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);

    useEffect(() => {
        if (!token) return;

        const loadData = async () => {
            try {
                await validateToken(token);
                
                const response = await fetch(`/api/staff/myservice/${token}`);
                const result = await response.json();
                
                setData(result);
                setLoading(false);
            } catch (err) {
                console.error('Error:', err);
                setLoading(false);
            }
        };

        loadData();
    }, [token]);

    if (loading) {
        return <div>Loading...</div>;
    }

    return (
        <div>
            <AppHeader />
            <div className={styles.container}>
                <h1>My Service</h1>
                {/* あなたのUIをここに */}
            </div>
        </div>
    );
};

export default MyServicePage;
```

#### スタイル

`src/web/client/src/pages/MyService/MyService.module.css`:

```css
/* Google Material Design に合わせたスタイル */
.container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 24px;
}

/* 既存のStaffHelpPage.module.cssを参考にできます */
```

### 4. App.tsx にルートを追加

```tsx
import MyServicePage from './pages/MyService';

// Routes内に追加
<Route path="/staff/myservice/:token" element={<MyServicePage />} />
```

### 5. StaffHelpページにサービスカードを追加

`src/web/client/src/pages/StaffHelp/index.tsx` の `servicesContent` セクション:

```tsx
<div className={styles.serviceCard}>
    <div className={styles.serviceIcon}>🎯</div>
    <h3 className={styles.serviceTitle}>My Service</h3>
    <p className={styles.serviceDescription}>
        あなたのサービスの説明
    </p>
    <button
        className={styles.serviceButton}
        onClick={() => navigate(`/staff/myservice/${token}`)}
    >
        開く
    </button>
</div>
```

## API サービスの拡張

新しいAPIエンドポイントを使いやすくするため、`api.ts` に関数を追加:

```typescript
// src/web/client/src/services/api.ts

/**
 * My Service のデータ型
 */
export interface MyServiceData {
    // データの型定義
}

/**
 * My Service データの取得
 */
export async function fetchMyService(token: string): Promise<MyServiceData> {
    return apiRequest<MyServiceData>(`${API_BASE}/staff/myservice/${token}`);
}
```

## Discord コマンドとWebサービスの連携

### パターン1: Webページへのリンクを提供

```typescript
// サブコマンド内で
const settingsServer = (interaction.client as any).settingsServer;
const token = settingsServer.createSession(interaction.guildId, interaction.user.id);
const serviceUrl = `http://localhost:3000/staff/myservice/${token}`;

await interaction.reply({
    content: `Webページで操作できます:\n${serviceUrl}`,
    flags: MessageFlags.Ephemeral
});
```

### パターン2: Discord内で完結 + Web参照オプション

```typescript
// Discord内での基本操作を提供しつつ、
// 詳細な管理はWebで行えるようにする

await interaction.reply({
    content: '操作を実行しました。\n詳細はWebページで確認できます: ...',
    flags: MessageFlags.Ephemeral
});
```

## セキュリティ考慮事項

### 1. 権限チェック

```typescript
// 必ずサーバー管理権限をチェック
if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
        content: '❌ このコマンドにはサーバー管理権限が必要です',
        flags: MessageFlags.Ephemeral
    });
    return;
}
```

### 2. トークン検証

全てのAPIエンドポイントで `auth.validateToken` ミドルウェアを使用:

```typescript
router.get('/myservice/:token', auth.validateToken, controller.getMyService.bind(controller));
```

### 3. セッション有効期限

デフォルトは30分。必要に応じて調整可能:

```typescript
// SettingsServer.ts で設定変更可能
const TOKEN_EXPIRY = 30 * 60 * 1000; // 30分
```

## スタイルガイド

### Google Material Design原則

1. **カード**: 白背景、subtle shadow、hover効果
2. **ボタン**: グラデーション、丸みのある角、shadow
3. **タイポグラフィ**: 明確な階層、適切なサイズ
4. **色**: 一貫したパープルテーマ
5. **アニメーション**: smooth transitions (0.3s)

### カラーパレット

```css
/* プライマリ */
--primary-start: #667eea;
--primary-end: #764ba2;

/* テキスト */
--text-primary: #37474f;
--text-secondary: #5f6368;

/* 背景 */
--bg-card: #ffffff;
--bg-hover: rgba(103, 126, 234, 0.08);

/* アクセント */
--accent-error: #ea4335;
--accent-success: #34a853;
```

## テストのベストプラクティス

1. **トークン有効性**: 有効/無効/期限切れトークンをテスト
2. **権限チェック**: 権限あり/なしユーザーでテスト
3. **エラーハンドリング**: 各エラーケースを確認
4. **レスポンシブ**: 複数のスクリーンサイズでテスト
5. **アクセシビリティ**: キーボードナビゲーション、スクリーンリーダー

## デプロイ前チェックリスト

- [ ] TypeScript エラーなし
- [ ] ESLint 警告なし
- [ ] 全API エンドポイントが正常に動作
- [ ] トークン検証が機能
- [ ] 権限チェックが機能
- [ ] エラーハンドリングが適切
- [ ] レスポンシブデザインが動作
- [ ] ドキュメントが更新されている
- [ ] README にサービスが記載されている

## 例: 簡単なサービスの完全実装

完全な例として「サーバー統計」サービスを実装する場合:

### 1. コマンド
```typescript
// src/commands/staff/subcommands/stats.ts
export default {
    name: 'stats',
    description: 'サーバー統計をWebで表示',
    builder: (subcommand: any) => subcommand.setName('stats').setDescription('サーバー統計をWebで表示'),
    async execute(interaction: ChatInputCommandInteraction) {
        const token = /* トークン生成 */;
        await interaction.reply({ content: `統計ページ: http://localhost:3000/staff/stats/${token}`, flags: MessageFlags.Ephemeral });
    }
};
```

### 2. コントローラー
```typescript
// StaffController.ts に追加
async getStats(req: Request, res: Response) {
    const guild = this.botClient.client.guilds.cache.get(session.guildId);
    res.json({
        memberCount: guild.memberCount,
        channelCount: guild.channels.cache.size,
        roleCount: guild.roles.cache.size
    });
}
```

### 3. ルート
```typescript
// staff.ts に追加
router.get('/stats/:token', auth.validateToken, controller.getStats.bind(controller));
```

### 4. フロントエンド
```tsx
// pages/StaffStats/index.tsx
// 統計を表示するコンポーネント
```

### 5. リンク追加
```tsx
// StaffHelp の Services タブに追加
<div className={styles.serviceCard}>
    <div className={styles.serviceIcon}>📊</div>
    <h3>サーバー統計</h3>
    <p>サーバーの詳細な統計情報</p>
    <button onClick={() => navigate(`/staff/stats/${token}`)}>開く</button>
</div>
```

これで完全に統合されたサービスが完成します！
