# トリガー機能の実装

説明:
- Web 管理画面: /staff/triggerManager で管理可能
- Discord の各種イベントに応じて、プリセットで定義したアクション(Embed / Text / Reply / Modal / Webhook / DM / React 等)を実行させる
- プリセットは最大5つまで（レート制限対策）
- イベントごとに複数プリセットを割り当て可能（UI上で順序/有効化切替）

対応イベント（包括的一覧、拡張可能）:
- guildMemberAdd (メンバー参加)
- guildMemberRemove (メンバー退出)
- messageCreate (メッセージ送信)
- messageUpdate (メッセージ編集)
- messageDelete (メッセージ削除)
- interactionCreate (モーダル/ボタン/セレクト等のインタラクション)
- messageReactionAdd / messageReactionRemove (リアクション追加/削除)
- voiceStateUpdate (ボイス参加/退出/ミュート等)
- presenceUpdate (ステータス更新)
- guildMemberUpdate (ニックネーム/ロール変更)
- channelCreate / channelDelete / channelUpdate
- threadCreate / threadDelete
- roleCreate / roleDelete / guildRoleUpdate
- webhookEvent / customEvent (将来拡張用)

重要: UI は既存の /rank ページと同様の CSS/レイアウトパターンを採用する（参照: [`src/web/client/src/pages/RankBoard/index.tsx`](src/web/client/src/pages/RankBoard/index.tsx:1), 共通スタイルは [`src/web/client/src/components/Layout/Layout.module.css`](src/web/client/src/components/Layout/Layout.module.css:1) をベースに）。

ユースケース例（拡張）:
- ユーザーが退出したときに `{user}` を埋め込んだ Embed を特定チャンネルへ送る
- 指定キーワードが含まれるメッセージが送信されたら自動で返信（Text または Reply）
- ボタン押下で管理者宛 Modal を開き、入力に基づき Webhook を叩く
- ボイスチャネル入退室で挨拶を送る / ロール変更時にDMで通知する

仕様（詳細）:
- Trigger エンティティ:
  - id, guildId, name, description, enabled, eventType, priority, conditions[], presets[]（最大5）, createdBy, createdAt, updatedAt
- Condition（複合可）:
  - id, type (messageContent / authorId / authorRole / channelId / hasAttachment / mention / regex / presence / voiceState / custom), matchType (equals / contains / regex / startsWith / endsWith), value, negate, groupId (AND/OR グループ化用)
- TriggerPreset（各トリガーに紐づくアクション、最大5）:
  - id, triggerId, index (order), enabled, type (Embed / Text / Reply / Modal / Webhook / DM / React), template (string or JSON), fields (Embed のフィールド配列等), targetChannelId?, webhookUrl?, dmTargetUserId?, reactEmoji?, cooldownSeconds?
  - type 詳細:
    - Embed: title, description, color, fields[], imageUrl, footer
    - Text: plain text or template with プレースホルダ
    - Reply: replyToMessageId の参照を許可（メッセージに対する返信）
    - Modal: modalId, modalFields[]（UI で設定可能。実行時にユーザーにモーダルを表示）
    - Webhook: url, method, headers, bodyTemplate
    - DM: targetUserId (or {author}), template
    - React: emoji (unicode or custom), optionally removeAfterSeconds
- プレースホルダ（利用可能なキー）:
  - 基本: {user}, {user.name}, {user.tag}, {user.id}, {user.createdAt}, {guild.name}, {guild.id}, {guild.memberCount}, {channel.name}, {channel.id}, {channel.topic}, {message.content}, {message.id}, {message.length}, {message.words}, {attachments.count}, {time}, {mention}
  - プレイヤー/権限: {author.roles}, {author.isBot}, {author.locale}
  - ボイス/プレゼンス: {voice.channel}, {voice.channel.id}, {presence.status}
  - ランダム/ユーティリティ: {random.int(min,max)}, {random.uuid}, {date.now}
  - 環境/管理者限定: {env.VARIABLE}（管理者のみ使用可。サーバー設定で有効化）
  - 注意:
    - 出力は自動的にエスケープされ XSS を防止する（Embed のフィールド等は適切にサニタイズ）。
    - 必要ならさらにカスタムプレースホルダを追加可能（運用ルールを設定）。
  - スクリプト連携:
    - Pseudo-JS（疑似スクリプト）を使った補助値は `{script.<key>}` で参照可能（例: `{script.greeting}`）。
    - スクリプト実行結果は JSON で返却され、テンプレート内でキー単位で参照する設計とする。

