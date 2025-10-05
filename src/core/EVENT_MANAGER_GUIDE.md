# EventManager 使用ガイド

## 概要

`EventManager` は、Discord標準イベントとカスタムイベントの両方を統一的に管理できるイベントシステムです。

## 基本的な使い方

### 1. EventManagerへのアクセス

`BotClient` のインスタンス経由でアクセスできます:

```typescript
import { botClient } from './index.js';

const eventManager = botClient.eventManager;
```

### 2. イベントリスナーの登録

#### Discord標準イベント

```typescript
import { Event } from './types/events.js';

// メッセージ作成イベント
const listenerId = eventManager.register(Event.MESSAGE_CREATE, (message) => {
    console.log(`メッセージ受信: ${message.content}`);
});

// ギルド参加イベント
eventManager.register(Event.GUILD_MEMBER_ADD, (member) => {
    console.log(`${member.user.tag} がサーバーに参加しました`);
});

// リアクション追加イベント
eventManager.register(Event.REACTION_ADD, ({ reaction, user }) => {
    console.log(`${user.tag} が ${reaction.emoji.name} をリアクションしました`);
});
```

#### カスタムイベント

```typescript
// コマンド実行イベント
eventManager.register(Event.COMMAND_EXECUTE, (payload) => {
    console.log(`コマンド実行: ${payload.commandName} by ${payload.user.tag}`);
});

// コマンドエラーイベント
eventManager.register(Event.COMMAND_ERROR, (payload) => {
    console.error(`コマンドエラー: ${payload.commandName}`, payload.error);
});

// 権限拒否イベント
eventManager.register(Event.PERMISSION_DENIED, (payload) => {
    console.log(`権限不足: ${payload.user.tag} - ${payload.commandName}`);
});

// クールダウンヒットイベント
eventManager.register(Event.COOLDOWN_HIT, (payload) => {
    console.log(`クールダウン: ${payload.user.tag} - ${payload.remainingTime}秒`);
});
```

### 3. イベントリスナーの登録解除

```typescript
// 登録時に返されたIDを使って解除
const listenerId = eventManager.register(Event.MESSAGE_CREATE, (message) => {
    console.log(message.content);
});

// 後で解除
eventManager.unregister(listenerId);
```

### 4. 一度だけ実行されるリスナー

```typescript
// once() メソッドを使用
eventManager.once(Event.READY, (client) => {
    console.log('Bot準備完了！このメッセージは一度だけ表示されます');
});

// または register() にオプションを渡す
eventManager.register(Event.GUILD_CREATE, (guild) => {
    console.log(`新しいサーバー: ${guild.name}`);
}, { once: true });
```

### 5. 優先度の設定

```typescript
// 優先度の高いリスナーが先に実行される
eventManager.register(Event.MESSAGE_CREATE, (message) => {
    console.log('これが最初に実行されます');
}, { priority: 100 });

eventManager.register(Event.MESSAGE_CREATE, (message) => {
    console.log('これは後で実行されます');
}, { priority: 50 });
```

### 6. カスタムイベントの発火

```typescript
// カスタムイベントを手動で発火
eventManager.emit(Event.BOT_STATUS_CHANGE, {
    oldStatus: 'idle',
    newStatus: 'online',
    timestamp: Date.now(),
});

eventManager.emit(Event.GUILD_SETTINGS_UPDATE, {
    guildId: '123456789',
    settings: { staffRoleId: '987654321' },
});
```

## 利用可能なイベント一覧

### Discord標準イベント

- `Event.MESSAGE_CREATE` - メッセージ作成
- `Event.MESSAGE_DELETE` - メッセージ削除
- `Event.MESSAGE_UPDATE` - メッセージ編集
- `Event.INTERACTION_CREATE` - インタラクション作成
- `Event.GUILD_CREATE` - ギルド参加
- `Event.GUILD_DELETE` - ギルド退出
- `Event.GUILD_MEMBER_ADD` - メンバー参加
- `Event.GUILD_MEMBER_REMOVE` - メンバー退出
- `Event.CHANNEL_CREATE` - チャンネル作成
- `Event.CHANNEL_DELETE` - チャンネル削除
- `Event.ROLE_CREATE` - ロール作成
- `Event.ROLE_DELETE` - ロール削除
- `Event.VOICE_STATE_UPDATE` - ボイス状態変更
- `Event.REACTION_ADD` - リアクション追加
- `Event.REACTION_REMOVE` - リアクション削除
- `Event.READY` - Bot準備完了

### カスタムイベント

- `Event.COMMAND_EXECUTE` - コマンド実行
- `Event.COMMAND_ERROR` - コマンドエラー
- `Event.PERMISSION_DENIED` - 権限拒否
- `Event.COOLDOWN_HIT` - クールダウンヒット
- `Event.BOT_STATUS_CHANGE` - Botステータス変更
- `Event.GUILD_SETTINGS_UPDATE` - ギルド設定更新
- `Event.DATABASE_UPDATE` - データベース更新
- `Event.PLUGIN_LOAD` - プラグインロード
- `Event.PLUGIN_UNLOAD` - プラグインアンロード

