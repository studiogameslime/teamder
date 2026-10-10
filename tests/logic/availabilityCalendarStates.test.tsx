import React from 'react';

let mockUid: string | null = 'first';
let mockStates: unknown[] = [];
let mockCursor = 0;
let mockFocus: () => void | (() => void);
const mockFetch = jest.fn();
const mockInvalidate = jest.fn();
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const at = mockCursor++;
    if (!(at in mockStates)) mockStates[at] = initial;
    return [mockStates[at], (next: any) => { mockStates[at] = typeof next === 'function' ? next(mockStates[at]) : next; }];
  },
  useCallback: (callback: unknown) => callback,
}));
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: (value: unknown) => value },
}));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (callback: typeof mockFocus) => { mockFocus = callback; } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/components/Card', () => ({ Card: 'Card' }));
jest.mock('@/store/userStore', () => ({ useUserStore: (selector: any) => selector({ currentUser: mockUid ? { id: mockUid } : null }) }));
jest.mock('@/services/availabilityFeedService', () => ({
  availabilityFeedService: { getAvailabilityCounts: () => mockFetch(), invalidate: () => mockInvalidate() },
  TIME_WINDOWS: ['morning', 'noon', 'evening'],
}));
jest.mock('@/theme', () => ({ colors: {}, radius: {}, spacing: {}, typography: {}, RTL_LABEL_ALIGN: 'left' }));

import { AvailabilityCalendarCard } from '@/components/home/AvailabilityCalendarCard';

function render(fullScreen = true) {
  mockCursor = 0;
  return AvailabilityCalendarCard({ fullScreen, onCreateGame: jest.fn(), onSetAvailability: jest.fn() });
}
function walk(node: any): any[] {
  if (node == null) return [];
  if (typeof node !== 'object') return [node];
  return [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
}
const text = (node: any) => walk(node).filter(value => typeof value === 'string').join(' ');
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const counts = { hasLocation: true, radiusKm: 31, viewerCity: 'עיר ראשונה', days: [{ dateMs: Date.UTC(2026, 9, 10), isToday: true, weekday: 6, windows: { morning: 7, noon: 8, evening: 9 } }] };

beforeEach(() => { mockUid = 'first'; mockStates = []; mockCursor = 0; jest.clearAllMocks(); });

test('dedicated week explains initial loading and failure and retries without showing zero counts', async () => {
  mockFetch.mockRejectedValueOnce(new Error('offline'));
  expect(text(render())).toContain('טוען זמינות');
  mockFocus(); await flush();
  const failed = render();
  expect(text(failed)).toContain('לא ניתן לטעון');
  const retry = walk(failed).find(node => node?.props?.accessibilityRole === 'button');
  retry.props.onPress();
  expect(mockInvalidate).toHaveBeenCalledTimes(1);
  mockFetch.mockResolvedValueOnce(counts);
  mockFocus(); await flush();
  expect(text(render())).not.toContain('לא ניתן לטעון');
  expect(walk(render()).some(node => node?.props?.accessibilityLabel?.includes('9'))).toBe(true);
});

test('failed refresh retains this account data with a warning, while compact home stays quiet', async () => {
  mockFetch.mockResolvedValueOnce(counts); render(); mockFocus(); await flush();
  mockFetch.mockRejectedValueOnce(new Error('offline')); render(); mockFocus(); await flush();
  expect(text(render())).toContain('הנתונים הקודמים מוצגים');
  expect(walk(render()).some(node => node?.props?.accessibilityLabel?.includes('9'))).toBe(true);
  expect(text(render(false))).not.toContain('העדכון נכשל');
});

test('account change hides old counts before effect cleanup and ignores a late old request', async () => {
  mockFetch.mockResolvedValueOnce(counts); render(); const firstCleanup = mockFocus(); await flush();
  expect(text(render())).not.toContain('טוען זמינות');
  let resolve!: (value: typeof counts) => void;
  mockFetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(); const oldCleanup = mockFocus();
  mockUid = 'second';
  expect(text(render())).toContain('טוען זמינות');
  if (firstCleanup) firstCleanup();
  if (oldCleanup) oldCleanup();
  resolve(counts); await flush();
  expect(text(render())).toContain('טוען זמינות');
  expect(walk(render()).some(node => node?.props?.accessibilityLabel?.includes('9'))).toBe(false);
});
