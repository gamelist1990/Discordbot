# Staff Help Web Page

## 概要

スタッフコマンドのヘルプ情報をWebページで表示する機能です。Discord内でコマンドを使用する際に、より見やすく詳細な情報を提供します。

## 機能

### 1. 自動コマンド抽出
- `/staff` コマンドのサブコマンド情報を自動的に抽出
- SlashCommandBuilder から名前、説明、オプションを読み取り
- リアルタイムでコマンド追加に対応

### 2. Google Material Design スタイル
- クリーンで直感的なUI
- カード形式でコマンドを表示
- レスポンシブデザイン対応

### 3. タブ形式のナビゲーション
- **コマンドヘルプ**: 全コマンドの詳細情報
- **サービス**: スタッフ専用サービスへのリンク

### 4. サイドバーナビゲーション
- クイックリンクでコマンドに素早くアクセス
- スムーズスクロール対応

## 使用方法

### Discord内から

1. `/staff help` コマンドを実行
2. 表示されるWebページリンクをクリック
3. ブラウザでヘルプページが開きます

### 直接アクセス

```
http://localhost:3000/staff/help/{token}
```

**注意**: トークンは30分間有効で、セキュリティのため他人と共有しないでください。

## 技術仕様

### バックエンド

#### API エンドポイント

```typescript
GET /api/staff/commands/:token
```

**レスポンス例:**
```json
{
  "name": "staff",
  "description": "スタッフ向けの管理機能",
  "subcommands": [
    {
      "name": "clear",
      "description": "チャンネルのメッセージを削除します",
      "options": [
        {
          "name": "count",
          "description": "削除するメッセージ数（1〜100）",
          "type": "INTEGER",
          "required": true,
          "choices": []
        }
      ]
    }
  ]
}
```

#### コントローラー

`StaffController.getStaffCommands()` メソッドが以下を実行:
1. セッショントークンを検証
2. BotClient からスタッフコマンドを取得
3. SlashCommandBuilder の JSON 表現を生成
4. オプション情報を整形して返却

### フロントエンド

#### コンポーネント構造

```
StaffHelp/
├── index.tsx           # メインコンポーネント
└── StaffHelpPage.module.css  # スタイル
```

#### 主要機能

- **自動カード生成**: コマンドデータから自動的にUIカードを生成
- **タイプアイコン**: オプションタイプ（STRING、INTEGER等）を視覚的に表示
- **使用例生成**: 必須オプションから自動的に使用例を作成

## カスタマイズ

### 新しいサービスを追加

`index.tsx` の `servicesContent` セクションに新しいカードを追加:

```tsx
<div className={styles.serviceCard}>
    <div className={styles.serviceIcon}>🎯</div>
    <h3 className={styles.serviceTitle}>新しいサービス</h3>
    <p className={styles.serviceDescription}>
        サービスの説明
    </p>
    <button
        className={styles.serviceButton}
        onClick={() => navigate(`/staff/service/${token}`)}
    >
        開く
    </button>
</div>
```

### スタイルのカスタマイズ

`StaffHelpPage.module.css` でカラーやレイアウトを変更可能:

```css
/* プライマリカラーの変更 */
.header {
    background: linear-gradient(135deg, #YOUR_COLOR_1 0%, #YOUR_COLOR_2 100%);
}
```

## セキュリティ

- セッショントークンによるアクセス制御
- 30分のトークン有効期限
- CSRF保護
- サーバー管理権限の確認

## 今後の拡張

- [ ] コマンド検索機能
- [ ] お気に入りコマンド登録
- [ ] コマンド使用統計の表示
- [ ] ダークモード対応
- [ ] 多言語対応

## トラブルシューティング

### トークンが無効です

- トークンの有効期限（30分）が切れている可能性があります
- 再度 `/staff help` コマンドを実行してください

### コマンドが表示されない

- Bot が正しく起動しているか確認してください
- コマンドが正しく登録されているか確認してください

### スタイルが適用されない

- Web クライアントをビルドしてください: `npm run web`
- ブラウザのキャッシュをクリアしてください
