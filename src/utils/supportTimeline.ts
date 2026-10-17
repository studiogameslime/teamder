import type { ChatMessage } from '@/types';

export function mergeSupportMessages(windows: ChatMessage[][], limit = 100): ChatMessage[] {
  const unique = new Map(windows.flat().map(message => [message.id, message]));
  return [...unique.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(-limit);
}

function dayKey(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function supportDayLabel(time: number, previous?: number, now = Date.now()): string | null {
  if (previous !== undefined && dayKey(previous) === dayKey(time)) return null;
  if (dayKey(time) === dayKey(now)) return 'היום';
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(time) === dayKey(yesterday.getTime())) return 'אתמול';
  return new Date(time).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
