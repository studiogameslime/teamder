import { playerTimelineView } from '@/utils/playerTimelineView';
import type { CommunityPlayerEvent, Group } from '@/types';
const now = 10_000;
const group = {
  id: 'g',
  cardsEnabled: true,
  joinedAt: {
    u: 100
  },
  adminSince: {
    u: 200
  },
  redCardValidityDays: 7
} as unknown as Group;
const events: CommunityPlayerEvent[] = [{
  id: 'active',
  groupId: 'g',
  userId: 'u',
  type: 'red',
  at: 1000,
  expiresAt: null
}, {
  id: 'expired',
  groupId: 'g',
  userId: 'u',
  type: 'yellow',
  at: 2000,
  expiresAt: 9000
}, {
  id: 'revoked',
  groupId: 'g',
  userId: 'u',
  type: 'red',
  at: 3000,
  expiresAt: null,
  revoked: true
}, {
  id: 'took',
  groupId: 'g',
  userId: 'u',
  type: 'ball',
  at: 4000
}, {
  id: 'returned',
  groupId: 'g',
  userId: 'u',
  type: 'ball',
  at: 5000,
  returned: true
}, {
  id: 'other-club',
  groupId: 'other',
  userId: 'u',
  type: 'red',
  at: 6000,
  expiresAt: null
}, {
  id: 'other-player',
  groupId: 'g',
  userId: 'other',
  type: 'jerseys',
  at: 7000
}];
test('joining is header-only, while promotion remains in the chronological all view', () => {
  const view = playerTimelineView(events, group, 'u', 'all', now);
  expect(view.entries.map(e => e.key)).toEqual(['event:returned', 'event:took', 'event:revoked', 'event:expired', 'event:active', 'admin']);
  expect(view.entries.every(e => e.at !== 100)).toBe(true);
});
test('counts are independent of the selected filter and keep returns as equipment events', () => {
  for (const filter of ['all', 'cards', 'equipment'] as const) {
    const view = playerTimelineView(events, group, 'u', filter, now);
    expect(view.equipmentCount).toBe(2);
    expect(view.activeCards).toBe(1);
  }
});
test('cards filter includes expired and revoked history without membership or equipment', () => {
  expect(playerTimelineView(events, group, 'u', 'cards', now).entries.map(e => e.key)).toEqual(['event:revoked', 'event:expired', 'event:active']);
});
test('equipment filter excludes cards and promotion', () => {
  expect(playerTimelineView(events, group, 'u', 'equipment', now).entries.map(e => e.key)).toEqual(['event:returned', 'event:took']);
});
test('disabled card feature hides historical cards and clears their summary', () => {
  const view = playerTimelineView(events, {
    ...group,
    cardsEnabled: false
  }, 'u', 'all', now);
  expect(view.entries.map(e => e.key)).toEqual(['event:returned', 'event:took', 'admin']);
  expect(view.activeCards).toBe(0);
});
test('snapshot expiry is authoritative and reading the view does not change source data', () => {
  const before = JSON.stringify(events);
  expect(playerTimelineView(events, group, 'u', 'all', now).activeCards).toBe(1);
  expect(JSON.stringify(events)).toBe(before);
});
test('missing membership dates do not create milestones or fallback account dates', () => {
  expect(playerTimelineView([], {
    ...group,
    joinedAt: undefined,
    adminSince: undefined
  }, 'u', 'all', now).entries).toEqual([]);
});
