import React from 'react';

let mockAllowed = true;
let mockEffect: (() => (() => void)) | undefined;
const mockProgress = { value: 1 };
jest.mock('react', () => ({ ...jest.requireActual('react'), useEffect: (effect: () => (() => void)) => { mockEffect = effect; } }));
jest.mock('react-native', () => ({ StyleSheet: { create: (styles: unknown) => styles } }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Line: 'Line', Path: 'Path', Rect: 'Rect' }));
jest.mock('@/hooks/animations/useAmbientMotion', () => ({ useAmbientMotion: () => mockAllowed }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' },
  useSharedValue: () => mockProgress, useAnimatedStyle: (worklet: () => unknown) => worklet(),
  cancelAnimation: jest.fn(), Easing: { cubic: 'cubic', inOut: (value: unknown) => value },
  withDelay: jest.fn((_delay: number, animation: number) => animation),
  withTiming: jest.fn((value: number) => value),
}));
import { cancelAnimation, withTiming } from 'react-native-reanimated';
import { PairChemistryIcon } from '@/components/chemistry/PairChemistryIcon';

function mount(active = true) {
  PairChemistryIcon({ kind: 'winningDuo', active });
  if (!mockEffect) throw new Error('Missing lifecycle effect');
  return mockEffect();
}
beforeEach(() => { jest.clearAllMocks(); mockAllowed = true; mockEffect = undefined; mockProgress.value = 1; });

test('a hidden club tab stays still even when the app otherwise allows motion', () => {
  mount(false);
  expect(withTiming).not.toHaveBeenCalled();
  expect(mockProgress.value).toBe(1);
});
test('reduced motion, background or scrolling gates keep a static category icon', () => {
  mockAllowed = false;
  mount();
  expect(withTiming).not.toHaveBeenCalled();
  expect(mockProgress.value).toBe(1);
});
test('losses stay still rather than animating a negative result', () => {
  PairChemistryIcon({ kind: 'mostLosses' });
  if (!mockEffect) throw new Error('Missing lifecycle effect');
  mockEffect();
  expect(withTiming).not.toHaveBeenCalled();
  expect(mockProgress.value).toBe(1);
});
test('visible motion is a finite burst and is cancelled on unmount', () => {
  const cleanup = mount();
  expect(withTiming).toHaveBeenCalledTimes(1);
  const [endpoint, options] = (withTiming as jest.Mock).mock.calls[0];
  expect(endpoint).toBe(1);
  expect(options.duration).toBeGreaterThan(0);
  expect(options.duration).toBeLessThan(3000);
  jest.mocked(cancelAnimation).mockClear();
  cleanup();
  expect(cancelAnimation).toHaveBeenCalledWith(mockProgress);
});
