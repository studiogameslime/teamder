import type { ThreadSummary } from './teamderChatService';
export type SupportFilter = 'all' | 'waiting' | 'sent' | 'resolved';
export function filterSupportThreads(threads: ThreadSummary[], search: string, filter: SupportFilter): ThreadSummary[] {
  const needle = search.trim().toLocaleLowerCase();
  return threads.filter(thread =>
    (filter === 'all' || (filter === 'resolved' ? !!thread.resolved : filter === 'waiting' ? thread.awaitingReply : !thread.awaitingReply && !thread.resolved)) &&
    (!needle || `${thread.userName} ${thread.lastText}`.toLocaleLowerCase().includes(needle)),
  ).sort((a, b) => Number(b.awaitingReply) - Number(a.awaitingReply) || (a.awaitingReply && b.awaitingReply ? a.lastMessageAt - b.lastMessageAt : b.lastMessageAt - a.lastMessageAt));
}
export function supportNotificationTarget(data: Record<string, unknown>): { userId: string; messageId?: string } | null {
  if (data.type !== 'teamderReply' || typeof data.parentId !== 'string') return null;
  const ids = data.parentId.split('__');
  if (ids.length !== 2 || !ids.includes('teamder')) return null;
  const userId = ids.find(id => id !== 'teamder');
  if (!userId || /[\/\s]/.test(userId) || [...ids].sort().join('__') !== data.parentId) return null;
  return { userId, ...(typeof data.messageId === 'string' ? { messageId: data.messageId } : {}) };
}
