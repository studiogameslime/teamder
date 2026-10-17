import React from 'react';

let mockDimensions = { width: 390, height: 844, fontScale: 1 };

// Exercise the real component handlers and effects. Native rendering is
// verified separately; these tests focus on the save/selection contract.
jest.mock('react', () => {
  let slots: any[] = [], index = 0, effects: Array<() => void> = [], writes = 0;
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return { ...jest.requireActual('react'),
    __runtime: {
      begin: () => { index = 0; },
      finish: () => { const pending = effects; effects = []; pending.forEach(effect => effect()); },
      reset: () => { slots.forEach(slot => slot?.cleanup?.()); slots = []; index = 0; effects = []; writes = 0; },
      unmount: () => slots.forEach(slot => slot?.cleanup?.()),
      writes: () => writes,
    },
    useRef: (value: unknown) => { const i = index++; return slots[i] ?? (slots[i] = { current: value }); },
    useState: (initial: unknown) => { const i = index++; if (!slots[i]) slots[i] = { value: initial }; return [slots[i].value, (next: any) => { writes++; slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const i = index++; if (!same(slots[i]?.deps, deps)) { const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect(); }); } },
  };
});
jest.mock('react-native', () => ({ ActivityIndicator: 'Spinner', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', useWindowDimensions: () => mockDimensions, StyleSheet: { create: (value: unknown) => value, absoluteFill: {} } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/components/SafeModal', () => ({ SafeModal: 'Modal' }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/components/match/TeamShirt', () => ({ TeamShirtIllustration: 'Shirt' }));
jest.mock('../../src/components/match/MatchActionPitch', () => ({ MatchActionPitch: 'Pitch' }));
jest.mock('../../src/components/match/MatchPlayerPicker', () => ({ MatchPlayerPicker: 'PlayerPicker' }));
jest.mock('@/services/analyticsService', () => ({ AnalyticsEvent: { OwnGoalPickerOpened: 'own-goal' }, logEvent: jest.fn() }));
import { GoalEntryModal } from '@/components/match/GoalEntryModal';

const runtime = (require('react') as any).__runtime;
function nodes(node: any): any[] { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
function text(node: any): string { if (typeof node === 'string') return node; if (!node || typeof node !== 'object') return ''; if (Array.isArray(node)) return node.map(text).join(''); return text(node.props?.children); }
const ofType = (tree: any, type: string) => nodes(tree).find(node => node.type === type)!;
const button = (tree: any, label: string) => nodes(tree).find(node => node.type === 'Pressable' && (node.props.accessibilityLabel === label || text(node) === label))!;
const members = (count = 5, prefix = 'a') => Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix === 'a' ? 'שחקן' : 'יריב'} ${i}`, isFiller: i === 4, avatarId: 'a05' }));
function props() { return { gameId: 'goal-test', side: 'A' as const, teamLabel: 'הירוקים', teamColor: '#22C55E', teamInk: '#15803D', otherTeamLabel: 'הכחולים', otherTeamColor: '#3B82F6', otherTeamInk: '#1D4ED8', roster: members(), ownGoalRoster: members(5, 'b'), minute: 1, roundNumber: 2, onSave: jest.fn().mockResolvedValue(undefined), onClose: jest.fn() }; }
function render(input: ReturnType<typeof props> | any) { runtime.begin(); GoalEntryModal(input); runtime.finish(); runtime.begin(); const tree = GoalEntryModal(input); runtime.finish(); return tree; }
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
beforeEach(() => { runtime.reset(); jest.clearAllMocks(); mockDimensions = { width: 390, height: 844, fontScale: 1 }; });
afterEach(() => runtime.reset());

test.each([4, 7, 11])('%s-player rosters keep all positions and disable the scorer for assist', count => {
  const input = props(); input.roster = members(count);
  let tree = render(input); const picker = ofType(tree, 'PlayerPicker');
  expect(picker.props.title).toBe('מי כבש?'); expect(picker.props.players).toBe(input.roster);
  picker.props.onSelect('a2'); tree = render(input);
  expect(ofType(tree, 'PlayerPicker').props.players).toBe(input.roster);
  expect(ofType(tree, 'PlayerPicker').props.disabledIds).toEqual(['a2']);
  expect(ofType(tree, 'PlayerPicker').props.title).toBe('מי בישל?');
  expect(ofType(tree, 'Pitch').props.primary.player.id).toBe('a2');
  expect(ofType(tree, 'Pitch').props.activeRole).toBe('secondary');
  expect(input.onSave).not.toHaveBeenCalled();
  expect(text(tree)).not.toContain('אישור הגול');
});

test('two immediate player taps save once; animation and success wait for acknowledgement', async () => {
  const input = props(), request = deferred(); input.onSave.mockReturnValue(request.promise);
  const tree = render(input), choose = ofType(tree, 'PlayerPicker').props.onSelect;
  choose('a0'); choose('a1'); choose('a2');
  expect(input.onSave).toHaveBeenCalledTimes(1);
  expect(input.onSave.mock.calls[0][0]).toMatchObject({ team: 'A', scorerId: 'a0', assisterId: 'a1', assistStatus: 'player' });
  let current = render(input); expect(ofType(current, 'Pitch').props.status).toBe('saving');
  expect(input.onClose).not.toHaveBeenCalled();
  ofType(current, 'Pitch').props.onAnimationComplete(); expect(input.onClose).not.toHaveBeenCalled();
  request.resolve(); await flush(); current = render(input);
  expect(ofType(current, 'Pitch').props.status).toBe('saved');
  expect(ofType(current, 'Pitch').props.secondary.player.id).toBe('a1');
  expect(input.onClose).not.toHaveBeenCalled();
  ofType(current, 'Pitch').props.onAnimationComplete(); ofType(current, 'Pitch').props.onAnimationComplete();
  expect(input.onClose).toHaveBeenCalledTimes(1); expect(input.onClose).toHaveBeenCalledWith(true);
});

test('the scorer cannot become their own assister even through the handler', () => {
  const input = props(); const choose = ofType(render(input), 'PlayerPicker').props.onSelect;
  choose('a0'); choose('a0'); choose('outsider');
  expect(input.onSave).not.toHaveBeenCalled();
});

test('no assist is the only non-player assist choice and completes on the second tap', () => {
  const input = props(); ofType(render(input), 'PlayerPicker').props.onSelect('a1');
  const tree = render(input);
  expect(button(tree, 'בישול לא ידוע')).toBeUndefined();
  button(tree, 'ללא בישול').props.onPress();
  expect(input.onSave).toHaveBeenCalledTimes(1);
  expect(input.onSave.mock.calls[0][0]).toMatchObject({ scorerId: 'a1', assisterId: null, assistStatus: 'none' });
});

test('unknown scorer retains the existing immediate-save contract', () => {
  const input = props(); button(render(input), 'מבקיע לא ידוע').props.onPress();
  expect(input.onSave).toHaveBeenCalledTimes(1);
  expect(input.onSave.mock.calls[0][0]).toMatchObject({ scorerId: null, team: 'A' });
  expect(input.onSave.mock.calls[0][0].assistStatus).toBeUndefined();
  expect(ofType(render(input), 'Pitch').props.primary.fallback).toBe('מבקיע לא ידוע');
});

test('own goals use only the opposing roster and its actual team identity', () => {
  const input = props(); button(render(input), 'שער עצמי').props.onPress();
  let tree = render(input); const picker = ofType(tree, 'PlayerPicker');
  expect(picker.props.players).toBe(input.ownGoalRoster); expect(picker.props.color).toBe(input.otherTeamColor); expect(picker.props.teamLabel).toBe(input.otherTeamLabel);
  picker.props.onSelect('a1'); expect(input.onSave).not.toHaveBeenCalled();
  picker.props.onSelect('b1'); tree = render(input);
  expect(input.onSave.mock.calls[0][0]).toMatchObject({ team: 'A', scorerId: 'b1', ownGoal: true });
  expect(ofType(tree, 'Pitch').props.primary).toMatchObject({ color: input.otherTeamColor, teamLabel: input.otherTeamLabel, label: 'שער עצמי' });
});

test('failed acknowledgement retains both choices and retries the identical event once', async () => {
  const input = props(); input.onSave.mockRejectedValueOnce(new Error('lost-ack')).mockResolvedValueOnce(undefined);
  const choose = ofType(render(input), 'PlayerPicker').props.onSelect; choose('a0'); choose('a1'); await flush();
  let tree = render(input); const firstEvent = input.onSave.mock.calls[0][0];
  expect(ofType(tree, 'Pitch').props.status).toBe('error');
  expect(ofType(tree, 'Pitch').props.primary.player.id).toBe('a0'); expect(ofType(tree, 'Pitch').props.secondary.player.id).toBe('a1');
  ofType(tree, 'PlayerPicker').props.onSelect('a3'); expect(input.onSave).toHaveBeenCalledTimes(1);
  const retry = button(tree, 'ניסיון חוזר לשמירת הגול'); retry.props.onPress(); retry.props.onPress(); await flush(); tree = render(input);
  expect(input.onSave).toHaveBeenCalledTimes(2); expect(input.onSave.mock.calls[1][0]).toBe(firstEvent);
  expect(ofType(tree, 'Pitch').props.status).toBe('saved');
});

test('a saved goal can close immediately and its animation callback cannot close twice', async () => {
  const input = props(); const choose = ofType(render(input), 'PlayerPicker').props.onSelect; choose('a0'); choose('a1');
  button(render(input), 'סגירה').props.onPress(); expect(input.onClose).not.toHaveBeenCalled();
  await flush(); const tree = render(input); button(tree, 'סגירה').props.onPress(); ofType(tree, 'Pitch').props.onAnimationComplete();
  expect(input.onClose).toHaveBeenCalledTimes(1); expect(input.onClose).toHaveBeenCalledWith(true);
});

test('editing the scorer is optional and replaces the choice without a write', () => {
  const input = props(); ofType(render(input), 'PlayerPicker').props.onSelect('a0');
  ofType(render(input), 'Pitch').props.primary.onEdit(); const tree = render(input);
  expect(ofType(tree, 'PlayerPicker').props.title).toBe('מי כבש?');
  ofType(tree, 'PlayerPicker').props.onSelect('a2');
  expect(ofType(render(input), 'Pitch').props.primary.player.id).toBe('a2');
  expect(input.onSave).not.toHaveBeenCalled();
});

test('changing rounds invalidates old handlers and a late acknowledgement', async () => {
  const input = props(), first = deferred(), second = deferred(); input.onSave.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const chooseOld = ofType(render(input), 'PlayerPicker').props.onSelect; chooseOld('a0'); chooseOld('a1');
  input.roundNumber = 3; const chooseNew = ofType(render(input), 'PlayerPicker').props.onSelect;
  chooseOld('a0'); chooseOld('a1'); expect(input.onSave).toHaveBeenCalledTimes(1);
  chooseNew('a2'); chooseNew('a3'); expect(input.onSave).toHaveBeenCalledTimes(2);
  first.resolve(); await flush(); expect(ofType(render(input), 'Pitch').props.status).toBe('saving'); expect(input.onClose).not.toHaveBeenCalled();
  second.resolve(); await flush(); expect(ofType(render(input), 'Pitch').props.status).toBe('saved');
});

test('unmount invalidates animation/selection callbacks and ignores late acknowledgement', async () => {
  const input = props(), request = deferred(); input.onSave.mockReturnValue(request.promise);
  const choose = ofType(render(input), 'PlayerPicker').props.onSelect; choose('a0'); choose('a1');
  const pitch = ofType(render(input), 'Pitch'); runtime.unmount(); const writes = runtime.writes();
  request.resolve(); await flush(); choose('a2'); pitch.props.onAnimationComplete();
  expect(runtime.writes()).toBe(writes); expect(input.onSave).toHaveBeenCalledTimes(1); expect(input.onClose).not.toHaveBeenCalled();
});

test('empty rosters do not permit arbitrary identities to complete an event', () => {
  const input = props(); input.roster = []; input.ownGoalRoster = [];
  ofType(render(input), 'PlayerPicker').props.onSelect('a0'); button(render(input), 'שער עצמי').props.onPress(); ofType(render(input), 'PlayerPicker').props.onSelect('b0');
  expect(input.onSave).not.toHaveBeenCalled();
});

test('closing a failed attempt and reopening the same side creates a fresh independent event', async () => {
  const input = props(); input.onSave.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  const chooseFirst = ofType(render(input), 'PlayerPicker').props.onSelect; chooseFirst('a0'); chooseFirst('a1'); await flush();
  const firstEvent = input.onSave.mock.calls[0][0]; button(render(input), 'סגירה').props.onPress();
  expect(input.onClose).toHaveBeenCalledWith(undefined);
  render({ ...input, side: null }); const tree = render(input);
  expect(ofType(tree, 'Pitch').props.status).toBe('idle'); expect(ofType(tree, 'Pitch').props.primary.player).toBeUndefined();
  const chooseSecond = ofType(tree, 'PlayerPicker').props.onSelect; chooseSecond('a2'); chooseSecond('a3'); await flush();
  expect(input.onSave).toHaveBeenCalledTimes(2);
  expect(input.onSave.mock.calls[1][0].id).not.toBe(firstEvent.id);
  expect(input.onSave.mock.calls[1][0]).toMatchObject({ team: 'A', scorerId: 'a2', assisterId: 'a3' });
  expect(ofType(render(input), 'Pitch').props.status).toBe('saved');
});

test('a new goal on the same side is not dismissed by the previous celebration callback', async () => {
  const input = props(); const chooseFirst = ofType(render(input), 'PlayerPicker').props.onSelect; chooseFirst('a0'); chooseFirst('a1'); await flush();
  const oldPitch = ofType(render(input), 'Pitch'); button(render(input), 'סגירה').props.onPress();
  render({ ...input, side: null }); const chooseSecond = ofType(render(input), 'PlayerPicker').props.onSelect; chooseSecond('a2'); chooseSecond('a3'); await flush();
  oldPitch.props.onAnimationComplete(); expect(input.onClose).toHaveBeenCalledTimes(1);
  ofType(render(input), 'Pitch').props.onAnimationComplete(); expect(input.onClose).toHaveBeenCalledTimes(2);
});

test('small viewport with enlarged text keeps a stable usable picker and two-tap completion', () => {
  mockDimensions = { width: 320, height: 569, fontScale: 1.4 };
  const input = props(); input.roster = members(11);
  const start = render(input), picker = ofType(start, 'PlayerPicker');
  const wrapper = (tree: any) => nodes(tree).find(node => node.type === 'View' && node.props.children?.type === 'PlayerPicker');
  const header = nodes(start).find(node => node.type === 'Text' && node.props.accessibilityRole === 'header');
  const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style;
  expect(header.props.numberOfLines).toBe(1);
  expect(ofType(start, 'Pitch').props.height).toBeLessThanOrEqual(170);
  expect(flatten(wrapper(start).props.style).minHeight).toBeGreaterThanOrEqual(150);
  picker.props.onSelect('a10'); const assist = render(input);
  expect(wrapper(assist).props.style).toEqual(wrapper(start).props.style);
  expect(ofType(assist, 'PlayerPicker').props.players).toBe(input.roster);
  expect(ofType(assist, 'PlayerPicker').props.disabledIds).toEqual(['a10']);
  expect(button(assist, 'ללא בישול')).toBeDefined();
  expect(ofType(assist, 'Pitch').props.primary.onEdit).toEqual(expect.any(Function));
  ofType(assist, 'PlayerPicker').props.onSelect('a9');
  expect(input.onSave).toHaveBeenCalledTimes(1);
  expect(input.onSave.mock.calls[0][0]).toMatchObject({ scorerId: 'a10', assisterId: 'a9' });
});

test.each([
  { width: 320, height: 569, fontScale: 1.4 },
  { width: 320, height: 480, fontScale: 1.8 },
])('failed save keeps retry outside the scrollable selections at $height and font $fontScale', async dimensions => {
  mockDimensions = dimensions;
  const input = props(), retryRequest = deferred(); input.roster = members(11);
  input.onSave.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(retryRequest.promise);
  let tree = render(input);
  expect(nodes(tree).filter(node => node.type === 'ScrollView')).toHaveLength(0);
  ofType(tree, 'PlayerPicker').props.onSelect('a10');
  button(render(input), 'ללא בישול').props.onPress();
  await flush(); tree = render(input);
  const attempted = input.onSave.mock.calls[0][0];
  const body = nodes(tree).find(node => node.props?.testID === 'goal-error-body');
  const footer = nodes(tree).find(node => node.props?.testID === 'goal-entry-footer');
  const retry = button(tree, 'ניסיון חוזר לשמירת הגול');
  expect(body.type).toBe('ScrollView');
  expect(ofType(body, 'Pitch').props.primary.player.id).toBe('a10');
  expect(ofType(body, 'Pitch').props.secondary.fallback).toBe('ללא בישול');
  expect(ofType(body, 'PlayerPicker').props.players).toBe(input.roster);
  expect(nodes(body)).not.toContain(retry);
  expect(nodes(footer)).toContain(retry);
  expect(text(footer)).toContain('לא התקבל אישור לשמירת הגול. הבחירה נשמרה.');
  const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style;
  expect(flatten(footer.props.style).flexShrink).toBe(0);
  expect(flatten(retry.props.style).minHeight).toBeGreaterThanOrEqual(48);
  retry.props.onPress(); retry.props.onPress();
  expect(input.onSave).toHaveBeenCalledTimes(2);
  expect(input.onSave.mock.calls[1][0]).toBe(attempted);
  expect(ofType(render(input), 'Pitch').props.status).toBe('saving');
  retryRequest.resolve(); await flush(); tree = render(input);
  expect(ofType(tree, 'Pitch').props.status).toBe('saved');
  expect(ofType(tree, 'Pitch').props.primary.player.id).toBe('a10');
  expect(nodes(tree).filter(node => node.type === 'ScrollView')).toHaveLength(0);
});
