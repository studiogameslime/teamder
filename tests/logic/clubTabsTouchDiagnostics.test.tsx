import React from 'react';

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useRef: (value: unknown) => ({ current: value }),
  useEffect: jest.fn(),
}));
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (value: unknown) => value } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left', clubAccent: {}, colors: {} }));

import { ClubTabs } from '@/components/club/ClubTabs';
import { he } from '@/i18n/he';
import { diagnosticSnapshot, resetDiagnosticJournal } from '@/services/diagnosticJournal';

function button(locked: boolean) {
  const onChange = jest.fn(), onLockedPress = jest.fn();
  const root = ClubTabs({ tabs: [{ key: 'players', label: 'שחקנים', locked }], active: 'info', onChange, onLockedPress });
  const child = React.Children.toArray(root.props.children)[0] as any;
  const native = child.type(child.props).props;
  native.ref.current = { measure: (done: (...values: number[]) => void) => done(0, 0, 100, 52, 200, 280) };
  return { native, onChange, onLockedPress };
}
const event = { nativeEvent: { pageX: 250, pageY: 300 } };

it('records cancellation without selecting, and a later real press still selects exactly once', () => {
  resetDiagnosticJournal();
  const { native, onChange, onLockedPress } = button(false);
  native.onPressIn(event); native.onTouchMove(event); native.onTouchCancel(event); native.onPressOut(event);
  expect(onChange).not.toHaveBeenCalled(); expect(onLockedPress).not.toHaveBeenCalled();
  native.onPressIn(event); native.onTouchEnd(event); native.onPressOut(event); native.onPress();
  expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenCalledWith('players');
  const entries = diagnosticSnapshot().entries;
  expect(entries.some(entry => entry.name === 'club_tab_touch_cancel')).toBe(true);
  expect(entries.filter(entry => entry.name === 'club_tab_selected')).toHaveLength(1);
});

it('keeps locked-tab explanation and accessibility activation independent of touch measurement', () => {
  const { native, onChange, onLockedPress } = button(true);
  native.onPress(); // Accessibility activation need not have a preceding touch.
  expect(onChange).not.toHaveBeenCalled();
  expect(onLockedPress).toHaveBeenCalledTimes(1); expect(onLockedPress).toHaveBeenCalledWith('players');
  expect(native.accessibilityRole).toBe('tab');
  expect(native.accessibilityState).toEqual({ selected: false, disabled: true });
  expect(native.onResponderTerminationRequest).toBeUndefined();
  expect(native.pressRetentionOffset).toBeUndefined();
});

const matchTabs = [
  { key: 'info', label: he.gdTabInfo },
  { key: 'players', label: he.gdTabPlayers },
  { key: 'games', label: he.gdTabGames },
  { key: 'stats', label: he.gdTabStats },
];
const flat = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style ?? {};

it.each(matchTabs)('keeps the complete $label navigation label on one fitting line and preserves its exact action', tab => {
  const onChange = jest.fn(), onLockedPress = jest.fn();
  const root = ClubTabs({ tabs: matchTabs, active: tab.key, onChange, onLockedPress, flush: true });
  const buttons = (React.Children.toArray(root.props.children) as any[]).map(child => child.type(child.props));
  expect(buttons.map(button => button.props.accessibilityLabel)).toEqual(['מידע', 'שחקנים', 'משחקים', 'סטטיסטיקות']);
  const button = buttons.find(button => button.props.accessibilityLabel === tab.label)!;
  const label = (React.Children.toArray(button.props.children) as any[]).find(child => child.type === 'Text');
  expect(label.props.children).toBe(tab.label);
  expect(label.props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.65 });
  expect(flat(label.props.style)).toMatchObject({ flexShrink: 1, minWidth: 0, textAlign: 'center' });
  expect(label.props.allowFontScaling).not.toBe(false);
  expect(flat(button.props.style({ pressed: false }))).toMatchObject({ minHeight: 52, flexDirection: 'row', flexBasis: 'auto' });
  button.props.onPress(); expect(onChange.mock.calls).toEqual([[tab.key]]); expect(onLockedPress).not.toHaveBeenCalled();
});

it('fitting the longest locked label preserves its explanation, selected state and source order', () => {
  const onChange = jest.fn(), onLockedPress = jest.fn();
  const root = ClubTabs({ tabs: matchTabs.map(tab => ({ ...tab, locked: tab.key === 'stats' })), active: 'stats', onChange, onLockedPress, flush: true });
  const buttons = (React.Children.toArray(root.props.children) as any[]).map(child => child.type(child.props));
  const button = buttons[3];
  expect(button.props.accessibilityLabel).toBe('סטטיסטיקות');
  expect(button.props.accessibilityState).toEqual({ selected: false, disabled: true });
  const label = (React.Children.toArray(button.props.children) as any[]).find(child => child.type === 'Text');
  expect(label.props.numberOfLines).toBe(1); expect(label.props.minimumFontScale).toBe(0.65);
  button.props.onPress(); expect(onChange).not.toHaveBeenCalled(); expect(onLockedPress.mock.calls).toEqual([['stats']]);
});
