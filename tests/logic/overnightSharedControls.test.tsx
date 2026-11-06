import React from 'react';

// Execute the real controls with retained hook state. Native primitives are
// explicit adapters; these assertions do not claim screen-reader/device QA.
jest.mock('react', () => {
  let slots: any[] = [], cursor = 0, effects: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    ...jest.requireActual('react'),
    __runtime: {
      begin: () => { cursor = 0; },
      flush: () => { const pending = effects; effects = []; pending.forEach(fn => fn()); },
      reset: () => { slots.forEach(slot => slot?.cleanup?.()); slots = []; cursor = 0; effects = []; },
    },
    useState: (initial: any) => {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[i];
      return [slot.value, (next: any) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef: (initial: any) => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useEffect: (effect: any, deps?: any[]) => {
      const i = cursor++;
      if (same(slots[i]?.deps, deps)) return;
      const previous = slots[i], next: any = { deps };
      slots[i] = next;
      effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
    },
  };
});
jest.mock('react-native', () => ({
  View: 'View', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', Image: 'Image', ActivityIndicator: 'Spinner',
  useWindowDimensions: jest.fn(() => ({ width: 320, height: 568, fontScale: 1 })),
  StyleSheet: { create: (styles: any) => styles },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/components/SafeModal', () => ({ SafeModal: 'Modal' }));
jest.mock('@/components/Button', () => ({ Button: 'Action' }));
jest.mock('@/components/anim/SpringSheet', () => ({ SpringSheet: 'Sheet' }));
jest.mock('@/components/InfoTip', () => ({ InfoTip: 'InfoTip' }));
jest.mock('@/components/forms/FormTheme', () => ({ useFormDesign: () => false, formFieldStyle: {} }));
jest.mock('@/utils/errorObservation', () => ({ observeCaughtError: jest.fn() }));
jest.mock('@/theme', () => ({
  colors: { primary: '#1E40AF', text: '#111827', textMuted: '#6B7280', danger: '#EF4444', warning: '#F59E0B', surface: '#FFFFFF' },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 }, radius: { lg: 16 }, typography: {}, RTL_LABEL_ALIGN: 'left',
}));
jest.mock('@/theme/overlays', () => ({ overlaySurfaces: { dialog: {} }, overlayTheme: {} }));
const mockNavigation = { canGoBack: () => true, goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { AutocompleteInput } from '@/components/AutocompleteInput';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AppTimeField } from '@/components/DateTimeFields';
import { he } from '@/i18n/he';

const runtime = (require('react') as any).__runtime;
const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(React.Children.toArray(tree.props?.children))];
const find = (tree: any, type: string) => nodes(tree).filter(node => node.type === type);
function draw(component: (props: any) => any, props: any) {
  runtime.begin(); component(props); runtime.flush();
  runtime.begin(); const tree = component(props); runtime.flush(); return tree;
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const action = (tree: any, title: string) => find(tree, 'Action').find(node => node.props.title === title);
const checkbox = (tree: any) => nodes(tree).find(node => node.props.accessibilityRole === 'checkbox');
const dialogProps = () => ({ visible: true, title: 'אישור פעולה', body: 'תוכן החלון', confirmLabel: 'אישור', cancelLabel: 'חזרה', onConfirm: jest.fn(), onClose: jest.fn() });
const prepare = (kind: 'standard' | 'destructive', p: ReturnType<typeof dialogProps>) => {
  const component = kind === 'standard' ? ConfirmDialog : ConfirmDestructiveModal;
  let tree = draw(component, p);
  if (kind === 'destructive') { checkbox(tree).props.onPress(); tree = draw(component, p); }
  return { component, tree, cancelTitle: kind === 'standard' ? p.cancelLabel : he.cancel };
};

beforeEach(() => { runtime.reset(); jest.clearAllMocks(); });
afterEach(() => { runtime.reset(); jest.useRealTimers(); });

test.each([[1, 44], [2, 52], [3, 74]])('time wheel at font scale %s snaps to the same visible minute', (fontScale, expectedHeight) => {
  require('react-native').useWindowDimensions.mockReturnValue({ width: 320, height: 568, fontScale });
  const before = global.requestAnimationFrame;
  global.requestAnimationFrame = jest.fn();
  try {
    const field = draw(AppTimeField, { label: 'שעה', value: '20:15', onChange: jest.fn() });
    const picker = nodes(field).find(node => node.props.initial === '20:15');
    runtime.reset();
    const modal = draw(picker.type, { ...picker.props, visible: true });
    const minutes = nodes(modal).find(node => node.props.selected === '15');
    runtime.reset();
    const onSelect = jest.fn();
    const wheel = draw(minutes.type, { ...minutes.props, onSelect });
    const [list] = find(wheel, 'ScrollView');
    expect(list.props.snapToInterval).toBe(expectedHeight);
    expect(find(wheel, 'Pressable')[0].props.style[1].height).toBe(expectedHeight);
    list.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { y: 4 * expectedHeight } } });
    expect(onSelect).toHaveBeenCalledWith('20');
  } finally {
    global.requestAnimationFrame = before;
  }
});

