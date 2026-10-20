import type { CommunityPlayerEvent, Group } from '@/types';
import { cardState } from '@/utils/cardState';
export type PlayerTimelineFilter = 'all' | 'cards' | 'equipment';
export type PlayerTimelineEntry = {
  kind: 'event';
  key: string;
  at: number;
  event: CommunityPlayerEvent;
} | {
  kind: 'admin';
  key: string;
  at: number;
};
export function playerTimelineView(events: CommunityPlayerEvent[], group: Group, userId: string, filter: PlayerTimelineFilter, now: number) {
  const scoped = events.filter(e => e.groupId === group.id && e.userId === userId);
  const equipment = scoped.filter(e => e.type === 'ball' || e.type === 'jerseys');
  const cards = group.cardsEnabled === true ? scoped.filter(e => e.type === 'red' || e.type === 'yellow') : [];
  const activeCards = cards.filter(e => cardState(e, e.type === 'red' ? group.redCardValidityDays : group.yellowCardValidityDays, now) === 'active').length;
  const shown = filter === 'cards' ? cards : filter === 'equipment' ? equipment : [...cards, ...equipment];
  const entries: PlayerTimelineEntry[] = shown.map(event => ({
    kind: 'event',
    key: `event:${event.id}`,
    at: event.at,
    event
  }));
  const promotedAt = group.adminSince?.[userId];
  if (filter === 'all' && typeof promotedAt === 'number' && promotedAt > 0) entries.push({
    kind: 'admin',
    key: 'admin',
    at: promotedAt
  });
  entries.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
  // Joining belongs only to the identity header, never to the event list.
  return {
    entries,
    equipmentCount: equipment.length,
    activeCards
  };
}
