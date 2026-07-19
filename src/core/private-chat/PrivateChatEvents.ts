import { EventEmitter } from 'events';

export type PrivateChatEventPayload =
  | { type: 'chatCreated'; chatId: string; guildId: string; staffId: string; roomName?: string; userId?: string }
  | { type: 'chatDeleted'; chatId: string; guildId: string }
  | { type: 'memberAdded'; chatId: string; guildId: string; userId: string }
  | { type: 'memberRemoved'; chatId: string; guildId: string; userId: string };

const emitter = new EventEmitter();

// allow many listeners
emitter.setMaxListeners(50);

export function getPrivateChatEmitter() {
  return emitter;
}

export function emitPrivateChatEvent(payload: PrivateChatEventPayload) {
  emitter.emit('privateChatEvent', payload);
}

export default emitter;
