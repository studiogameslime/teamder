import React from 'react';

// The real source component runs with retained hooks and explicit native
// adapters. No account or authentication service is imported or called.
jest.mock('react', () => {
  let slots: any[] = [], cursor = 0, effects: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return {
    ...jest.requireActual('react'),
    __runtime: {
      begin: () => { cursor = 0; },
      flush: () => { const pending = effects; effects = []; pending.forEach(effect => effect()); },
      reset: () => { slots.forEach(slot => slot?.cleanup?.()); slots = []; cursor = 0; effects = []; },
    },
    useState: (initial: any) => {
      const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[i]; return [slot.value, (next: any) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef: (initial: any) => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useEffect: (effect: any, deps?: any[]) => {
      const i = cursor++; if (same(slots[i]?.deps, deps)) return;
      const previous = slots[i], next: any = { deps }; slots[i] = next;
      effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
    },
  };
});
jest.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', TextInput: 'Input', View: 'View', StyleSheet: { create: (styles: any) => styles } }));
jest.mock('@/components/SafeModal', () => ({ SafeModal: 'Modal' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/components/anim/SpringSheet', () => ({ SpringSheet: 'Sheet' }));
jest.mock('@/components/Button', () => ({ Button: 'Action' }));
jest.mock('@/theme', () => ({ colors: {}, radius: {}, spacing: {}, typography: {}, RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/theme/overlays', () => ({ overlaySurfaces: { sheet: {} } }));
jest.mock('@/services/analyticsService', () => ({ AnalyticsEvent: { AccountDeleteCancelled: 'cancelled' }, logEvent: jest.fn() }));

import { DeleteAccountSheet } from '@/components/profile/DeleteAccountSheet';
import { logEvent } from '@/services/analyticsService';
import { he } from '@/i18n/he';

const runtime = (require('react') as any).__runtime;
const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(React.Children.toArray(tree.props?.children))];
const find = (tree: any, type: string) => nodes(tree).filter(node => node.type === type);
const props = () => ({ visible: true, loading: false, requirePassword: true, onCancel: jest.fn(), onConfirm: jest.fn() });
function draw(p: ReturnType<typeof props>) {
  runtime.begin(); DeleteAccountSheet(p); runtime.flush();
  runtime.begin(); const tree = DeleteAccountSheet(p); runtime.flush(); return tree;
}
const submit = (tree: any) => find(tree, 'Action')[0];
const cancel = (tree: any) => find(tree, 'Pressable').find(node => node.props.accessibilityLabel === he.profileDeleteAccountCancel);
const eye = (tree: any) => find(tree, 'Pressable').find(node => ['הצג סיסמה', 'הסתר סיסמה'].includes(node.props.accessibilityLabel));
function arm(p: ReturnType<typeof props>) {
  let tree = draw(p); find(tree, 'Input')[0].props.onChangeText(he.profileDeleteAccountConfirmWord);
  if (p.requirePassword) find(tree, 'Input')[1].props.onChangeText('local-only-password');
  return draw(p);
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => { runtime.reset(); jest.clearAllMocks(); });
afterEach(() => runtime.reset());

test('external loading blocks every existing close/edit/reveal callback without clearing the typed values', async () => {
  const p = props(), ready = arm(p);
  eye(ready).props.onPress(); const revealed = draw(p); expect(find(revealed, 'Input')[1].props.secureTextEntry).toBe(false);
  p.loading = true; let busy = draw(p);
  find(ready, 'Modal')[0].props.onRequestClose(); find(ready, 'Sheet')[0].props.onBackdropPress(); cancel(ready).props.onPress();
  find(ready, 'Input')[0].props.onChangeText('changed'); find(ready, 'Input')[1].props.onChangeText('changed'); eye(ready).props.onPress();
  await submit(ready).props.onPress(); busy = draw(p);
  expect(p.onCancel).not.toHaveBeenCalled(); expect(logEvent).not.toHaveBeenCalled(); expect(p.onConfirm).not.toHaveBeenCalled();
  expect(find(busy, 'Input').map(node => node.props.editable)).toEqual([false, false]);
  expect(find(busy, 'Input').map(node => node.props.value)).toEqual([he.profileDeleteAccountConfirmWord, 'local-only-password']);
  expect(find(busy, 'Input')[1].props.secureTextEntry).toBe(true);
  expect(eye(busy).props).toMatchObject({ disabled: true, accessibilityState: { disabled: true } });
  expect(cancel(busy).props.disabled).toBe(true); expect(submit(busy).props.loading).toBe(true);
  expect(find(busy, 'Sheet')[0].props.onBackdropPress).toBeUndefined();
  p.loading = false; const released = draw(p);
  expect(find(released, 'Input').map(node => node.props.editable)).toEqual([true, true]);
  expect(find(released, 'Input').map(node => node.props.value)).toEqual([he.profileDeleteAccountConfirmWord, 'local-only-password']);
  expect(find(released, 'Input')[1].props.secureTextEntry).toBe(true); expect(submit(released).props.disabled).toBe(false);
});

test('a pending callback synchronously blocks double confirmation and stale close/edit callbacks; rejection preserves a retry', async () => {
  const p = props(), request = deferred(); p.onConfirm.mockReturnValueOnce(request.promise);
  const ready = arm(p), pending = submit(ready).props.onPress();
  await submit(ready).props.onPress();
  find(ready, 'Modal')[0].props.onRequestClose(); find(ready, 'Sheet')[0].props.onBackdropPress(); cancel(ready).props.onPress();
  find(ready, 'Input')[0].props.onChangeText(''); find(ready, 'Input')[1].props.onChangeText(''); eye(ready).props.onPress();
  let tree = draw(p);
  expect(p.onConfirm).toHaveBeenCalledTimes(1); expect(p.onConfirm).toHaveBeenCalledWith('local-only-password');
  expect(p.onCancel).not.toHaveBeenCalled(); expect(logEvent).not.toHaveBeenCalled();
  expect(submit(tree).props).toMatchObject({ disabled: true, loading: true });
  expect(find(tree, 'Input').every(node => node.props.editable === false)).toBe(true);
  request.reject(new Error('offline')); await expect(pending).rejects.toThrow('offline'); tree = draw(p);
  expect(submit(tree).props).toMatchObject({ disabled: false, loading: false });
  expect(find(tree, 'Input').map(node => node.props.value)).toEqual([he.profileDeleteAccountConfirmWord, 'local-only-password']);
  await submit(tree).props.onPress(); expect(p.onConfirm).toHaveBeenCalledTimes(2);
  expect(p.onConfirm).toHaveBeenLastCalledWith('local-only-password'); expect(p.onCancel).not.toHaveBeenCalled();
});

test('resolution cannot unlock an independent parent loading flag, and clearing it restores cancellation with a single log', async () => {
  const p = props(), request = deferred(); p.onConfirm.mockReturnValue(request.promise);
  const pending = submit(arm(p)).props.onPress(); p.loading = true; draw(p);
  request.resolve(); await pending; let tree = draw(p);
  expect(submit(tree).props.loading).toBe(true);
  find(tree, 'Modal')[0].props.onRequestClose(); cancel(tree).props.onPress(); expect(p.onCancel).not.toHaveBeenCalled();
  p.loading = false; tree = draw(p); cancel(tree).props.onPress();
  expect(p.onCancel).toHaveBeenCalledTimes(1); expect(logEvent).toHaveBeenCalledTimes(1);
  expect(find(draw(p), 'Input').map(node => node.props.value)).toEqual(['', '']);
});

test('a parent that handles its own asynchronous failure still releases the local lock and retains the entered values', async () => {
  const p = props(), request = deferred();
  p.onConfirm.mockImplementation(async () => { p.loading = true; try { await request.promise; } catch { /* owner displays the error */ } finally { p.loading = false; } });
  const pending = submit(arm(p)).props.onPress(); draw(p);
  request.reject(new Error('local test failure')); await pending; const tree = draw(p);
  expect(submit(tree).props).toMatchObject({ disabled: false, loading: false });
  expect(find(tree, 'Input').map(node => node.props.value)).toEqual([he.profileDeleteAccountConfirmWord, 'local-only-password']);
  expect(p.onCancel).not.toHaveBeenCalled(); expect(logEvent).not.toHaveBeenCalled();
});

test('hide and reopen during a request do not lose the request lock or entered values', async () => {
  const p = props(), request = deferred(); p.onConfirm.mockReturnValue(request.promise);
  const pending = submit(arm(p)).props.onPress(); p.visible = false; draw(p); p.visible = true; let tree = draw(p);
  await submit(tree).props.onPress(); find(tree, 'Modal')[0].props.onRequestClose();
  expect(p.onConfirm).toHaveBeenCalledTimes(1); expect(p.onCancel).not.toHaveBeenCalled(); expect(submit(tree).props.loading).toBe(true);
  request.resolve(); await pending; tree = draw(p);
  expect(submit(tree).props.loading).toBe(false);
  expect(find(tree, 'Input').map(node => node.props.value)).toEqual([he.profileDeleteAccountConfirmWord, 'local-only-password']);
});

test('confirmation requires the typed word and password when configured, even if the callback is invoked directly', async () => {
  const p = props(); let tree = draw(p); await submit(tree).props.onPress();
  find(tree, 'Input')[0].props.onChangeText('לא'); tree = draw(p); await submit(tree).props.onPress();
  find(tree, 'Input')[0].props.onChangeText(he.profileDeleteAccountConfirmWord); tree = draw(p); await submit(tree).props.onPress();
  expect(p.onConfirm).not.toHaveBeenCalled(); expect(submit(tree).props.disabled).toBe(true);
  find(tree, 'Input')[1].props.onChangeText('local-only-password'); tree = draw(p); await submit(tree).props.onPress();
  expect(p.onConfirm).toHaveBeenCalledTimes(1); expect(p.onConfirm).toHaveBeenCalledWith('local-only-password');
});

test('a synchronous callback remains supported and the password is omitted when not required', async () => {
  const p = props(); p.requirePassword = false; const ready = arm(p);
  expect(find(ready, 'Input')).toHaveLength(1); const pending = submit(ready).props.onPress();
  await submit(ready).props.onPress(); await pending;
  expect(p.onConfirm).toHaveBeenCalledTimes(1); expect(p.onConfirm).toHaveBeenCalledWith(undefined);
  const tree = draw(p); expect(submit(tree).props.loading).toBe(false);
  find(tree, 'Modal')[0].props.onRequestClose(); expect(p.onCancel).toHaveBeenCalledTimes(1);
});
