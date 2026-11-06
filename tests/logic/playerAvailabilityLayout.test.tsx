import React from 'react';
import { PlayerAvailabilitySummary } from '@/components/social/PlayerAvailabilitySummary';
import type { SocialPlayer } from '@/types/social';

let mockViewport = { width: 390, fontScale: 1 };
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => mockViewport,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left' }));

const player: SocialPlayer = {
  id: 'preview', name: 'שחקן', city: 'פתח תקווה', friend: false, sharedRounds: 0, commonClubCount: 0,
  availability: { preferredDays: [0, 2], isAvailableForInvites: true, availabilitySlots: { 0: ['morning', 'evening'], 2: ['noon'] } },
};
function elements(child: React.ReactNode): React.ReactElement<any>[] {
  return React.Children.toArray(child).flatMap(node =>
    React.isValidElement<{children?: React.ReactNode}>(node) ? [node, ...elements(node.props.children)] : []);
}
function renderAt(width: number, fontScale: number) {
  mockViewport = { width, fontScale };
  return elements(PlayerAvailabilitySummary({ player }));
}

test('a wide grid still identifies every time window for each day', () => {
  const cells = renderAt(768, 2).map(node => node.props.accessibilityLabel).filter(Boolean);
  expect(cells).toHaveLength(21);
  expect(cells).toContain('ראשון, ערב: זמין');
  expect(cells).toContain('ראשון, צהריים: לא סומנה זמינות');
  expect(cells).toContain('שלישי, צהריים: זמין');
});

test.each([[320, 2], [390, 1.5]])('a crowded %s-wide viewport at %s scale retains all days and their own slots', (width, scale) => {
  const labels = renderAt(width, scale).filter(node => node.type === 'Text')
    .map(node => React.Children.toArray(node.props.children).join(''));
  expect(labels).toEqual([
    'ראשון · בוקר, ערב', 'שני · לא סומנה זמינות', 'שלישי · צהריים', 'רביעי · לא סומנה זמינות',
    'חמישי · לא סומנה זמינות', 'שישי · לא סומנה זמינות', 'שבת · לא סומנה זמינות', 'פתח תקווה והסביבה',
  ]);
});
