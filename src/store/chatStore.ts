// chatStore — holds my per-chat unread index (the /users/{uid}/chatUnread
// docs, maintained by the message-trigger Cloud Function). A single
// app-wide subscriber (started in MainTabs) keeps this fresh so the tab
// badge + chats-list previews stay live regardless of which tab is open.

import { create } from 'zustand';
import type { ChatUnreadEntry } from '@/types';

interface ChatState {
  /** Keyed by chatKey (`${scope}__${parentId}`). */
  entries: Record<string, ChatUnreadEntry>;
  setEntries: (list: ChatUnreadEntry[]) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  entries: {},
  setEntries: (list) =>
    set({ entries: Object.fromEntries(list.map((e) => [e.id, e])) }),
  clear: () => set({ entries: {} }),
}));

/** Total unread messages across all my chats — drives the tab badge. */
export function totalUnread(entries: Record<string, ChatUnreadEntry>): number {
  return Object.values(entries).reduce((sum, e) => sum + (e.count || 0), 0);
}