describe.each(['standard', 'destructive'] as const)('%s confirmation dismissal', kind => {
  test('the whole confirmation, including its actions, is inside the bounded scroll area', () => {
    const p = { ...dialogProps(), body: 'תיאור ארוך '.repeat(100) };
    const { tree, cancelTitle } = prepare(kind, p);
    const [scroll] = find(tree, 'ScrollView');
    expect(action(scroll, cancelTitle)).toBeDefined();
    expect(action(scroll, p.confirmLabel)).toBeDefined();
    expect(find(scroll, 'Text').some(node => node.props.children === p.body)).toBe(true);
  });
  test('back, backdrop and cancel all close normally before confirmation', () => {
    const p = dialogProps(), { tree, cancelTitle } = prepare(kind, p);
    find(tree, 'Modal')[0].props.onRequestClose();
    find(tree, 'Sheet')[0].props.onBackdropPress();
    action(tree, cancelTitle).props.onPress();
    expect(p.onClose).toHaveBeenCalledTimes(3);
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  test('one pending confirmation blocks repeated press and every stale dismissal before render; failure releases them', async () => {
    const p = dialogProps(), request = deferred(); p.onConfirm.mockReturnValue(request.promise);
    const { component, tree, cancelTitle } = prepare(kind, p);
    const confirm = action(tree, 'אישור'), pending = confirm.props.onPress();
    await confirm.props.onPress();
    find(tree, 'Modal')[0].props.onRequestClose();
    find(tree, 'Sheet')[0].props.onBackdropPress();
    action(tree, cancelTitle).props.onPress();
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
    expect(p.onClose).not.toHaveBeenCalled();
    let busy = draw(component, p);
    expect(action(busy, 'אישור').props.loading).toBe(true);
    expect(action(busy, cancelTitle).props.disabled).toBe(true);
    expect(find(busy, 'Sheet')[0].props.onBackdropPress).toBeUndefined();
    find(busy, 'Modal')[0].props.onRequestClose();
    expect(p.onClose).not.toHaveBeenCalled();
    request.reject(new Error('offline'));
    await expect(pending).rejects.toThrow('offline');
    const released = draw(component, p);
    expect(action(released, 'אישור').props.loading).toBe(false);
    expect(action(released, cancelTitle).props.disabled).toBe(false);
    find(released, 'Modal')[0].props.onRequestClose();
    find(released, 'Sheet')[0].props.onBackdropPress();
    action(released, cancelTitle).props.onPress();
    expect(p.onClose).toHaveBeenCalledTimes(3);
  });

  test('successful acknowledgement releases the request without inventing a close callback', async () => {
    const p = dialogProps(), request = deferred(); p.onConfirm.mockReturnValue(request.promise);
    const { component, tree } = prepare(kind, p);
    const pending = action(tree, 'אישור').props.onPress();
    request.resolve(); await pending;
    const ready = draw(component, p);
    expect(action(ready, 'אישור').props.loading).toBe(false);
    expect(p.onClose).not.toHaveBeenCalled();
    find(ready, 'Modal')[0].props.onRequestClose();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  test('an externally hidden and reopened modal retains an outstanding request lock', async () => {
    const p = dialogProps(), request = deferred(); p.onConfirm.mockReturnValue(request.promise);
    const { component, tree } = prepare(kind, p);
    const pending = action(tree, 'אישור').props.onPress();
    p.visible = false; draw(component, p); p.visible = true;
    const reopened = draw(component, p);
    expect(action(reopened, 'אישור').props.loading).toBe(true);
    find(reopened, 'Modal')[0].props.onRequestClose();
    await action(reopened, 'אישור').props.onPress();
    expect(p.onClose).not.toHaveBeenCalled(); expect(p.onConfirm).toHaveBeenCalledTimes(1);
    request.resolve(); await pending;
    find(draw(component, p), 'Modal')[0].props.onRequestClose();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});

test('destructive acknowledgement is a single named checkbox, required, disabled during a request and reset on reopen', async () => {
  const p = dialogProps(), request = deferred(); p.onConfirm.mockReturnValue(request.promise);
  let tree = draw(ConfirmDestructiveModal, p), check = checkbox(tree);
  expect(check.props).toMatchObject({ accessible: true, accessibilityLabel: he.confirmDeleteAck, accessibilityState: { checked: false, disabled: false } });
  expect(nodes(check).filter(node => node.props.accessible === true)).toHaveLength(1);
  expect(find(check, 'Text')[0].props.accessible).toBe(false);
  expect(action(tree, 'אישור').props.disabled).toBe(true);
  await action(tree, 'אישור').props.onPress(); expect(p.onConfirm).not.toHaveBeenCalled();
  check.props.onPress(); tree = draw(ConfirmDestructiveModal, p);
  expect(checkbox(tree).props.accessibilityState.checked).toBe(true);
  expect(action(tree, 'אישור').props.disabled).toBe(false);
  const pending = action(tree, 'אישור').props.onPress();
  // Even a callback queued from the previous frame cannot change consent.
  checkbox(tree).props.onPress(); tree = draw(ConfirmDestructiveModal, p);
  expect(checkbox(tree).props.accessibilityState).toEqual({ checked: true, disabled: true });
  request.resolve(); await pending;
  p.visible = false; draw(ConfirmDestructiveModal, p); p.visible = true; tree = draw(ConfirmDestructiveModal, p);
  expect(checkbox(tree).props.accessibilityState).toEqual({ checked: false, disabled: false });
  expect(action(tree, 'אישור').props.disabled).toBe(true);
});

const autocompleteProps = () => ({ label: 'עיר', value: 'תל', required: false, disabled: false, onChange: jest.fn(), onSelect: jest.fn(), fetchSuggestions: jest.fn<Promise<string[]>, [string]>().mockResolvedValue(['תל אביב', 'תל מונד']), debounceMs: 300 });
const input = (tree: any) => find(tree, 'TextInput')[0];
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('autocomplete keeps a filled field name and conveys required/disabled without a second visible-label accessibility node', () => {
  const p = autocompleteProps(); p.required = true; p.disabled = true;
  const tree = draw(AutocompleteInput, p);
  expect(input(tree).props).toMatchObject({ accessibilityLabel: 'עיר, שדה חובה', value: 'תל', editable: false, accessibilityState: { disabled: true, busy: false } });
  expect(find(tree, 'Text')[0].props).toMatchObject({ accessible: false, importantForAccessibility: 'no' });
  expect(p.fetchSuggestions).not.toHaveBeenCalled();
});

test('autocomplete labels one loading indicator, exposes named suggestion actions and selects the same real value', async () => {
  jest.useFakeTimers(); const p = autocompleteProps(), request = deferred<string[]>(); p.fetchSuggestions.mockReturnValue(request.promise);
  let tree = draw(AutocompleteInput, p); input(tree).props.onFocus(); tree = draw(AutocompleteInput, p);
  expect(input(tree).props.accessibilityLabel).toBe('עיר');
  expect(input(tree).props.accessibilityState.busy).toBe(true);
  expect(find(tree, 'Spinner')).toHaveLength(1);
  expect(find(tree, 'Spinner')[0].props).toMatchObject({ accessible: true, accessibilityRole: 'progressbar', accessibilityLabel: 'טוען הצעות עבור עיר' });
  jest.advanceTimersByTime(299); expect(p.fetchSuggestions).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1); expect(p.fetchSuggestions).toHaveBeenCalledWith('תל');
  request.resolve(['תל אביב', 'תל מונד']); await settle(); tree = draw(AutocompleteInput, p);
  const suggestions = find(tree, 'Pressable');
  expect(suggestions.map(node => node.props.accessibilityLabel)).toEqual(['תל אביב', 'תל מונד']);
  for (const node of suggestions) {
    expect(node.props).toMatchObject({ accessible: true, accessibilityRole: 'button' });
    expect(find(node, 'Text')[0].props.accessible).toBe(false);
  }
  expect(find(tree, 'Spinner')).toHaveLength(0);
  suggestions[1].props.onPress(); tree = draw(AutocompleteInput, p);
  expect(p.onSelect).toHaveBeenCalledTimes(1); expect(p.onSelect).toHaveBeenCalledWith('תל מונד');
  expect(find(tree, 'Pressable')).toHaveLength(0);
});

test('autocomplete retains exact-match acceptance and ignores a late response after the field is disabled', async () => {
  jest.useFakeTimers(); const p = autocompleteProps(); p.value = 'תל אביב';
  let tree = draw(AutocompleteInput, p); input(tree).props.onFocus(); draw(AutocompleteInput, p);
  jest.advanceTimersByTime(300); await settle(); tree = draw(AutocompleteInput, p);
  expect(p.onSelect).toHaveBeenCalledTimes(1); expect(p.onSelect).toHaveBeenCalledWith('תל אביב');
  expect(find(tree, 'Pressable')).toHaveLength(0);
  const late = deferred<string[]>(); p.fetchSuggestions.mockReturnValue(late.promise); p.value = 'הר';
  tree = draw(AutocompleteInput, p); input(tree).props.onChangeText('הר'); draw(AutocompleteInput, p);
  jest.advanceTimersByTime(300); p.disabled = true; draw(AutocompleteInput, p);
  late.resolve(['הרצליה']); await settle(); tree = draw(AutocompleteInput, p);
  expect(input(tree).props.accessibilityState).toEqual({ disabled: true, busy: false });
  expect(find(tree, 'Pressable')).toHaveLength(0); expect(p.onSelect).toHaveBeenCalledTimes(1);
});

test('header actions preserve explicit Hebrew names, expose buttons once and keep badge/icon decoration silent', () => {
  const open = jest.fn();
  const tree = ScreenHeader({ title: 'חברים', actions: [{ icon: 'mail-outline', label: 'חברים והזמנות, 120 ממתינות', badge: 120, onPress: open }] });
  const buttons = find(tree, 'Pressable');
  expect(buttons.map(node => node.props.accessibilityLabel)).toEqual(['חזרה', 'חברים והזמנות, 120 ממתינות']);
  expect(buttons.every(node => node.props.accessibilityRole === 'button')).toBe(true);
  expect(buttons[1].props.accessible).toBe(true);
  expect(find(buttons[1], 'Icon')[0].props.accessible).toBe(false);
  expect(find(buttons[1], 'View')[0].props).toMatchObject({ accessible: false, importantForAccessibility: 'no-hide-descendants' });
  buttons[1].props.onPress(); expect(open).toHaveBeenCalledTimes(1);
  buttons[0].props.onPress(); expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
});
