import React from 'react';

let mockExpanded = false;
jest.mock('react', () => ({ ...jest.requireActual('react'), useState: () => [mockExpanded, jest.fn()] }));
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path', Rect: 'Rect' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 20 }) }));
jest.mock('@/components/Button', () => ({ Button: 'Button' }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left' }));

import { RoundReviewSheet } from '@/components/games/RoundReviewSheet';
import type { GameFormValues } from '@/screens/games/GameWizardForm';

function nodes(node: any): any[] {
  if (!React.isValidElement<any>(node)) return typeof node === 'string' ? [node] : [];
  if (typeof node.type === 'function') return nodes((node.type as any)(node.props));
  return [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
}
const values: GameFormValues = {
  title: '', startsAt: new Date(2026, 9, 15, 20).getTime(), city: 'תל אביב', cityFromList: true, fieldAddress: '', fieldName: 'המגרש', fieldType: 'synthetic', format: '5v5', numberOfTeams: 3,
  matchDurationMinutes: '15', advancedMode: false, advancedFillMode: 'permanent', advancedTieMode: 'bothOut', ruleTags: [],
  visibility: 'community', requiresApproval: false, waitlistApprovalRequired: true, waitlistApprovalTimeout: '20', recurringGameEnabled: false,
  scheduledRegEnabled: false, registrationOpensAt: 0, publicOpenAt: 0, guestsOpenAt: 0, autoTeamsAt: 0, autoTeamsMethod: 'rating',
  cancelDeadlineHours: undefined, acceptsFillers: false, fillerMinTrust: 0, notes: 'הערת המנהל', bringBall: true, bringShirts: false,
};
const render = (overrides: Partial<React.ComponentProps<typeof RoundReviewSheet>> = {}) => nodes(RoundReviewSheet({ values, maxPlayers: 15, communityName: 'מועדון השכונה', quick: false, isEdit: false, busy: false, onConfirm: jest.fn(), onClose: jest.fn(), ...overrides }));
const text = (items: any[]) => items.filter(x => typeof x === 'string').join(' ');

beforeEach(() => { mockExpanded = false; });
test('picker address is not repeated, while distinct arrival details are retained', () => {
  const address = 'משה שרת 15, תל אביב–יפו';
  const duplicated = text(render({ values: { ...values, fieldName: address, fieldAddress: address } }));
  expect(duplicated.split(address)).toHaveLength(2);
  const contained = text(render({ values: { ...values, fieldName: `מגרש הכדורגל · ${address}`, fieldAddress: 'משה שרת 15 תל אביב-יפו' } }));
  expect(contained).not.toContain('משה שרת 15 תל אביב-יפו');
  expect(text(render({ values: { ...values, fieldAddress: 'כניסה מהשער הדרומי' } }))).toContain('כניסה מהשער הדרומי');
});
test('preview opens no write and only the explicit confirmation invokes submit', () => {
  const onConfirm = jest.fn(); const onClose = jest.fn();
  const items = render({ onConfirm, onClose });
  expect(onConfirm).not.toHaveBeenCalled();
  expect(text(items)).toContain('חברי המועדון בלבד');
  expect(text(items)).toContain('מיד עם יצירת המחזור');
  expect(text(items)).not.toContain('הערת המנהל');
  items.find(x => x?.props?.title === 'אישור ויצירת המחזור').props.onPress();
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});
test('scheduled and edit previews distinguish configured opening from an immediate creation', () => {
  const scheduled = render({ values: { ...values, scheduledRegEnabled: true, registrationOpensAt: new Date(2026, 9, 13, 10).getTime(), publicOpenAt: new Date(2026, 9, 14, 10).getTime(), requiresApproval: true }, isEdit: true });
  expect(text(scheduled)).toContain('מתוזמנת');
  expect(text(scheduled)).toContain('באישור מנהל');
  expect(text(scheduled)).toContain('פתיחה לכל האפליקציה');
  expect(text(scheduled)).not.toContain('מיד עם יצירת המחזור');
  expect(text(render({ isEdit: true }))).toContain('ללא תזמון פתיחה');
});
test('private quick rounds omit community scheduling; expanded content preserves notes and rules', () => {
  mockExpanded = true;
  const items = render({ quick: true, values: { ...values, ruleTags: ['ללא גליצ׳ים'], scheduledRegEnabled: true, registrationOpensAt: 123 } });
  expect(text(items)).toContain('למוזמנים בלבד');
  expect(text(items)).toContain('הערת המנהל');
  expect(text(items)).toContain('ללא גליצ׳ים');
  expect(text(items)).not.toContain('מתוזמנת');
  expect(text(items)).not.toContain('תזמון יצירת כוחות');
});