ログ保存ポリシー:
- 要件により、トリガー発火履歴は「永続的保存しない」設計とする。
- 実行時のイベント情報はサーバー側で短時間インメモリ（例: FIFO buffer, 最大 N 件、デフォルト 100）に保持し、WebSocket（または SSE）を介して管理 UI にリアルタイム送信する。
- 永続ログを残さないため、履歴は再起動で消えること、および監査が必要なら別途ログ保存モジュールを追加する旨を明記。

リアルタイム同期設計（WS）:
- サーバー: WebSocket 経路は既存の WebSocketManager を拡張し、イベント名 `trigger:fired` を発行する（payload: { triggerId, presetId, guildId, summary, renderedOutput, timestamp, success, error? }）。
- クライアント: /staff/triggerManager の右カラムで WS を購読し、受信したエントリを時系列で表示。最大保持数は UI 側で制限（例: 200）。
- UI 側では「リアルタイム表示（ライブ）」と「一時停止（キャプチャ停止）」を切替可能。
- 実行履歴は DB に保存されないため、長期監査が必要な場合は別途エクスポート機能（Webhook へ送信など）を検討。

UI（/staff/triggerManager）の詳細（/rank のデザインを踏襲、コンポーネント設計込み）:
- レイアウト: 3カラム（左: TriggerList, 中央: Editor, 右: Live Panel）を `/rank` と同じグリッド/幅比で実装。
  - 参考: [`src/web/client/src/pages/RankBoard/RankBoardHome.tsx`](src/web/client/src/pages/RankBoard/RankBoardHome.tsx:1) のレイアウトをコピーして調整。
- 左カラム - TriggerList:
  - 検索バー + フィルタ（イベントタイプ、状態、有効/無効、作成者）
  - 各アイテム: 名前、イベントタイプ、優先度バッジ、有効トグル、簡易編集ボタン
  - ドラッグ&ドロップで順序変更（優先度更新 API 呼び出し）
  - 新規ボタン（モーダルで Editor を開く）
- 中央カラム - Editor（TriggerEditor コンポーネント）:
  - 上部: 基本情報フォーム（名前、説明、enabled、priority）
  - イベントタイプ選択ドロップダウン（対応イベント一覧）
  - 条件エディタ（ConditionEditor コンポーネント）
    - 条件行の追加、matchType 選択、値入力、グループ AND/OR 設定
  - プリセットエリア（PresetEditorList）
    - 最大5スロットを視覚的に表示（空スロットは「追加」ボタン）
    - スロット内で type を選択し、タイプ別フォームを展開:
      - Embed エディタ（タイトル/説明/フィールド/色/画像）
      - Text エディタ（リッチプレースホルダ、文字数カウント）
      - Reply（返信時のオプション）
      - Modal（管理用モーダル定義フォーム: ラベル、種類、required）
      - Webhook（URL、method、ヘッダ、body テンプレート）
      - DM（ターゲットとテンプレート）
      - React（絵文字選択）
    - 各プリセットに cooldown 秒数入力、enable 切替、ドラッグで順序変更
  - Preview ボタン（モックイベントを送ってプレビュー表示、但し実運用の送信は行わないオプション）
  - Save / Cancel / Delete ボタン（サーバー API 連携）
- 右カラム - Live Panel（TriggerLivePanel）:
  - WebSocket 接続状態表示（接続中/切断）
  - リアルタイムで受信したトリガー発火エントリのタイムライン表示（レンダリング済みプレビューを折りたたんで表示可能）
  - フィルタ（eventType / triggerId / success only / errors only）
  - 「キャプチャ一時停止」「クリア表示」ボタン
  - 既定で保存しない仕様のため、ここで表示された履歴はサーバー再起動で消えることを明記
