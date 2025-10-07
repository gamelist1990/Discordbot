# Discord OAuth2 Setup Guide

## 環境変数の設定

Discord OAuth2認証を使用するために、以下の環境変数を設定する必要があります。

### 必須の環境変数

```bash
# Discord Bot Token（既に設定済みの場合は不要）
DISCORD_BOT_TOKEN=your_bot_token_here

# Discord OAuth2 Client Secret
DISCORD_CLIENT_SECRET=your_client_secret_here

# ベースURL（本番環境では実際のドメインに変更）
BASE_URL=http://localhost:3000

# Node環境（本番環境では production に設定）
NODE_ENV=development
```

### Discord Developer Portalでの設定

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. あなたのアプリケーションを選択
3. 左サイドバーの「OAuth2」をクリック
4. 「Client Secret」をコピーして `DISCORD_CLIENT_SECRET` 環境変数に設定
5. 「Redirects」セクションで以下のURLを追加:
   - 開発環境: `http://localhost:3000/api/auth/callback`
   - 本番環境: `https://yourdomain.com/api/auth/callback`
6. 「OAuth2 URL Generator」で以下のスコープを選択:
   - `identify` - ユーザー情報の取得
   - `guilds` - ギルド情報の取得

### 環境変数の設定方法

#### 方法1: .env ファイル（推奨）

プロジェクトルートに `.env` ファイルを作成:

```bash
DISCORD_CLIENT_SECRET=your_client_secret_here
BASE_URL=http://localhost:3000
NODE_ENV=development
```

参考: `env.example` ファイルをコピーして使用できます
```bash
cp env.example .env
```

**注意**: `.env` ファイルは `.gitignore` に追加して、Gitにコミットしないでください！

#### 方法2: 環境変数を直接設定

```bash
# Linux/Mac
export DISCORD_CLIENT_SECRET="your_client_secret_here"
export BASE_URL="http://localhost:3000"

# Windows (PowerShell)
$env:DISCORD_CLIENT_SECRET="your_client_secret_here"
$env:BASE_URL="http://localhost:3000"

# Windows (CMD)
set DISCORD_CLIENT_SECRET=your_client_secret_here
set BASE_URL=http://localhost:3000
```

## OAuth2フロー

1. ユーザーが `/jamboard` にアクセス
2. ログインページが表示される
3. 「Discord でログイン」ボタンをクリック
4. Discord の認証ページにリダイレクト
5. ユーザーが認証を承認
6. `/api/auth/callback` にリダイレクト
7. セッションが作成され、元のページにリダイレクト
8. ユーザーはログイン済み状態になる

## セキュリティについて

- セッションは24時間有効
- `DISCORD_CLIENT_SECRET` は絶対に公開しないでください
- 本番環境では HTTPS を使用してください
- `NODE_ENV=production` の場合、クッキーに `Secure` フラグが設定されます

## トラブルシューティング

### "Server configuration error" エラー

- `DISCORD_CLIENT_SECRET` 環境変数が設定されていません
- 環境変数を確認してください

### "Invalid or expired state" エラー

- OAuth2フローの途中でタイムアウトが発生しました
- もう一度ログインを試してください

### リダイレクトURIエラー

- Discord Developer Portalでリダイレクトが正しく設定されているか確認
- `BASE_URL` 環境変数が正しいか確認

## 開発中の注意事項

開発中は `DISCORD_CLIENT_SECRET` が設定されていない場合でも、簡易的なテストモードで動作するようにすることを推奨します。本番環境では必ず設定してください。
