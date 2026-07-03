// activeChat — a tiny module-level tracker of which chat the user is currently
// viewing, so the foreground notification handler can SUPPRESS a heads-up
// banner for the very chat that's already open (otherwise two people chatting
// live each get a banner per message — the server re-arms the one-push gate on
// every read-reset).
//
// The chat key mirrors the server's: `${scope}__${parentId}` (see chatPush).

let activeChatKey: string | null = null;

export function setActiveChat(key: string | null): void {
  activeChatKey = key;
}

export function getActiveChat(): string | null {
  return activeChatKey;
}

/** True when a chat-message notification targets the chat that's open now. */
export function isActiveChatNotification(data: unknown): boolean {
  if (!activeChatKey || !data || typeof data !== 'object') return false;
  const d = data as { type?: string; chatKey?: string };
  return d.type === 'chatMessage' && d.chatKey === activeChatKey;
}
