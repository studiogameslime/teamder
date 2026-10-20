import { requestInboxRows } from '@/utils/requestInboxView';
import type { InboxRequests } from '@/services/requestsService';
const data = {
  friends: [{
    request: {
      id: 'f',
      fromUserId: 'missing',
      createdAt: 7
    },
    user: null
  }],
  communities: [{
    group: {
      id: 'a',
      name: 'אדומים'
    },
    pending: [{
      id: 'same',
      name: 'תומר'
    }]
  }, {
    group: {
      id: 'b',
      name: 'כחולים'
    },
    pending: [{
      id: 'same',
      name: 'תומר'
    }, {
      id: 'u',
      name: 'איתי'
    }]
  }],
  games: [{
    game: {
      id: 'round-a',
      groupId: 'a',
      title: 'חמישי'
    },
    pending: [{
      id: 'same',
      name: 'תומר'
    }]
  }, {
    game: {
      id: 'orphan',
      title: 'מחזור פתוח'
    },
    pending: [{
      id: 'u',
      name: 'איתי'
    }]
  }],
  total: 6
} as unknown as InboxRequests;
test('the bell preserves all three request kinds including a missing user profile', () => {
  const rows = requestInboxRows(data);
  expect(rows).toHaveLength(6);
  expect(rows[0]).toMatchObject({
    user: null,
    userId: 'missing',
    kind: 'friend',
    createdAt: 7
  });
  expect(new Set(rows.map(r => r.key)).size).toBe(6);
});
test('club entry includes only the club and its rounds, excluding personal and standalone requests', () => {
  expect(requestInboxRows(data, 'a').map(r => r.key)).toEqual(['club:a:same', 'game:round-a:same']);
  expect(requestInboxRows(data, 'b').map(r => r.key)).toEqual(['club:b:same', 'club:b:u']);
  expect(requestInboxRows(data, 'unknown')).toEqual([]);
});
test('clearing the club filter restores the complete inbox', () => {
  requestInboxRows(data, 'a');
  expect(requestInboxRows(data, undefined)).toHaveLength(6);
});
test('name sorting preserves target identity and does not mutate the underlying request arrays', () => {
  const before = JSON.stringify(data);
  expect(requestInboxRows(data, 'b', true).map(r => r.userId)).toEqual(['u', 'same']);
  expect(JSON.stringify(data)).toBe(before);
  expect(requestInboxRows(data, 'b').map(r => r.userId)).toEqual(['same', 'u']);
});
test('club requests do not invent dates from account creation or membership dates', () => {
  expect(requestInboxRows(data, 'a').every(r => r.createdAt === undefined)).toBe(true);
});
