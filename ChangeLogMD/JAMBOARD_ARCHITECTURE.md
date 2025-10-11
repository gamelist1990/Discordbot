# Jamboard アーキテクチャ図

## システム構成

```
┌─────────────────────────────────────────────────────────────────┐
│                         Discord Server                           │
│                                                                   │
│  ┌──────────────────┐                                           │
│  │  /staff jam      │  ←─ ユーザーがコマンドを実行              │
│  │   コマンド       │                                            │
│  └────────┬─────────┘                                           │
│           │                                                       │
└───────────┼───────────────────────────────────────────────────────┘
            │
            │ 1. セッショントークン生成
            │ 2. Jamboard URL送信
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Discord Bot Server                          │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Staff Command Handler                        │  │
│  │            (src/commands/staff/subcommands/jam.ts)       │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                            │                                     │
│  ┌─────────────────────────┴─────────────────────────────────┐ │
│  │              Session Manager                               │ │
│  │         (セッショントークンを保存)                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
            │
            │ 3. ブラウザでURLを開く
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Web Browser                                 │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         Jamboard React App                                │  │
│  │    (src/web/client/src/pages/Jamboard)                   │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌─────────────┐                       │  │
│  │  │ Whiteboard  │  │  Todo List  │                       │  │
│  │  │   Canvas    │  │             │                       │  │
│  │  └─────────────┘  └─────────────┘                       │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                            │                                     │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             │ 4. API リクエスト
                             │ 5. SSE 接続
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Web API Server                                │
│                  (src/web/SettingsServer.ts)                    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Authentication Middleware                    │  │
│  │           (src/web/middleware/auth.ts)                   │  │
│  │              ・セッション検証                             │  │
│  │              ・権限チェック                               │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                            │                                     │
│  ┌─────────────────────────┴─────────────────────────────────┐ │
│  │           Jamboard Controller                              │ │
│  │      (src/web/controllers/JamboardController.ts)          │ │
│  │                                                            │ │
│  │  ・getJamboards()      ・addStroke()                     │ │
│  │  ・getContent()        ・addTodo()                       │ │
│  │  ・streamUpdates()     ・updateTodo()                    │ │
│  └────────────────────────┬─────────────────────────────────┘ │
│                            │                                     │
│  ┌─────────────────────────┴─────────────────────────────────┐ │
│  │          Jamboard Manager                                  │ │
│  │       (src/core/JamboardManager.ts)                       │ │
│  │                                                            │ │
│  │  ・createPersonalJamboard()                               │ │
│  │  ・getOrCreateStaffJamboard()                            │ │
│  │  ・canAccess()                                            │ │
│  │  ・addMember() / removeMember()                          │ │
│  └────────────────────────┬─────────────────────────────────┘ │
│                            │                                     │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             │ 6. データ永続化
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      JSON Database                               │
│                    (src/database.ts)                            │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  jamboards.json                                           │  │
│  │  ├─ guild_123                                             │  │
│  │  │   ├─ staff_guild_123 (スタッフJamboard)              │  │
│  │  │   └─ abc123xyz (個人Jamboard)                        │  │
│  │  └─ guild_456                                             │  │
│  │      └─ staff_guild_456                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  jamboard_contents.json                                   │  │
│  │  ├─ guild_123                                             │  │
│  │  │   ├─ staff_guild_123                                  │  │
│  │  │   │   ├─ whiteboard: { strokes: [...] }              │  │
│  │  │   │   └─ todos: [...]                                 │  │
│  │  │   └─ abc123xyz                                        │  │
│  │  │       ├─ whiteboard: { strokes: [...] }              │  │
│  │  │       └─ todos: [...]                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## データフロー

### 1. Jamboard へのアクセス

```
User → Discord → /staff jam → Bot generates URL → Browser opens URL
                                                    ↓
                                          Session validation
                                                    ↓
                                          Load Jamboard page
```

### 2. ホワイトボードへの描画

```
User draws on canvas → Create stroke object → POST /api/jamboards/:token/:id/strokes
                                                      ↓
                                              Validate session
                                                      ↓
                                              Save to database
                                                      ↓
                                           Broadcast via SSE ← Other users receive update
```

### 3. Todo の追加

```
User adds todo → POST /api/jamboards/:token/:id/todos
                         ↓
                 Validate session
                         ↓
                 Save to database
                         ↓
              Broadcast via SSE ← Other users receive update
```

### 4. リアルタイム同期 (SSE)

```
Browser connects → GET /api/jamboards/:token/:id/stream (SSE)
                              ↓
                    Keep connection open
                              ↓
                    Periodic updates (10s)
                              ↓
                    Send data: JSON events
                              ↓
                    Browser receives ← Update UI
```

## 権限管理

```
┌──────────────────────┐
│  Request comes in    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Validate session     │ ← Check token exists & not expired
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Get Jamboard info    │
└──────────┬───────────┘
           │
           ▼
     ┌─────────────┐
     │ Is Staff    │
     │ Jamboard?   │
     └─────┬───────┘
           │
    ┌──────┴──────┐
    │             │
   Yes           No
    │             │
    ▼             ▼
┌─────────┐  ┌──────────┐
│ Check   │  │ Check    │
│ staff   │  │ member   │
│ status  │  │ list     │
└────┬────┘  └────┬─────┘
     │            │
     │            │
     └──────┬─────┘
            │
            ▼
     ┌──────────────┐
     │ Access       │
     │ Granted /    │
     │ Denied       │
     └──────────────┘
```

## モジュール依存関係

```
commands/staff/subcommands/jam.ts
    └─→ web/SettingsServer (セッション管理)

web/routes/jamboard.ts
    └─→ web/controllers/JamboardController.ts
            └─→ core/JamboardManager.ts
                    └─→ database.ts (JsonDB)

web/client/pages/Jamboard/
    └─→ API calls via fetch()
            └─→ web/routes/jamboard.ts
```
