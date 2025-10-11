// SSE client to receive private chat events and call window.web.notify

export function startPrivateChatSSE(guildId?: string) {
  try {
    const url = guildId
      ? `/api/staff/privatechats/stream?guildId=${encodeURIComponent(guildId)}`
      : `/api/staff/privatechats/stream`;
    const es = new EventSource(url);

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        // If it's an update (full list), ignore for notify; if it's privateChatEvent, notify
        if (data && data.type === 'privateChatEvent' && data.payload) {
          const p = data.payload;
          // construct a user-friendly message based on payload.type
          let title = '通知';
          let message = '';
          let t: 'info'|'success'|'error' = 'info';

          switch (p.type) {
            case 'chatCreated':
              title = 'プライベートチャット作成';
              message = p.roomName ? `部屋 "${p.roomName}" が作成されました` : `チャット (${p.chatId}) が作成されました`;
              t = 'success';
              break;
            case 'chatDeleted':
              title = 'プライベートチャット削除';
              message = `チャット (${p.chatId}) が削除されました`;
              t = 'error';
              break;
            case 'memberAdded':
              title = 'メンバー追加';
              message = `ユーザー ${p.userId} がチャットに追加されました`;
              t = 'success';
              break;
            case 'memberRemoved':
              title = 'メンバー削除';
              message = `ユーザー ${p.userId} がチャットから削除されました`;
              t = 'info';
              break;
            default:
              break;
          }

          try {
            if (window.web && typeof window.web.notify === 'function') {
              window.web.notify(message, t, title, 6000);
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('Failed to call web.notify from SSE handler', e);
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Failed to parse SSE message', e);
      }
    };

    es.onerror = (err) => {
      // eslint-disable-next-line no-console
      console.warn('SSE connection error', err);
      // simple reconnect strategy
      es.close();
      setTimeout(() => startPrivateChatSSE(guildId), 5000);
    };

    return es;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('startPrivateChatSSE failed', err);
    return null;
  }
}
