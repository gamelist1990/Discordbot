# ランキングシステム (Ranking System)

## 概要 (Overview)

このボットに実装されたランキングシステムは、ギルド内のユーザーアクティビティに基づいてXP（経験値）を付与し、ランク付けを行うシステムです。

The ranking system tracks user activity in guilds and awards XP (experience points) based on messages and voice chat participation.

## 主な機能 (Key Features)

### XP獲得方法 (XP Earning Methods)

1. **テキストメッセージ** - メッセージを送信するとXPを獲得
   - デフォルト: メッセージごとに5 XP
   - クールダウン: 60秒（スパム防止）

2. **ボイスチャット** - VCに接続している間、時間に応じてXPを獲得
   - デフォルト: 1分ごとに10 XP
   - 参加・退出時に自動計算

### ランクシステム (Rank System)

- **複数のプリセット** - ギルドごとにランクプリセットを作成・管理可能
- **カスタマイズ可能なランク帯** - 各ランクにXP範囲、色、アイコンを設定
- **報酬システム** - ランクアップ時にロール付与や通知を自動実行
- **ランクパネル** - リアルタイム更新されるリーダーボードを表示

### 設定機能 (Settings)

- **XPレート調整** - メッセージとVCのXP獲得量を設定
- **日次制限** - 1日あたりの最大XP獲得量を設定（オプション）
- **除外設定** - 特定のチャンネルやロールをXP付与対象外に設定
- **グローバル倍率** - イベント時などにXP倍率を一時変更

## コマンド (Commands)

### ユーザーコマンド (User Commands)

#### `/rank [user]`
自分または指定したユーザーのランク情報を表示します。

**表示内容:**
- 現在のランク
- 現在のXP
- サーバー内順位
- 次のランクまでの必要XP
- 進捗バー
- 本日の獲得XP（日次制限がある場合）

**使用例:**
```
/rank
/rank user:@UserName
```

### スタッフコマンド (Staff Commands)

#### `staff rank`
ランキングシステムの管理コマンド（サーバー管理権限が必要）

**利用可能なアクション:**

1. **プリセット一覧** (`list-presets`)
2. **プリセット作成** (`create-preset`)
3. **プリセット削除** (`delete-preset`)
4. **パネル作成** (`create-panel`)
5. **パネル削除** (`delete-panel`)
6. **通知チャンネル設定** (`set-notify-channel`)
7. **更新間隔設定** (`set-update-interval`)
8. **XP付与** (`add-xp`)
9. **XP設定** (`set-xp`)
10. **ランキング表示** (`show-ranking`)

**使用例:**
```
/staff rank action:create-preset preset:VIP
/staff rank action:create-panel preset:default channel:#ranking
/staff rank action:add-xp user:@UserName value:100
```

## Web API

### エンドポイント (Endpoints)

**プリセット管理:**
- `GET /api/staff/rankmanager/presets?guildId=<id>`
- `POST /api/staff/rankmanager/presets`
- `PUT /api/staff/rankmanager/presets/:name`
- `DELETE /api/staff/rankmanager/presets/:name`

**パネル管理:**
- `GET /api/staff/rankmanager/panels?guildId=<id>`
- `DELETE /api/staff/rankmanager/panels/:id`

**設定:**
- `GET /api/staff/rankmanager/settings?guildId=<id>`
- `PUT /api/staff/rankmanager/settings`

**リーダーボード:**
- `GET /api/staff/rankmanager/leaderboard?guildId=<id>&limit=10`

**XP操作:**
- `POST /api/staff/rankmanager/xp/add`

## データ構造 (Data Structure)

### 保存場所
```
Data/Guild/<guildId>/rankings.json
```

### データ形式の例

```json
{
  "rankPresets": [
    {
      "name": "default",
      "description": "デフォルトランクプリセット",
      "ranks": [
        { "name": "Bronze", "minXp": 0, "maxXp": 999, "color": "#CD7F32" },
        { "name": "Silver", "minXp": 1000, "maxXp": 4999, "color": "#C0C0C0" }
      ],
      "rewards": [
        { "rankName": "Silver", "giveRoleId": "...", "notify": true }
      ]
    }
  ],
  "users": {
    "123456789012345678": {
      "xp": 2345,
      "lastUpdated": "2025-10-16T00:00:00.000Z",
      "dailyXp": 500
    }
  },
  "panels": {
    "panel-1": {
      "channelId": "...",
      "messageId": "...",
      "preset": "default"
    }
  },
  "settings": {
    "notifyChannelId": "...",
    "updateIntervalMs": 300000,
    "xpRates": {
      "messageXp": 5,
      "messageCooldownSec": 60,
      "vcXpPerMinute": 10,
      "dailyXpCap": 0
    }
  }
}
```

## 開発情報 (Development)

### コアファイル
- `src/core/RankManager.ts` - メインロジック
- `src/commands/any/rank.ts` - ユーザーコマンド
- `src/commands/staff/subcommands/rank.ts` - スタッフコマンド
- `src/web/controllers/RankController.ts` - Web API
- `src/web/routes/rank.ts` - ルート定義

### テスト
```bash
node test/validate-rank-system.cjs
```

## 今後の拡張 (Future Extensions)

- [ ] Web UI フロントエンド
- [ ] 外部API（サードパーティ連携）
- [ ] APIキーシステム
- [ ] カスタムXP計算式
- [ ] XP減衰システム
- [ ] 監査ログ

## ライセンス

MIT License