- スタイル:
  - `/rank` と同等の CSS モジュールを利用し、Class 名規約に従う（Module CSS）。必要なら `TriggerManager.module.css` を追加して既存クラスを流用。
  - 参照ファイル:
    - [`src/web/client/src/pages/RoleManager/RoleManager.module.css`](src/web/client/src/pages/RoleManager/RoleManager.module.css:1)
    - [`src/web/client/src/pages/RankManager/RankManager.module.css`](src/web/client/src/pages/RankManager/RankManager.module.css:1)
  - レスポンシブ: 幅が狭い場合は中→右の順でタブ化して切替表示

API/エンドポイント（更新: リアルタイム用 WS を考慮）:
- REST:
  - GET /api/triggers?guildId=...
  - GET /api/triggers/:id
  - POST /api/triggers
  - PUT /api/triggers/:id
  - DELETE /api/triggers/:id
  - POST /api/triggers/:id/test (モックイベントでのテスト実行、レスポンスはプレビューのみ)
  - POST /api/triggers/import
  - POST /api/triggers/export
- WS / SSE:
  - WS チャンネル: 'trigger:fired' をブロードキャスト
  - サーバーは該当ギルドのクライアントのみへ送信（認証済み接続で guildId を基にフィルタ）

データモデル（更新）:
- Trigger: 変更なし（presets は TriggerPreset オブジェクト配列）
- TriggerPreset: 詳細フィールドを追加（上記参照）
- TriggerLog: 永続化しないポリシーのため DB スキーマは提供しない。必要ならオプションモジュールで実装。

実装 TODO（詳細・優先順）:
- [ ] DB スキーマ: Trigger / TriggerPreset（永続データのみ）
- [ ] src/core/TriggerManager を追加:
      - 条件評価エンジン（複合 AND/OR）
      - プリセット実行 (Embed/Text/Reply/Modal/Webhook/DM/React)
      - cooldown 管理（プリセット単位の最小間隔）
      - 実行時に WS へ `trigger:fired` を送信（payload にレンダリング結果と要約を含む）
      - 永続ログは行わない（インメモリ短期バッファのみ）
- [ ] Discord イベントハンドラを拡張（src/core/EventHandler.ts / EventManager）
- [ ] API 層: src/web/routes/triggers.ts, src/web/controllers/TriggerController.ts を実装
- [ ] WebSocketManager の拡張: 認証されたクライアントへ `trigger:fired` を送信
- [ ] フロントエンド:
      - ページ: src/web/client/src/pages/TriggerManager/TriggerManager.tsx
      - コンポーネント: TriggerList, TriggerEditor, ConditionEditor, PresetEditor, LivePanel
      - CSS: src/web/client/src/pages/TriggerManager/TriggerManager.module.css（/rank に近いスタイル）
      - services/api.ts / services/WebSocketService.ts へエンドポイントと購読実装を追加
- [ ] 権限ミドルウェア: staff のみアクセス可にする
- [ ] テンプレートレンダリングエンジン実装（安全にエスケープ、長さ制限）
- [ ] 単体テスト & 統合テスト（モック Discord イベント + WS の受信検証）
- [ ] ドキュメント: README と UI のヘルプ（/staff/triggerManager 内のヘルプパネル）
- [ ] セキュリティ: Webhook URL 検証、外部 URL ブラックリスト、XSS 防止

注意・運用メモ:
- 履歴を永続化しないため、デバッグ用に「エクスポート」機能を用意して管理者が必要な時だけ履歴を外部に保存できるようにする（例: ZIP/JSON）。
- Modal 実行は Discord の仕様に依存するため、権限や許可フローを明記する。
- プリセット実行によるスパム防止は厳格に実装（最大5プリセット + cooldown + グローバルレート制御）。
- UI は /rank のデザインガイドに従うことで統一感を保つ。

マイルストーン案（詳細）:
1. DB スキーマ + basic TriggerManager（条件評価・プリセット実行・WS 発行）
2. 最小限 UI（一覧・編集・プリセット編集・WS ライブ表示）＋ REST API
3. 主要イベント統合（member/message/interaction/reaction/voice）＋ テスト
4. RateLimit 強化・セキュリティ対策（Webhook 検証等）
5. ドキュメント整備・運用手順作成・エクスポート機能