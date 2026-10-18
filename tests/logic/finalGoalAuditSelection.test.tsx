import React from 'react';

let mockWindow = { width: 390, height: 844, fontScale: 1 };
const mockRecord = jest.fn();
const mockStart = jest.fn();
const mockChangeFirst = jest.fn();
const mockEdit = jest.fn();

// Execute the real handlers/effects with cleanup. Native layout and gesture
// dispatch are deliberately outside this contract test.
jest.mock('react', () => {
  let slots: any[] = [], cursor = 0, effects: Array<() => void> = [], writes = 0;
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return { ...jest.requireActual('react'), __finalGoalRuntime: {
    begin: () => { cursor = 0; },
    flush: () => { const queue = effects; effects = []; queue.forEach(effect => effect()); },
    reset: () => { slots.forEach(s => s?.cleanup?.()); slots = []; cursor = 0; effects = []; writes = 0; },
    unmount: () => slots.forEach(s => s?.cleanup?.()),
    writes: () => writes,
  },
  useRef: (value: unknown) => { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
  useState: (initial: unknown) => { const i = cursor++; if (!slots[i]) slots[i] = { value: initial }; return [slots[i].value, (next: any) => { writes++; slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
  useMemo: (factory: () => unknown, deps: unknown[]) => { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: factory() }; return slots[i].value; },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect(); }); } },
  };
});
jest.mock('react-native', () => ({ ActivityIndicator: 'Busy', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', useWindowDimensions: () => mockWindow, StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {} } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/components/SafeModal', () => ({ SafeModal: 'Modal' }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/components/match/TeamShirt', () => ({ TeamShirtIllustration: 'Shirt' }));
jest.mock('@/components/match/MatchActionPitch', () => ({ MatchActionPitch: 'Pitch' }));
jest.mock('@/components/match/MatchPlayerPicker', () => ({ MatchPlayerPicker: 'Picker' }));
jest.mock('@/components/match/ShootoutSummaryViews', () => ({ ShootoutScorePanel: 'Score', ShootoutLogRow: 'LogRow', ShootoutNextMatch: 'NextMatch' }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left', colors: { team1: '#EF4444', team2: '#3B82F6', team3: '#22C55E' } }));
jest.mock('@/services/gameService', () => ({ gameService: { recordShootoutKick: (...args: any[]) => mockRecord(...args), startShootout: (...args: any[]) => mockStart(...args), changeShootoutFirstTeam: (...args: any[]) => mockChangeFirst(...args), undoLastShootoutKick: jest.fn(), updateLastShootoutKick: (...args:any[]) => mockEdit(...args) } }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
jest.mock('@/services/analyticsService', () => ({ AnalyticsEvent: {}, logEvent: jest.fn() }));

import { Shootout } from '@/components/match/ShootoutWizard';
import { GoalEntryModal } from '@/components/match/GoalEntryModal';
const runtime = (require('react') as any).__finalGoalRuntime;
const nodes = (n: any): any[] => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const text = (n: any): string => typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : '';
const of = (tree: any, type: string) => nodes(tree).find(n => n.type === type);
const button = (tree: any, label: string) => nodes(tree).find(n => n.type === 'Pressable' && (n.props.accessibilityLabel === label || text(n) === label));
function render(component: (p: any) => any, p: any) { let tree: any; for (let i = 0; i < 4; i++) { runtime.begin(); tree = component(p); runtime.flush(); } return tree; }
const draw = (p: any) => render(Shootout, p);
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() { let resolve!: () => void; let reject!: (e: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function properties(): any {
  return { visible: true, gameId: 'audit-evening', shootout: { firstTeam: 'A', kicks: [] },
    rotation: { round: 1, roundInstanceId: 'audit-round-one', playing: [0, 1], waiting: [2], loans: [] },
    draftTeams: { teams: [{ index: 0, colorKey: 'red', playerIds: ['a0', 'a1'] }, { index: 1, colorKey: 'blue', playerIds: ['b0', 'b1'] }, { index: 2, colorKey: 'green', playerIds: ['c0', 'guest:loan'] }], leftHome: [] },
    playersMap: Object.fromEntries(['a0', 'a1', 'b0', 'b1', 'c0'].map(id => [id, { displayName: `שחקן ${id}`, avatarId: 'a05' }])),
    guests: [{ id: 'loan', name: 'משלים אורח' }], onDecided: jest.fn(), onExit: jest.fn(), onChangeDecision: jest.fn() };
}
function choosePeople(p: any) { let tree = draw(p); of(tree, 'Picker').props.onSelect('a0'); tree = draw(p); of(tree, 'Picker').props.onSelect('b0'); return draw(p); }
beforeEach(() => { runtime.reset(); mockRecord.mockReset().mockResolvedValue(undefined); mockStart.mockReset().mockResolvedValue(undefined); mockChangeFirst.mockReset().mockResolvedValue(undefined); mockEdit.mockReset().mockResolvedValue(undefined); mockWindow = { width: 390, height: 844, fontScale: 1 }; });
afterEach(() => runtime.reset());

test.each([
  {width: 390, height: 844, fontScale: 1},
  {width: 320, height: 569, fontScale: 1},
  {width: 320, height: 569, fontScale: 1.4},
])('undo keeps the surrounding penalty frame through pending, rejection and retry: %o', async dimensions => {
  mockWindow = dimensions;
  const p = properties();
  p.shootout.kicks = [
    {id: 'first', team: 'A', kickerId: 'a0', keeperId: 'b0', outcome: 'goal', scored: true, at: 1},
    {id: 'last', team: 'B', kickerId: 'b1', keeperId: 'a1', outcome: 'miss', scored: false, at: 2},
  ];
  const undo = require('@/services/gameService').gameService.undoLastShootoutKick as jest.Mock;
  undo.mockReset();
  const pending = deferred();
  undo.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  const frame = (tree: any) => Object.assign({}, ...nodes(tree).find(n => n.props?.testID === 'penalty-dialog').props.style.filter(Boolean));
  let tree = draw(p);
  const initialFrame = frame(tree);
  const check = (current: any) => {
    expect(frame(current)).toEqual(initialFrame);
    expect(Object.assign({}, ...of(current, 'ScrollView').props.style.filter(Boolean))).toMatchObject({flex: 1, minHeight: 0});
  };
  button(tree, 'יומן בעיטות').props.onPress(); tree = draw(p); check(tree);
  button(tree, 'ביטול הבעיטה האחרונה').props.onPress(); tree = draw(p); check(tree);
  expect(nodes(of(tree, 'ScrollView')).some(n => n.props?.testID === 'penalty-undo-confirm')).toBe(false);
  expect(undo).not.toHaveBeenCalled();
  const confirm = button(tree, 'בטל בעיטה');
  confirm.props.onPress(); confirm.props.onPress(); tree = draw(p); check(tree);
  expect(button(tree, 'בטל בעיטה').props.disabled).toBe(true);
  expect(undo).toHaveBeenCalledTimes(1);
  expect(undo).toHaveBeenCalledWith(p.gameId, 'last');
  pending.reject(new Error('lost acknowledgement')); await settle(); tree = draw(p); check(tree);
  expect(button(tree, 'בטל בעיטה').props.disabled).toBe(true);
  button(tree, 'ניסיון חוזר').props.onPress(); await settle(); tree = draw(p); check(tree);
  expect(undo.mock.calls).toEqual([[p.gameId, 'last'], [p.gameId, 'last']]);
  expect(of(tree, 'Picker')).toBeDefined();
  expect(mockRecord).not.toHaveBeenCalled();
  expect(p.onDecided).not.toHaveBeenCalled();
});

test('an external first-side edit before any kick replaces both role rosters', () => {
  const p = properties(); draw(p);
  p.shootout = { firstTeam: 'B', kicks: [] };
  const tree = draw(p);
  expect(of(tree, 'Picker').props.players.map((m: any) => m.id)).toEqual(['b0', 'b1']);
  expect(of(tree, 'Pitch').props.primary.teamLabel).toBe('הכחולים');
  expect(of(tree, 'Pitch').props.secondary.teamLabel).toBe('האדומים');
});

test('an idempotent start acknowledges an existing competing first-side choice instead of presenting the losing choice', async () => {
  const p = properties(); p.shootout = undefined; const request = deferred(); mockStart.mockReturnValueOnce(request.promise);
  let tree = draw(p); button(tree, 'האדומים בועטים ראשונים').props.onPress();
  p.shootout = { firstTeam: 'B', kicks: [] }; draw(p);
  request.resolve(); await settle(); tree = draw(p);
  expect(of(tree, 'Picker').props.players.map((m: any) => m.id)).toEqual(['b0', 'b1']);
  expect(mockStart).toHaveBeenCalledTimes(1);
});

test('a remote kick arriving during participant selection returns to an actionable next kicking roster', () => {
  const p = properties(); choosePeople(p);
  p.shootout.kicks = [{ id: 'remote-one', team: 'A', kickerId: 'a1', keeperId: 'b1', scored: true, outcome: 'goal', at: 1 }];
  const tree = draw(p);
  expect(of(tree, 'Picker')).toBeDefined();
  expect(of(tree, 'Picker').props.players.map((m: any) => m.id)).toEqual(['b0', 'b1']);
  expect(of(tree, 'Pitch').props.primary.player).toBeUndefined();
  expect(mockRecord).not.toHaveBeenCalled();
});

test('real effective rosters include only the active opponent and loaned guest, excluding the waiting donor', () => {
  const p = properties(); p.rotation.playing = [1, 0]; p.rotation.loans = [{ playerId: 'guest:loan', homeTeam: 2, filledTeam: 0 }];
  let tree = draw(p); expect(of(tree, 'Picker').props.players.map((m: any) => m.id)).toEqual(['b0', 'b1']);
  of(tree, 'Picker').props.onSelect('b1'); tree = draw(p);
  expect(of(tree, 'Picker').props.players.map((m: any) => m.id)).toEqual(['a0', 'a1', 'guest:loan']);
  expect(of(tree, 'Picker').props.players.find((m: any) => m.id === 'guest:loan')).toMatchObject({ name: 'משלים אורח', isFiller: true, fromTeam: 2 });
  of(tree, 'Picker').props.onSelect('c0'); expect(of(draw(p), 'Picker')).toBeDefined();
});

test('closing and changing the round before an acknowledgement prevents a late success in the new round', async () => {
  const p = properties(), request = deferred(); mockRecord.mockReturnValueOnce(request.promise);
  button(choosePeople(p), 'עצירה').props.onPress(); draw({ ...p, visible: false });
  p.rotation = { ...p.rotation, round: 2, roundInstanceId: 'audit-round-two', playing: [0, 2] }; draw(p);
  request.resolve(); await settle(); const tree = draw(p);
  expect(of(tree, 'Pitch').props.status).toBe('idle'); expect(of(tree, 'Pitch').props.primary.player).toBeUndefined();
  expect(mockRecord).toHaveBeenCalledTimes(1);
});

test('a failed kick retries the identical id and outcome despite a listener already advancing the turn', async () => {
  const p = properties(); mockRecord.mockRejectedValueOnce(Error('lost acknowledgement'));
  button(choosePeople(p), 'החמצה').props.onPress(); await settle(); const entry = mockRecord.mock.calls[0][1];
  p.shootout.kicks = [{ ...entry, at: 1 }]; let tree = draw(p);
  expect(of(tree, 'Pitch').props.primary.player.id).toBe('a0'); expect(of(tree, 'Pitch').props.secondary.player.id).toBe('b0');
  button(tree, 'ניסיון חוזר').props.onPress(); button(tree, 'ניסיון חוזר').props.onPress(); await settle(); tree = draw(p);
  expect(mockRecord).toHaveBeenCalledTimes(2); expect(mockRecord.mock.calls[1][1]).toBe(entry);
  expect(of(tree, 'Pitch').props.status).toBe('saved'); expect(of(tree, 'Pitch').props.outcome).toBe('miss');
});

test('an open goal selection rejects a newly ineligible assister but allows another current teammate', () => {
  const p = { gameId: 'audit-goal', side: 'A', teamLabel: 'האדומים', teamColor: '#EF4444', teamInk: '#B91C1C', otherTeamLabel: 'הכחולים', roster: ['a0', 'a1', 'a2'].map(id => ({ id, name: id, isFiller: false })), ownGoalRoster: [], minute: 1, roundNumber: 1, onSave: jest.fn(), onClose: jest.fn() };
  of(render(GoalEntryModal, p), 'Picker').props.onSelect('a0'); p.roster = p.roster.filter(m => m.id !== 'a1');
  let tree = render(GoalEntryModal, p); of(tree, 'Picker').props.onSelect('a1'); expect(p.onSave).not.toHaveBeenCalled();
  of(tree, 'Picker').props.onSelect('a2'); expect(p.onSave).toHaveBeenCalledTimes(1); expect(p.onSave.mock.calls[0][0]).toMatchObject({ scorerId: 'a0', assisterId: 'a2' });
});

test('a scorer leaving the eligible roster returns an unsubmitted goal to scorer selection without an invalid write', () => {
  const p = { gameId: 'audit-goal', side: 'A', teamLabel: 'האדומים', teamColor: '#EF4444', teamInk: '#B91C1C', otherTeamLabel: 'הכחולים', roster: ['a0', 'a1', 'a2'].map(id => ({ id, name: id, isFiller: false })), ownGoalRoster: [], minute: 1, roundNumber: 1, onSave: jest.fn(), onClose: jest.fn() };
  of(render(GoalEntryModal, p), 'Picker').props.onSelect('a0'); p.roster = p.roster.filter(m => m.id !== 'a0');
  const tree = render(GoalEntryModal, p);
  expect(of(tree, 'Picker').props.title).toBe('מי כבש?');
  of(tree, 'Picker').props.onSelect('a1'); expect(p.onSave).not.toHaveBeenCalled();
});

test('a selected kicker leaving during goalkeeper selection returns to the eligible kickers', () => {
  const p = properties(); let tree = draw(p); of(tree, 'Picker').props.onSelect('a0'); draw(p);
  p.draftTeams.teams[0].playerIds = ['a1']; tree = draw(p);
  expect(of(tree, 'Picker').props.title).toBe('מי בועט?');
  expect(of(tree, 'Picker').props.players.map((m: any) => m.id)).toEqual(['a1']);
  expect(mockRecord).not.toHaveBeenCalled();
});

test('a selected goalkeeper leaving the result step preserves the kicker and asks for the current opposing keeper', () => {
  const p = properties(); choosePeople(p); p.draftTeams.teams[1].playerIds = ['b1'];
  const tree = draw(p);
  expect(of(tree, 'Picker').props.title).toBe('מי בשער?');
  expect(of(tree, 'Picker').props.players.map((m: any) => m.id)).toEqual(['b1']);
  expect(of(tree, 'Pitch').props.primary.player.id).toBe('a0');
  expect(mockRecord).not.toHaveBeenCalled();
});

test('new arrays with unchanged membership preserve the pending penalty roles', () => {
  const p = properties(); choosePeople(p);
  p.draftTeams = { ...p.draftTeams, teams: p.draftTeams.teams.map((team: any) => ({ ...team, playerIds: [...team.playerIds] })) };
  const tree = draw(p);
  expect(of(tree, 'Picker')).toBeUndefined();
  expect(of(tree, 'Pitch').props.primary.player.id).toBe('a0'); expect(of(tree, 'Pitch').props.secondary.player.id).toBe('b0');
  expect(button(tree, 'עצירה').props.disabled).toBe(false);
});

test('a new equivalent goal roster array preserves the selected scorer and the second-tap assist step', () => {
  const p = { gameId: 'audit-goal', side: 'A', teamLabel: 'האדומים', teamColor: '#EF4444', teamInk: '#B91C1C', otherTeamLabel: 'הכחולים', roster: ['a0', 'a1', 'a2'].map(id => ({ id, name: id, isFiller: false })), ownGoalRoster: [], minute: 1, roundNumber: 1, onSave: jest.fn(), onClose: jest.fn() };
  of(render(GoalEntryModal, p), 'Picker').props.onSelect('a0'); p.roster = p.roster.map(member => ({ ...member }));
  const tree = render(GoalEntryModal, p);
  expect(of(tree, 'Picker').props.title).toBe('מי בישל?'); expect(of(tree, 'Pitch').props.primary.player.id).toBe('a0');
  expect(p.onSave).not.toHaveBeenCalled();
});

test('the delayed snapshot of our acknowledged kick does not reset the next chosen kicker', async () => {
  const p = properties(); button(choosePeople(p), 'גול').props.onPress(); await settle();
  let tree = draw(p); of(tree, 'Picker').props.onSelect('b1'); tree = draw(p);
  expect(of(tree, 'Picker').props.title).toBe('מי בשער?');
  const acknowledged = mockRecord.mock.calls[0][1]; p.shootout.kicks = [{ ...acknowledged, at: 10 }]; tree = draw(p);
  expect(of(tree, 'Picker').props.title).toBe('מי בשער?'); expect(of(tree, 'Pitch').props.primary.player.id).toBe('b1');
});

test.each(['log', 'finish'])('a remote kick updates %s without navigating away or retaining a stale manual finish choice', screen => {
  const p = properties(); p.shootout.kicks = [{ id: 'first', team: 'A', kickerId: 'a0', keeperId: 'b0', scored: true, outcome: 'goal', at: 1 }];
  let tree = draw(p); button(tree, screen === 'log' ? 'יומן בעיטות' : 'סיום פנדלים').props.onPress(); draw(p);
  p.shootout.kicks = [...p.shootout.kicks, { id: 'second', team: 'B', kickerId: 'b0', keeperId: 'a0', scored: true, outcome: 'goal', at: 2 }]; tree = draw(p);
  expect(text(tree)).toContain(screen === 'log' ? 'יומן הפנדלים' : 'סיום הפנדלים');
  if (screen === 'finish') expect(button(tree, 'אישור ומעבר למשחק הבא').props.disabled).toBe(true);
  expect(p.onDecided).not.toHaveBeenCalled(); expect(mockRecord).not.toHaveBeenCalled();
});

test.each(['edit', 'undo'])('a remote append during %s returns to the log instead of altering the new last kick', screen => {
  const p = properties(); p.shootout.kicks = [{ id: 'first', team: 'A', kickerId: 'a0', keeperId: 'b0', scored: true, outcome: 'goal', at: 1 }];
  let tree = draw(p); button(tree, 'יומן בעיטות').props.onPress(); tree = draw(p);
  button(tree, screen === 'edit' ? 'תיקון הבעיטה האחרונה' : 'ביטול הבעיטה האחרונה').props.onPress(); draw(p);
  p.shootout.kicks = [...p.shootout.kicks, { id: 'second', team: 'B', kickerId: 'b0', keeperId: 'a0', scored: false, outcome: 'save', at: 2 }]; tree = draw(p);
  expect(text(tree)).toContain('יומן הפנדלים'); expect(button(tree, 'בטל בעיטה')).toBeUndefined(); expect(button(tree, 'שמור תיקון')).toBeUndefined();
});

test('only a definite roster rejection permits replacing a pending kick; a new attempt gets a new id', async () => {
  const p = properties(); mockRecord.mockRejectedValueOnce(Object.assign(Error('player left'), { code: 'LIVE_ROSTER_CHANGED' }));
  button(choosePeople(p), 'עצירה').props.onPress(); await settle(); let tree = draw(p); const rejected = mockRecord.mock.calls[0][1];
  expect(of(tree, 'Pitch').props.status).toBe('error'); button(tree, 'בחירת שחקנים מחדש').props.onPress(); tree = draw(p);
  expect(of(tree, 'Picker').props.title).toBe('מי בועט?'); expect(of(tree, 'Pitch').props.primary.player).toBeUndefined();
  of(tree, 'Picker').props.onSelect('a1'); tree = draw(p); of(tree, 'Picker').props.onSelect('b1'); tree = draw(p);
  button(tree, 'החמצה').props.onPress(); await settle();
  expect(mockRecord).toHaveBeenCalledTimes(2); expect(mockRecord.mock.calls[1][1].id).not.toBe(rejected.id);
  expect(mockRecord.mock.calls[1][1]).toMatchObject({ kickerId: 'a1', keeperId: 'b1', outcome: 'miss' });
});

test('an unknown kick acknowledgement keeps its participant snapshots even after both leave their rosters', async () => {
  const p = properties(); mockRecord.mockRejectedValueOnce(Error('network response lost'));
  button(choosePeople(p), 'גול').props.onPress(); await settle();
  p.draftTeams.teams[0].playerIds = ['a1']; p.draftTeams.teams[1].playerIds = ['b1']; let tree = draw(p);
  expect(button(tree, 'בחירת שחקנים מחדש')).toBeUndefined();
  expect(of(tree, 'Pitch').props.primary.player.id).toBe('a0'); expect(of(tree, 'Pitch').props.secondary.player.id).toBe('b0');
  button(tree, 'ניסיון חוזר').props.onPress(); await settle(); tree = draw(p);
  expect(mockRecord.mock.calls[1][1]).toBe(mockRecord.mock.calls[0][1]);
  expect(of(tree, 'Pitch').props.status).toBe('saved'); expect(of(tree, 'Pitch').props.primary.player.id).toBe('a0');
});

test('a definite competing-turn rejection permits a new attempt only for the new kicking side', async () => {
  const p = properties(); mockRecord.mockRejectedValueOnce(Object.assign(Error('SHOOTOUT_CHANGED'), {code:'LIVE_KICK_CHANGED'}));
  button(choosePeople(p), 'גול').props.onPress(); await settle(); const rejected = mockRecord.mock.calls[0][1];
  p.shootout.kicks = [{id:'another-admin',team:'A',kickerId:'a1',keeperId:'b1',scored:false,outcome:'miss',at:1}]; let tree = draw(p);
  expect(text(tree)).toContain('התור השתנה'); expect(of(tree, 'Pitch').props.primary.player.id).toBe('a0');
  button(tree, 'בחירת שחקנים מחדש').props.onPress(); tree = draw(p);
  expect(of(tree, 'Picker').props.players.map((m:any)=>m.id)).toEqual(['b0','b1']);
  of(tree, 'Picker').props.onSelect('b1'); tree = draw(p); of(tree, 'Picker').props.onSelect('a1'); tree = draw(p);
  button(tree, 'עצירה').props.onPress(); await settle();
  expect(mockRecord.mock.calls[1][1]).toMatchObject({team:'B',expectedKickCount:1,kickerId:'b1',keeperId:'a1',outcome:'save'});
  expect(mockRecord.mock.calls[1][1].id).not.toBe(rejected.id);
});

test('an unclassified id collision never permits replacing the unknown existing event', async () => {
  const p = properties(); mockRecord.mockRejectedValueOnce(Error('SHOOTOUT_CHANGED'));
  button(choosePeople(p), 'גול').props.onPress(); await settle(); let tree = draw(p);
  expect(button(tree, 'בחירת שחקנים מחדש')).toBeUndefined();
  button(tree, 'ניסיון חוזר').props.onPress(); await settle();
  expect(mockRecord.mock.calls[1][1]).toBe(mockRecord.mock.calls[0][1]);
});

test('an edit rejected for its departed player reopens that role and edits the same saved kick without appending', async()=>{
  const p=properties();p.shootout.kicks=[{id:'saved-one',team:'A',kickerId:'a0',keeperId:'b0',scored:true,outcome:'goal',at:1}];
  let tree=draw(p);button(tree,'יומן בעיטות').props.onPress();tree=draw(p);button(tree,'תיקון הבעיטה האחרונה').props.onPress();draw(p);
  p.draftTeams.teams[0].playerIds=['a1'];mockEdit.mockRejectedValueOnce(Object.assign(Error('player left'),{code:'LIVE_ROSTER_CHANGED'}));
  tree=draw(p);button(tree,'שמור תיקון').props.onPress();await settle();tree=draw(p);button(tree,'בחירת שחקנים מחדש').props.onPress();tree=draw(p);
  const candidate=nodes(tree).find(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='שחקן a1');candidate.props.onPress();tree=draw(p);
  button(tree,'שמור תיקון').props.onPress();await settle();tree=draw(p);
  expect(mockEdit).toHaveBeenCalledTimes(2);expect(mockEdit.mock.calls[1]).toEqual(['audit-evening','saved-one',{kickerId:'a1',keeperId:'b0',outcome:'goal'},'audit-round-one']);
  expect(mockRecord).not.toHaveBeenCalled();expect(text(tree)).toContain('יומן הפנדלים');
});

test.each(['LIVE_ROSTER_CHANGED', undefined])('goal error %s permits fresh selections only after a definite rejection, otherwise preserves the exact retry', async code => {
  const p = { gameId: 'audit-goal', side: 'A', teamLabel: 'האדומים', teamColor: '#EF4444', teamInk: '#B91C1C', otherTeamLabel: 'הכחולים', roster: ['a0', 'a1', 'a2'].map(id => ({ id, name: id, isFiller: false })), ownGoalRoster: [], minute: 1, roundNumber: 1, onSave: jest.fn().mockRejectedValueOnce(Object.assign(Error('failed'), { code })).mockResolvedValue(undefined), onClose: jest.fn() };
  let tree = render(GoalEntryModal, p); of(tree, 'Picker').props.onSelect('a0'); tree = render(GoalEntryModal, p); of(tree, 'Picker').props.onSelect('a1'); await settle();
  const attempted = p.onSave.mock.calls[0][0]; p.roster = p.roster.filter(m => m.id !== 'a0'); tree = render(GoalEntryModal, p);
  expect(of(tree, 'Pitch').props.primary.player.id).toBe('a0'); expect(of(tree, 'Pitch').props.secondary.player.id).toBe('a1');
  if (code) {
    button(tree, 'בחירת שחקנים מחדש').props.onPress(); tree = render(GoalEntryModal, p);
    expect(of(tree, 'Picker').props.title).toBe('מי כבש?'); expect(of(tree, 'Pitch').props.primary.player).toBeUndefined();
    of(tree, 'Picker').props.onSelect('a1'); tree = render(GoalEntryModal, p); of(tree, 'Picker').props.onSelect('a2'); await settle();
    expect(p.onSave.mock.calls[1][0].id).not.toBe(attempted.id);
  } else {
    expect(button(tree, 'בחירת שחקנים מחדש')).toBeUndefined(); button(tree, 'ניסיון חוזר לשמירת הגול').props.onPress(); await settle();
    expect(p.onSave.mock.calls[1][0]).toBe(attempted);
  }
  expect(of(render(GoalEntryModal, p), 'Pitch').props.status).toBe('saved');
});

test.each([
  {width: 390, height: 844, fontScale: 1},
  {width: 320, height: 569, fontScale: 1.4},
])('goal actions retain their own accessible identity after a rejected attempt is replaced: %o', async dimensions => {
  mockWindow = dimensions;
  const p = {gameId: 'goal-accessible-actions', side: 'A', teamLabel: 'האדומים', teamColor: '#EF4444', teamInk: '#B91C1C',
    otherTeamLabel: 'הכחולים', roster: ['a0', 'a1'].map(id => ({id, name: id, isFiller: false})),
    ownGoalRoster: [{id: 'opponent', name: 'שחקן היריבה', isFiller: false}], minute: 1, roundNumber: 1,
    onSave: jest.fn().mockRejectedValueOnce(Object.assign(new Error('definite rejection'), {code: 'LIVE_ROSTER_CHANGED'})).mockResolvedValue(undefined),
    onClose: jest.fn()};
  let tree = render(GoalEntryModal, p);
  expect(button(tree, 'מבקיע לא ידוע').props.accessibilityLabel).toBe('מבקיע לא ידוע');
  expect(button(tree, 'שער עצמי').props.accessibilityLabel).toBe('שער עצמי');
  of(tree, 'Picker').props.onSelect('a0'); tree = render(GoalEntryModal, p);
  expect(button(tree, 'ללא בישול').props.accessibilityLabel).toBe('ללא בישול');
  if (dimensions.width > 350) expect(button(tree, 'שינוי הכובש').props.accessibilityLabel).toBe('שינוי הכובש');
  button(tree, 'ללא בישול').props.onPress(); await settle(); tree = render(GoalEntryModal, p);
  const errorContainer = nodes(tree).find(node => node.type === 'View' && node.props.children?.some?.((child: any) => child?.props?.accessibilityLabel === 'בחירת שחקנים מחדש'));
  button(tree, 'בחירת שחקנים מחדש').props.onPress(); tree = render(GoalEntryModal, p);
  const own = button(tree, 'שער עצמי');
  expect(own.props.accessibilityLabel).toBe('שער עצמי');
  expect(button(tree, 'מבקיע לא ידוע').props.accessibilityLabel).toBe('מבקיע לא ידוע');
  const scorerContainer = nodes(tree).find(node => node.type === 'View' && node.props.children?.some?.((child: any) => child?.props?.accessibilityLabel === 'שער עצמי'));
  // Different keys force a native remount of the action group. Its previous
  // error label must not remain attached to the own-goal native button.
  expect(errorContainer.key).not.toBeNull();
  expect(scorerContainer.key).not.toBe(errorContainer.key);
  expect(p.onSave).toHaveBeenCalledTimes(1);
  own.props.onPress(); tree = render(GoalEntryModal, p);
  expect(of(tree, 'Picker').props.players.map((member: any) => member.id)).toEqual(['opponent']);
  of(tree, 'Picker').props.onSelect('opponent'); await settle();
  expect(p.onSave.mock.calls[1][0]).toMatchObject({scorerId: 'opponent', ownGoal: true, team: 'A'});
});
