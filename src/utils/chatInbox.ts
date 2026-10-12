import type { ChatUnreadEntry, GameStatus } from '@/types';

export function chatSenderNeedsIdentity(entry: ChatUnreadEntry): boolean {
  return entry.scope !== 'dm' && !!entry.lastText && !!entry.lastSenderId &&
    (!entry.lastSenderName.trim() || entry.lastSenderName.trim() === 'שחקן');
}

export function chatMessagePreview(entry: ChatUnreadEntry | undefined, myId?: string, resolvedName?: string): string {
  if (!entry?.lastText) return '';
  if (entry.lastSenderId && entry.lastSenderId === myId) return `אני: ${entry.lastText}`;
  if (entry.scope === 'dm') return entry.lastText;
  const name = (chatSenderNeedsIdentity(entry) ? resolvedName?.trim() : entry.lastSenderName.trim()) || entry.lastSenderName.trim() || 'שחקן';
  // Isolate Latin display names without disturbing the Hebrew message body.
  return `${/[A-Za-z]/.test(name) ? `⁨${name}⁩` : name}: ${entry.lastText}`;
}

export interface ChatPreferences { muted: boolean; pinned: boolean; archivedAt: number; archivedMessageId?: string }
export const ROUND_CHAT_WINDOW_MS = 24 * 60 * 60 * 1000;
export function roundChatState(game: { status: GameStatus; endedAt?: number }, now: number) {
  if (game.status === 'cancelled') return { closed: true, remainingMs: 0, reason: 'cancelled' as const };
  if (game.status !== 'finished') return { closed: false, remainingMs: null, reason: null };
  // Older finished rounds with no actual end timestamp cannot start a new window.
  const deadline = Number.isFinite(game.endedAt) && (game.endedAt ?? 0) > 0
    ? game.endedAt! + ROUND_CHAT_WINDOW_MS : 0;
  return { closed: now >= deadline, remainingMs: Math.max(0, deadline - now), reason: 'finished' as const };
}
export function chatIsArchived(lastMessageAt: number, preferences?: ChatPreferences, closed = false, lastMessageId?: string) {
  return closed || (!!preferences?.archivedAt && (preferences.archivedMessageId && lastMessageId ? lastMessageId === preferences.archivedMessageId : lastMessageAt <= preferences.archivedAt));
}
export function chatCountdown(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
}
