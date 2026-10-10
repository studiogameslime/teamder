import React from 'react';

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (v: unknown) => [v, jest.fn()],
  useRef: (v: unknown) => ({ current: v }),
  useEffect: jest.fn(),
  useCallback: (fn: unknown) => fn,
}));
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable',
  PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) },
  StyleSheet: { create: (s: unknown) => s },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' },
  useSharedValue: (value: unknown) => ({ value }),
  useAnimatedStyle: () => ({}),
  Easing: { out: (v: unknown) => v, cubic: () => 0 }, withTiming: (v: unknown) => v,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/utils/haptics', () => ({ selectionHaptic: jest.fn() }));
jest.mock('@/components/InfoTip', () => ({ InfoTip: 'InfoTip' }));
jest.mock('@/theme', () => ({
  colors: { border: '#ccc', primary: '#00f', textMuted: '#777' },
  radius: {}, spacing: {}, typography: {}, RTL_LABEL_ALIGN: 'left',
}));

import { RatingSlider } from '@/components/RatingSlider';
import { RangeSlider } from '@/components/RangeSlider';
import { InputField } from '@/components/InputField';
import { he } from '@/i18n/he';

function find(node: any, predicate: (p: any) => boolean): any {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node.props ?? {})) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}
const action = (name: string) => ({ nativeEvent: { actionName: name } });

describe('accessible controls without touch gestures', () => {
  test('rating changes by the business step and clamps both limits', () => {
    for (const [value, name, expected] of [[3.5, 'increment', 3.6], [3.5, 'decrement', 3.4], [5, 'increment', 5], [0, 'decrement', 0]] as const) {
      const onChange = jest.fn();
      const control = find(RatingSlider({ value, onChange }), p => p.accessibilityRole === 'adjustable');
      control.props.onAccessibilityAction(action(name));
      expect(onChange).toHaveBeenCalledWith(expected);
    }
  });
  test('unrated and readonly values keep their distinct meanings', () => {
    const unrated = find(RatingSlider({ value: 0 }), p => p.accessibilityRole === 'adjustable');
    expect(unrated.props.accessibilityValue.text).toBe(he.ratingNotRated);
    const onChange = jest.fn();
    const readonly = find(RatingSlider({ value: 3.5, onChange, readonly: true }), p => p.accessibilityRole === 'text');
    readonly.props.onAccessibilityAction(action('increment'));
    expect(onChange).not.toHaveBeenCalled();
    expect(readonly.props.accessibilityActions).toEqual([]);
  });
  test('range uses its supplied step relative to min, and ignores disabled actions', () => {
    const onChange = jest.fn();
    const control = RangeSlider({ min: 3, max: 11, step: 2, value: 5, onChange, accessibilityLabel: 'רדיוס' });
    control.props.onAccessibilityAction(action('increment'));
    expect(onChange).toHaveBeenLastCalledWith(7);
    control.props.onAccessibilityAction(action('decrement'));
    expect(onChange).toHaveBeenLastCalledWith(3);
    const disabled = RangeSlider({ min: 3, max: 11, step: 2, value: 5, onChange, disabled: true });
    onChange.mockClear();
    disabled.props.onAccessibilityAction(action('increment'));
    expect(onChange).not.toHaveBeenCalled();
    expect(disabled.props.accessibilityState.disabled).toBe(true);
  });
  test('disabled controls ignore even a gesture already dispatched before the disabled state', () => {
    const onChange = jest.fn();
    const rating = find(RatingSlider({ value: 3.5, onChange, readonly: true }), p => p.accessibilityRole === 'text');
    rating.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
    rating.props.onPanResponderMove({ nativeEvent: { locationX: 120 } });
    const range = RangeSlider({ min: 3, max: 11, step: 2, value: 5, onChange, disabled: true });
    range.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
    range.props.onPanResponderGrant({ nativeEvent: { locationX: 120 } });
    range.props.onPanResponderMove({}, { moveX: 120 });
    expect(onChange).not.toHaveBeenCalled();
  });
  test('a filled input keeps its field name; a picker conveys name, value and disabled state', () => {
    const input = find(InputField({ label: 'שם שחקן', value: 'אלירן' }), p => p.value === 'אלירן');
    expect(input.props.accessibilityLabel).toBe('שם שחקן');
    const picker = find(InputField({ label: 'מיקום המגרש', value: 'אור יהודה', onPress: jest.fn(), editable: false }), p => p.accessibilityRole === 'button');
    expect(picker.props.accessibilityLabel).toBe('מיקום המגרש');
    expect(picker.props.accessibilityValue.text).toBe('אור יהודה');
    expect(picker.props.accessibilityState.disabled).toBe(true);
    const override = find(InputField({ label: 'שם', accessibilityLabel: 'שם מלא', value: 'אלירן' }), p => p.value === 'אלירן');
    expect(override.props.accessibilityLabel).toBe('שם מלא');
  });
});
