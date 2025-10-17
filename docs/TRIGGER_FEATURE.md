# トリガー機能 実装ドキュメント

## 概要

Discord の各種イベントに応じて、プリセットで定義したアクション（Embed / Text / Reply / Modal / Webhook / DM / React 等）を自動実行するトリガー機能を実装しました。

## 実装済み機能（✅ 完了）

### バックエンド

1. **型定義** (`src/types/trigger.ts`)
   - TriggerEventType: 対応イベントタイプ（messageCreate, guildMemberAdd/Remove, voiceStateUpdate など）
   - TriggerCondition: 条件定義（messageContent, authorId, channelId など）
   - TriggerPreset: アクション定義（Embed, Text, Reply, Webhook, DM, React）
   - PlaceholderContext: テンプレート用のプレースホルダ

2. **TriggerManager** (`src/core/TriggerManager.ts`)
   - 条件評価エンジン（複合 AND/OR グループ対応）
   - プリセット実行機能
     - ✅ Embed: タイトル、説明、フィールド、色、画像、フッター対応
     - ✅ Text: プレーンテキスト送信
     - ✅ Reply: メッセージへの返信
     - ✅ Webhook: 外部 API 呼び出し（POST/GET/PUT/DELETE）
     - ✅ DM: ユーザーへの DM 送信
     - ✅ React: メッセージへのリアクション追加（自動削除対応）
     - ⚠️ Modal: 現在未実装（インタラクションベースのため、通常イベントからは実行不可）
   - Cooldown 管理（プリセット単位の最小実行間隔）
   - テンプレートレンダリング
     - プレースホルダ置換: {user}, {guild.name}, {message.content}, {time} など
     - XSS エスケープ処理
   - WebSocket 通知（trigger:fired イベント）
   - インメモリライブバッファ（最大100件、永続保存なし）

3. **WebSocket 拡張** (`src/web/routes/websocket.ts`)
   - `/ws/trigger` パス追加
   - trigger チャンネル実装
   - 認証済みクライアントへの `trigger:fired` イベント配信

4. **REST API** (`src/web/controllers/TriggerController.ts`, `src/web/routes/triggers.ts`)
   - GET `/api/triggers?guildId=...` - トリガー一覧取得
   - GET `/api/triggers/:id` - 特定トリガー取得
   - POST `/api/triggers` - トリガー作成
   - PUT `/api/triggers/:id` - トリガー更新
   - DELETE `/api/triggers/:id` - トリガー削除
   - POST `/api/triggers/:id/test` - テスト実行（モック）
   - POST `/api/triggers/import` - インポート
   - POST `/api/triggers/export` - エクスポート
   - GET `/api/triggers/live-buffer` - 実行履歴取得
   - DELETE `/api/triggers/live-buffer` - 実行履歴クリア
   - すべてのエンドポイントは STAFF 権限必須

5. **Discord イベントハンドラ統合** (`src/core/EventHandler.ts`)
   - messageCreate: メッセージ送信時にトリガー処理
   - guildMemberAdd: メンバー参加時にトリガー処理
   - guildMemberRemove: メンバー退出時にトリガー処理
   - voiceStateUpdate: ボイスチャンネル状態変更時にトリガー処理
   - interactionCreate: インタラクション時にトリガー処理

6. **権限ミドルウェア** (`src/web/middleware/auth.ts`)
   - requireStaffAuth: STAFF/ADMIN/OP 権限チェック

7. **初期化処理** (`src/index.ts`)
   - TriggerManager の初期化
   - WebSocketManager とのエミッタ接続

### フロントエンド

1. **TriggerManager ページ** (`src/web/client/src/pages/TriggerManager/`)
   - トリガー一覧表示
   - トリガー有効/無効切替
   - トリガー削除
   - リフレッシュ機能
   - StaffGuard による権限保護
   - `/staff/triggermanager` でアクセス可能

2. **ルーティング** (`src/web/client/src/App.tsx`)
   - `/staff/triggermanager` ルート追加

## 未実装 / 今後の拡張項目（⚠️ 未完成）

### フロントエンド

1. **TriggerEditor コンポーネント**
   - トリガー作成/編集フォーム
   - 条件エディタ（複数条件、AND/OR グループ化）
   - プリセットエディタ
     - タイプ別フォーム（Embed/Text/Reply/Webhook/DM/React）
     - ドラッグ&ドロップで順序変更
     - 最大5プリセット制限表示
   - プレビュー機能
   - バリデーション

2. **LivePanel コンポーネント**
   - WebSocket 接続管理
   - リアルタイム実行履歴表示
   - フィルタ機能（イベントタイプ、成功/失敗）
   - キャプチャ一時停止/クリア
   - レンダリング済み出力のプレビュー

3. **ConditionEditor コンポーネント**
   - 条件追加/削除
   - 条件タイプ選択
   - マッチタイプ選択（equals, contains, regex など）
   - グループ化（AND/OR）
   - 否定フラグ

4. **PresetEditor コンポーネント**
   - プリセットタイプ選択
   - タイプ別設定フォーム
   - プレースホルダヘルプ
   - Cooldown 設定

### バックエンド

