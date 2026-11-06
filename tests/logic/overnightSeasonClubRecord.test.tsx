import React from 'react';

// Retained hooks run the source component. The only async dependency is a
// local Promise adapter; no server, season mutation or share is performed.
jest.mock('react', () => {
  let slots: any[] = [], cursor = 0, effects: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    ...jest.requireActual('react'),
    __runtime: {
      begin: () => { cursor = 0; },
      flush: () => { const pending = effects; effects = []; pending.forEach(f => f()); },
      reset: () => { slots.forEach(s => s?.cleanup?.()); slots = []; cursor = 0; effects = []; },
    },
    useState: (initial: any) => { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; const s = slots[i]; return [s.value, (next: any) => { s.value = typeof next === 'function' ? next(s.value) : next; }]; },
    useMemo: (factory: any) => factory(),
    useRef: (initial: any) => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useEffect: (effect: any, deps?: any[]) => { const i = cursor++; if (same(slots[i]?.deps, deps)) return; const previous = slots[i], next: any = { deps }; slots[i] = next; effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); }); },
  };
});
jest.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View', ScrollView: 'ScrollView', StyleSheet: { create: (s: any) => s } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/components/SafeModal', () => ({ SafeModal: 'Modal' }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/components/chemistry/ChemistrySection', () => ({ ChemistrySection: 'Chemistry' }));
jest.mock('@/components/SeasonTitleEmblem', () => ({ SeasonTitleEmblem: 'Emblem' }));
jest.mock('@/components/summary/SeasonSummaryIcon', () => ({ SeasonSummaryIcon: 'SummaryIcon' }));
jest.mock('@/theme', () => ({ colors: { primary: '#26F', text: '#123', textMuted: '#666', surface: '#fff' }, RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/utils/errorObservation', () => ({ observeCaughtError: jest.fn() }));
jest.mock('@/services/roundSummaryService', () => ({ roundSummaryService: { listEveningStats: jest.fn() } }));

import { SeasonClubSummary } from '@/components/summary/SeasonClubSummary';
import { roundSummaryService } from '@/services/roundSummaryService';
import type { SeasonSummaryModel } from '@/services/seasonSummaryService';
const runtime = (require('react') as any).__runtime;
const read = roundSummaryService.listEveningStats as jest.Mock;
const model = (patch: Record<string, unknown> = {}) => ({ groupId: 'local-group', seasonId: 's1', startsAt: 100, endsAt: 200, closed: true, completedRounds: 5, names: {}, peerAvatars: {}, seasonTitles: [], club: { numbers: { goals: 25, topScorerShare: 0.4 }, pairs: {}, pairsComplete: false, leaders: [] }, ...patch } as unknown as SeasonSummaryModel);
const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(React.Children.toArray(tree.props?.children))];
const text = (tree: any) => nodes(tree).filter(n => n.type === 'Text').map(n => React.Children.toArray(n.props.children).filter(x => typeof x !== 'object').join('')).join(' ');
function draw(value: SeasonSummaryModel) { runtime.begin(); SeasonClubSummary({ model: value }); runtime.flush(); runtime.begin(); const tree = SeasonClubSummary({ model: value }); runtime.flush(); return tree; }
function deferred() { let resolve!: (value: any) => void, reject!: (e: Error) => void; const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const result = (goals: number, at = 150, truncated = false) => ({ evenings: [{ gameId: 'local-evening', at, goals, rounds: 2, shootouts: 0, hasRoundHistory: true }], truncated });
const retry = (tree: any) => nodes(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'נסה שוב לטעון את שיא המחזור');
beforeEach(() => { runtime.reset(); jest.clearAllMocks(); });
afterEach(() => runtime.reset());

test('a pending bounded read is loading rather than an assertion that no record exists', () => {
  const request = deferred(), value = model(); read.mockReturnValue(request.promise);
  const tree = draw(value);
  expect(text(tree)).toContain('טוענים את שיא המחזור');
  expect(text(tree)).not.toContain('אין נתון מתועד');
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith('local-group', { from: 100, to: 200 });
});

test('failure exposes an error and retry; a successful retry uses the existing record calculation', async () => {
  const first = deferred(), second = deferred(), value = model(); read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  draw(value); first.reject(new Error('local read failure')); await tick();
  let tree = draw(value);
  expect(text(tree)).toContain('לא הצלחנו לטעון את שיא המחזור');
  expect(text(tree)).not.toContain('אין נתון מתועד');
  retry(tree).props.onPress(); tree = draw(value);
  expect(text(tree)).toContain('טוענים את שיא המחזור');
  expect(read).toHaveBeenCalledTimes(2);
  second.resolve(result(12)); await tick(); tree = draw(value);
  expect(text(tree)).toContain('12 שערים');
  expect(text(tree)).not.toContain('לא הצלחנו לטעון');
  expect(text(tree)).not.toContain('טוענים את שיא');
});

test('only a completed empty read reports that no record is documented', async () => {
  const value = model(); read.mockResolvedValue({ evenings: [], truncated: false }); draw(value); await tick();
  const tree = draw(value);
  expect(text(tree)).toContain('אין נתון מתועד');
  expect(text(tree)).not.toContain('לא הצלחנו לטעון');
  expect(text(tree)).not.toContain('טוענים את שיא');
});

test('a verified record remains visible during same-scope refresh and refresh failure', async () => {
  const first = deferred(), refresh = deferred(), value = model(); read.mockReturnValueOnce(first.promise).mockReturnValueOnce(refresh.promise);
  draw(value); first.resolve(result(12, 150, true)); await tick(); expect(text(draw(value))).toContain('12 שערים');
  const updated = { ...value }; let tree = draw(updated);
  expect(text(tree)).toContain('12 שערים'); expect(text(tree)).toContain('טוענים את שיא המחזור');
  refresh.reject(new Error('local refresh failure')); await tick(); tree = draw(updated);
  expect(text(tree)).toContain('12 שערים'); expect(text(tree)).toContain('לא הצלחנו לטעון את שיא המחזור');
  expect(text(tree)).toContain('400 המחזורים'); expect(retry(tree)).toBeDefined();
});

test('switching season hides the old value immediately and ignores an older response', async () => {
  const old = deferred(), current = deferred(), first = model(), second = model({ seasonId: 's2', startsAt: 300, endsAt: 400 });
  read.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  draw(first); draw(second); old.resolve(result(99)); await tick();
  expect(text(draw(second))).not.toContain('99 שערים');
  current.resolve(result(3, 350)); await tick();
  expect(text(draw(second))).toContain('3 שערים');
  expect(read).toHaveBeenLastCalledWith('local-group', { from: 300, to: 400 });
});

test('an A to B to A return cannot accept the first request for the same season key', async () => {
  const old = deferred(), middle = deferred(), fresh = deferred(), a = model(), b = model({ groupId: 'other-group' }), again = model();
  read.mockReturnValueOnce(old.promise).mockReturnValueOnce(middle.promise).mockReturnValueOnce(fresh.promise);
  draw(a); draw(b); draw(again); old.resolve(result(99)); middle.reject(new Error('stale failure')); await tick();
  let tree = draw(again); expect(text(tree)).not.toContain('99 שערים'); expect(text(tree)).not.toContain('לא הצלחנו לטעון');
  fresh.resolve(result(4)); await tick(); tree = draw(again); expect(text(tree)).toContain('4 שערים');
});

test('explicit model record and explicit null are ready data and never start a fallback read', () => {
  const known = { key: 'goals', value: 7, gameId: 'local-evening', at: 150, holders: ['local-evening'] };
  const value = model(); value.club!.mostGoalsEvening = known as any;
  expect(text(draw(value))).toContain('7 שערים');
  const empty = model(); empty.club!.mostGoalsEvening = null;
  const tree = draw(empty); expect(text(tree)).toContain('אין נתון מתועד'); expect(read).not.toHaveBeenCalled();
});

test('missing time boundary does not issue an unscoped query or claim an empty season record', () => {
  const tree = draw(model({ startsAt: undefined }));
  expect(read).not.toHaveBeenCalled(); expect(text(tree)).toContain('טווח העונה אינו זמין');
  expect(text(tree)).not.toContain('אין נתון מתועד');
});
