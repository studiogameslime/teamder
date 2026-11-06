jest.mock('react', () => {
  let slots: any[] = [], cursor = 0, pending: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return {
    __runtime: {
      begin: () => { cursor = 0; },
      flush: () => { const effects = pending; pending = []; effects.forEach(effect => effect()); },
      reset: () => { slots.forEach(slot => slot?.cleanup?.()); slots = []; cursor = 0; pending = []; },
    },
    useRef: (initial: any) => { const slot = cursor++; return slots[slot] ?? (slots[slot] = { current: initial }); },
    useEffect: (effect: any, deps: any[]) => {
      const slot = cursor++;
      if (!same(slots[slot]?.deps, deps)) {
        const previous = slots[slot]; slots[slot] = { deps };
        pending.push(() => { previous?.cleanup?.(); slots[slot].cleanup = effect(); });
      }
    },
  };
});
const mockListeners = new Map<string, (event: any) => void>();
const mockNavigation = {
  addListener: jest.fn((event: string, callback: any) => { mockListeners.set(event, callback); return () => mockListeners.delete(event); }),
  dispatch: jest.fn(),
};
let mockTabGuard: any;
const mockRegisterTab = jest.fn((guard: any) => { mockTabGuard = guard; return () => { mockTabGuard = undefined; }; });
jest.mock('react-native', () => ({}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('@/navigation/tabLeaveGuard', () => ({ registerTabLeaveGuard: (guard: any) => mockRegisterTab(guard) }));
jest.mock('@/components/AppDialog', () => ({ appAlert: jest.fn() }));
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { appAlert } from '@/components/AppDialog';
import { he } from '@/i18n/he';
const runtime = (require('react') as any).__runtime;
const alert = appAlert as jest.Mock;
const render = (options: Parameters<typeof useUnsavedChangesGuard>[0]) => {
  runtime.begin(); const saving = useUnsavedChangesGuard(options); runtime.flush(); return saving;
};
const attemptBack = () => {
  const preventDefault = jest.fn(), action = { type: 'GO_BACK' };
  mockListeners.get('beforeRemove')!({ preventDefault, data: { action } });
  return { preventDefault, action };
};
const lastOption = (label: string) => alert.mock.calls[alert.mock.calls.length - 1][2].find((button: any) => button.text === label);
beforeEach(() => { runtime.reset(); mockListeners.clear(); jest.clearAllMocks(); });

test.each(['back', 'tab'])('%s warning saves current notification-shaped values after rerender without reinstalling listeners', async kind => {
  const persist = jest.fn();
  const firstPrefs = { marketingPush: true, gameReminders: true };
  const latestPrefs = { marketingPush: false, gameReminders: true };
  render({ isDirty: false, onSave: () => persist(firstPrefs) });
  render({ isDirty: true, onSave: () => persist(latestPrefs) });
  if (kind === 'back') attemptBack(); else mockTabGuard.confirmLeave(jest.fn());
  await lastOption(he.profileEditUnsavedSave).onPress();
  expect(persist).toHaveBeenCalledWith(latestPrefs);
  expect(persist).not.toHaveBeenCalledWith(firstPrefs);
  expect(mockNavigation.addListener).toHaveBeenCalledTimes(1);
  expect(mockRegisterTab).toHaveBeenCalledTimes(1);
});

test('a dialog opened before rerender also uses the current save callback when its button is pressed', async () => {
  const oldSave = jest.fn(), latestSave = jest.fn();
  render({ isDirty: true, onSave: oldSave }); attemptBack();
  const saveButton = lastOption(he.profileEditUnsavedSave);
  render({ isDirty: true, onSave: latestSave });
  await saveButton.onPress();
  expect(oldSave).not.toHaveBeenCalled(); expect(latestSave).toHaveBeenCalledTimes(1);
});

test.each(['back', 'tab'])('%s warning reads current copy and returns to defaults when overrides are removed', kind => {
  const options = { isDirty: true, onSave: jest.fn(), title: 'כותרת ישנה', body: 'תוכן ישן' };
  render(options); render({ ...options, title: 'כותרת עדכנית', body: 'תוכן עדכני' });
  if (kind === 'back') attemptBack(); else mockTabGuard.confirmLeave(jest.fn());
  expect(alert.mock.calls.at(-1)?.slice(0, 2)).toEqual(['כותרת עדכנית', 'תוכן עדכני']);
  render({ isDirty: true, onSave: options.onSave });
  if (kind === 'back') attemptBack(); else mockTabGuard.confirmLeave(jest.fn());
  expect(alert.mock.calls.at(-1)?.slice(0, 2)).toEqual([he.profileEditUnsavedTitle, he.profileEditUnsavedBody]);
});

test('both listeners consult a replacement savingRef rather than the first reference', () => {
  const first = { current: false }, latest = { current: true }, onSave = jest.fn();
  render({ isDirty: true, savingRef: first, onSave });
  render({ isDirty: true, savingRef: latest, onSave });
  expect(attemptBack().preventDefault).not.toHaveBeenCalled(); expect(mockTabGuard.isDirty()).toBe(false);
  expect(alert).not.toHaveBeenCalled();
  first.current = true; latest.current = false;
  expect(attemptBack().preventDefault).toHaveBeenCalledTimes(1); expect(mockTabGuard.isDirty()).toBe(true);
});

test('the internal saving ref and dirty updates preserve legitimate save navigation', () => {
  const onSave = jest.fn();
  const ref = render({ isDirty: false, onSave });
  expect(attemptBack().preventDefault).not.toHaveBeenCalled();
  expect(render({ isDirty: true, onSave })).toBe(ref);
  ref.current = true;
  expect(attemptBack().preventDefault).not.toHaveBeenCalled(); expect(mockTabGuard.isDirty()).toBe(false);
  ref.current = false;
  expect(attemptBack().preventDefault).toHaveBeenCalledTimes(1);
});

test('discard keeps the original navigation action, tab proceed and cleanup semantics', () => {
  render({ isDirty: true, onSave: jest.fn() });
  const { action } = attemptBack(); lastOption(he.profileEditUnsavedDiscard).onPress();
  expect(mockNavigation.dispatch).toHaveBeenCalledWith(action);
  const proceed = jest.fn(); mockTabGuard.confirmLeave(proceed); lastOption(he.profileEditUnsavedDiscard).onPress();
  expect(proceed).toHaveBeenCalledTimes(1);
  runtime.reset(); expect(mockListeners.size).toBe(0); expect(mockTabGuard).toBeUndefined();
});
