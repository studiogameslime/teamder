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