## 実用例

### 例1: メッセージログシステム

```typescript
import { Event } from './types/events.js';
import { botClient } from './index.js';

// メッセージログ
botClient.eventManager.register(Event.MESSAGE_CREATE, async (message) => {
    if (message.author.bot) return;
    
    console.log(`[${message.guild?.name}] ${message.author.tag}: ${message.content}`);
});

// メッセージ削除ログ
botClient.eventManager.register(Event.MESSAGE_DELETE, async (message) => {
    console.log(`メッセージ削除: ${message.content} by ${message.author?.tag}`);
});
```

### 例2: ウェルカムメッセージ

```typescript
botClient.eventManager.register(Event.GUILD_MEMBER_ADD, async (member) => {
    const channel = member.guild.systemChannel;
    if (channel) {
        await channel.send(`ようこそ ${member.user.tag} さん！🎉`);
    }
});
```

### 例3: コマンド使用統計

```typescript
const commandStats = new Map<string, number>();

botClient.eventManager.register(Event.COMMAND_EXECUTE, (payload) => {
    const count = commandStats.get(payload.commandName) || 0;
    commandStats.set(payload.commandName, count + 1);
    
    console.log(`コマンド統計: ${payload.commandName} が ${count + 1} 回実行されました`);
});
```

### 例4: エラーモニタリング

```typescript
botClient.eventManager.register(Event.COMMAND_ERROR, async (payload) => {
    // エラーログをファイルに保存
    const logMessage = `
[${new Date().toISOString()}]
Command: ${payload.commandName}
User: ${payload.user.tag}
Guild: ${payload.guild?.name || 'DM'}
Error: ${payload.error.message}
Stack: ${payload.error.stack}
---
`;
    
    // ファイルに追記またはDiscordチャンネルに送信
    console.error(logMessage);
});
```

### 例5: 自動ロール付与システム

```typescript
botClient.eventManager.register(Event.GUILD_MEMBER_ADD, async (member) => {
    // 設定から自動ロールIDを取得
    const settings = await database.get(`guild_settings_${member.guild.id}`);
    
    if (settings?.autoRoleId) {
        const role = member.guild.roles.cache.get(settings.autoRoleId);
        if (role) {
            await member.roles.add(role);
            console.log(`${member.user.tag} に ${role.name} ロールを付与しました`);
        }
    }
});
```

## 高度な使い方

### リスナーの条件付き実行

```typescript
// 特定のギルドでのみ実行
botClient.eventManager.register(Event.MESSAGE_CREATE, async (message) => {
    if (message.guildId !== 'YOUR_GUILD_ID') return;
    
    // 処理...
});

// Botメッセージを除外
botClient.eventManager.register(Event.MESSAGE_CREATE, async (message) => {
    if (message.author.bot) return;
    
    // 処理...
});
```

### 統計情報の取得

```typescript
const stats = botClient.eventManager.getStats();
console.log(`登録イベント数: ${stats.totalEvents}`);
console.log(`総リスナー数: ${stats.totalListeners}`);

stats.eventDetails.forEach(({ event, listenerCount }) => {
    console.log(`${event}: ${listenerCount} リスナー`);
});
```

### クリーンアップ

```typescript
// 特定イベントの全リスナーを解除
botClient.eventManager.unregisterAll(Event.MESSAGE_CREATE);

// すべてをクリア
botClient.eventManager.clear();
```

## 注意事項

1. **非同期処理**: イベントハンドラーは非同期関数にすることができます
2. **エラーハンドリング**: ハンドラー内のエラーは自動的にキャッチされログに記録されます
3. **パフォーマンス**: 多数のリスナーを登録するとパフォーマンスに影響する可能性があります
4. **メモリリーク**: 不要になったリスナーは必ず `unregister()` で解除してください

## プラグインでの使用例

```typescript
// plugins/example-plugin.js
export default {
    name: 'example-plugin',
    
    load: (botClient) => {
        // リスナーIDを保存しておく
        const listeners = [];
        
        listeners.push(
            botClient.eventManager.register(Event.MESSAGE_CREATE, (message) => {
                // 処理...
            })
        );
        
        // プラグインのクリーンアップ用に保存
        return { listeners };
    },
    
    unload: (botClient, data) => {
        // すべてのリスナーを解除
        data.listeners.forEach(id => {
            botClient.eventManager.unregister(id);
        });
    }
};
```

## 型安全性

TypeScriptを使用している場合、イベントペイロードの型は自動的に推論されます:

```typescript
// ペイロードの型は自動的に Message 型になります
eventManager.register(Event.MESSAGE_CREATE, (message) => {
    // message. と入力すると自動補完が効きます
    console.log(message.content);
});

// カスタムイベントも型安全
eventManager.register(Event.COMMAND_EXECUTE, (payload) => {
    // payload.commandName, payload.user などが利用可能
    console.log(payload.commandName);
});
```
