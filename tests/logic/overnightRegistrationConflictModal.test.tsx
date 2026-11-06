import React from 'react';

// Source component with retained hooks and explicit native adapters. No game
// service is imported, and no registration is cancelled or submitted.
jest.mock('react', () => {
  let slots: any[] = [], cursor = 0;
  return {
    ...jest.requireActual('react'),
    __runtime: { begin: () => { cursor = 0; }, reset: () => { slots = []; cursor = 0; } },
    useState: (initial: any) => {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[i];
      return [slot.value, (next: any) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef: (initial: any) => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
  };
});
jest.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (styles: any) => styles } }));
jest.mock('@/components/SafeModal', () => ({ SafeModal: 'Modal' }));
jest.mock('@/components/Button', () => ({ Button: 'Action' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/theme', () => ({ colors: {}, radius: {}, spacing: {}, typography: {}, RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/theme/overlays', () => ({ overlaySurfaces: { dialog: {} }, overlayTheme: {} }));
jest.mock('@/utils/format', () => ({ formatGameDay: () => 'יום חמישי', formatTime: () => '20:00' }));

import { RegistrationConflictModal } from '@/components/games/RegistrationConflictModal';
import { he } from '@/i18n/he';

const runtime = (require('react') as any).__runtime;
const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(React.Children.toArray(tree.props?.children))];
const find = (tree: any, type: string) => nodes(tree).filter(node => node.type === type);
const action = (tree: any, title: string) => find(tree, 'Action').find(node => node.props.title === title);
const props = () => ({
  conflict: { gameId: 'local-conflict-only', title: 'מחזור לדוגמה', groupId: 'local-community-only', startsAt: 1 },
  communities: [{ id: 'local-community-only', name: 'מועדון לדוגמה' }],
  cancelBusy: false,
  onCancelOther: jest.fn(), onViewOther: jest.fn(), onClose: jest.fn(),
});
const draw = (p: ReturnType<typeof props>) => { runtime.begin(); return RegistrationConflictModal(p); };
function dismiss(tree: any) {
  find(tree, 'Modal')[0].props.onRequestClose();
  find(tree, 'Pressable')[0].props.onPress();
  action(tree, he.registrationConflictClose).props.onPress();
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => { runtime.reset(); jest.clearAllMocks(); });

test('idle dismissal and viewing preserve their existing callbacks and game id', () => {
  const p = props(), tree = draw(p);
  dismiss(tree);
  action(tree, he.registrationConflictViewOther).props.onPress();
  expect(p.onClose).toHaveBeenCalledTimes(3);
  expect(p.onViewOther).toHaveBeenCalledWith(p.conflict.gameId);
  expect(p.onCancelOther).not.toHaveBeenCalled();
});

test('external cancellation blocks every stale dismissal and action until released', async () => {
  const p = props(), idle = draw(p);
  p.cancelBusy = true;
  const busy = draw(p);
  dismiss(idle);
  action(idle, he.registrationConflictViewOther).props.onPress();
  await action(idle, he.registrationConflictCancelOther).props.onPress();
  expect(p.onClose).not.toHaveBeenCalled();
  expect(p.onViewOther).not.toHaveBeenCalled();
  expect(p.onCancelOther).not.toHaveBeenCalled();
  expect(find(busy, 'Action').every(node => node.props.disabled)).toBe(true);
  expect(action(busy, he.registrationConflictCancelOther).props.loading).toBe(true);
  p.cancelBusy = false;
  const released = draw(p);
  dismiss(released);
  expect(p.onClose).toHaveBeenCalledTimes(3);
});

test('pending callback synchronously blocks duplicate cancellation, old back, backdrop and navigation before render', async () => {
  const p = props(), request = deferred();
  p.onCancelOther.mockReturnValueOnce(request.promise);
  const idle = draw(p), pending = action(idle, he.registrationConflictCancelOther).props.onPress();
  await action(idle, he.registrationConflictCancelOther).props.onPress();
  dismiss(idle);
  action(idle, he.registrationConflictViewOther).props.onPress();
  const busy = draw(p);
  expect(p.onCancelOther).toHaveBeenCalledTimes(1);
  expect(p.onCancelOther).toHaveBeenCalledWith(p.conflict.gameId);
  expect(p.onClose).not.toHaveBeenCalled();
  expect(p.onViewOther).not.toHaveBeenCalled();
  expect(action(busy, he.registrationConflictCancelOther).props.loading).toBe(true);
  request.resolve(); await pending;
  expect(p.onClose).not.toHaveBeenCalled();
  dismiss(draw(p));
  expect(p.onClose).toHaveBeenCalledTimes(3);
});

test('rejection unlocks a retry without hiding the conflict or consuming the caller error', async () => {
  const p = props(), request = deferred();
  p.onCancelOther.mockReturnValueOnce(request.promise);
  const pending = action(draw(p), he.registrationConflictCancelOther).props.onPress();
  request.reject(new Error('local failure'));
  await expect(pending).rejects.toThrow('local failure');
  const released = draw(p);
  expect(find(released, 'Modal')[0].props.visible).toBe(true);
  expect(action(released, he.registrationConflictCancelOther).props.loading).toBe(false);
  expect(p.onClose).not.toHaveBeenCalled();
  await action(released, he.registrationConflictCancelOther).props.onPress();
  expect(p.onCancelOther).toHaveBeenCalledTimes(2);
});

test('parent busy remains independent when its async handler catches a failure itself', async () => {
  const p = props(), request = deferred();
  p.onCancelOther.mockImplementation(() => request.promise.catch(() => undefined));
  const idle = draw(p), pending = action(idle, he.registrationConflictCancelOther).props.onPress();
  p.cancelBusy = true; draw(p);
  request.reject(new Error('handled by parent')); await pending;
  dismiss(idle); action(idle, he.registrationConflictViewOther).props.onPress();
  expect(p.onClose).not.toHaveBeenCalled();
  expect(p.onViewOther).not.toHaveBeenCalled();
  p.cancelBusy = false;
  const released = draw(p);
  action(released, he.registrationConflictViewOther).props.onPress();
  expect(p.onViewOther).toHaveBeenCalledTimes(1);
  expect(action(released, he.registrationConflictCancelOther).props.loading).toBe(false);
});

test('synchronous callback is supported and releases locally without changing the conflict flow', async () => {
  const p = props();
  await action(draw(p), he.registrationConflictCancelOther).props.onPress();
  expect(p.onCancelOther).toHaveBeenCalledWith(p.conflict.gameId);
  expect(p.onClose).not.toHaveBeenCalled();
  dismiss(draw(p));
  expect(p.onClose).toHaveBeenCalledTimes(3);
});