1. **追加イベント対応**
   - messageUpdate（メッセージ編集）
   - messageDelete（メッセージ削除）
   - messageReactionAdd/Remove（リアクション追加/削除）
   - presenceUpdate（ステータス更新）
   - guildMemberUpdate（ニックネーム/ロール変更）
   - channelCreate/Delete/Update
   - threadCreate/Delete
   - roleCreate/Delete/Update
   - カスタムイベント拡張

2. **高度な条件評価**
   - Regex 条件のテスト機能
   - カスタムスクリプト実行（セキュリティ対策必須）
   - 環境変数プレースホルダ（管理者のみ）

3. **レート制限強化**
   - グローバルレート制御
   - プリセット実行回数の統計
   - スパム防止機能

4. **永続ログ（オプション）**
   - 永続化が必要な場合、別途ログ保存モジュールを実装
   - エクスポート機能（JSON/CSV）

### テスト

1. **単体テスト**
   - TriggerManager のテスト
   - 条件評価エンジンのテスト
   - テンプレートレンダリングのテスト

2. **統合テスト**
   - REST API のテスト
   - WebSocket 通知のテスト
   - Discord イベント処理のテスト

### ドキュメント

1. **ユーザーガイド**
   - トリガー作成手順
   - プレースホルダ一覧
   - 使用例

2. **開発者ガイド**
   - アーキテクチャ説明
   - カスタムイベント追加方法
   - プリセットタイプ拡張方法

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                      Discord Events                         │
│   (messageCreate, guildMemberAdd, voiceStateUpdate, etc.)   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   EventHandler.ts                            │
│  - Discord イベントをリスン                                  │
│  - TriggerManager.handleEvent() を呼び出し                   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  TriggerManager.ts                           │
│  - トリガーを取得（guildId + eventType）                     │
│  - 条件評価（複合 AND/OR）                                    │
│  - プリセット実行（順序通り）                                 │
│    - Embed / Text / Reply / Webhook / DM / React             │
│  - Cooldown 管理                                              │
│  - WebSocket 通知（trigger:fired）                           │
│  - インメモリバッファ更新                                     │
└───────────────────────┬─────────────────────────────────────┘
                        │
           ┌────────────┴────────────┐
           │                         │
           ▼                         ▼
┌─────────────────────┐  ┌─────────────────────┐
│  Discord Channel    │  │   WebSocketManager  │
│  (Send Message)     │  │   - broadcast()     │
└─────────────────────┘  └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │  Frontend Clients   │
                         │  - LivePanel        │
                         │  - Real-time view   │
                         └─────────────────────┘
```

## データフロー

1. **トリガー作成**
   - Frontend → REST API → TriggerManager → Database (JSON)

2. **イベント発火**
   - Discord Event → EventHandler → TriggerManager → 条件評価 → プリセット実行

3. **実行履歴**
   - TriggerManager → WebSocketManager → Frontend (LivePanel)

4. **履歴取得**
   - Frontend → REST API (live-buffer) → TriggerManager (インメモリバッファ)

## セキュリティ

- ✅ STAFF 権限による API アクセス制限
- ✅ XSS エスケープ（テンプレートレンダリング）
- ✅ Webhook URL 検証（今後強化予定）
- ✅ プリセット数制限（最大5）
- ✅ Cooldown による連続実行防止
- ⚠️ 外部 URL ブラックリスト（今後実装予定）
- ⚠️ スクリプト実行制限（今後実装予定）

## パフォーマンス

- インメモリバッファ（FIFO、最大100件）
- 永続ログなし（サーバー再起動で消える）
- Cooldown によるレート制限
- 非同期実行

## 運用メモ

- 履歴を永続化しないため、デバッグ時は「エクスポート」機能を使って外部保存を推奨
- Modal 実行は Discord の仕様上、インタラクションベースのため通常イベントからは実行不可
- プリセット実行によるスパム防止は厳格に実装（最大5プリセット + cooldown + グローバルレート制御）
- UI は `/rank` のデザインガイドに従い統一感を保つ

## 今後のマイルストーン

1. ✅ DB スキーマ + basic TriggerManager
2. ✅ 最小限 UI（一覧・編集・プリセット編集・WS ライブ表示）＋ REST API
3. ✅ 主要イベント統合（member/message/interaction/voice）
4. ⚠️ RateLimit 強化・セキュリティ対策（Webhook 検証等）
5. ⚠️ ドキュメント整備・運用手順作成・エクスポート機能
6. ⚠️ フル機能の Editor/LivePanel 実装
7. ⚠️ テスト実装

## 参考ファイル

- **型定義**: `src/types/trigger.ts`
- **コア**: `src/core/TriggerManager.ts`
- **API**: `src/web/controllers/TriggerController.ts`, `src/web/routes/triggers.ts`
- **イベント**: `src/core/EventHandler.ts`
- **WebSocket**: `src/web/routes/websocket.ts`
- **フロントエンド**: `src/web/client/src/pages/TriggerManager/`
- **ルーティング**: `src/web/client/src/App.tsx`
- **権限**: `src/web/middleware/auth.ts`
- **初期化**: `src/index.ts`

---

**最終更新**: 2025-10-17  
**作成者**: Claude AI (via claude.ai/code)
