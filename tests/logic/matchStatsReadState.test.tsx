import React from 'react';
import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

let mockFocused = true;
let mockViewer: { id: string } | null = { id: 'manager' };
jest.mock('react', () => {
  let slots: any[] = [], index = 0, pending: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks: any = {
    ...jest.requireActual('react'),
    __runtime: {
      begin: () => { index = 0; },
      effects: () => { const work = pending; pending = []; work.forEach(fn => fn()); },
      reset: () => { slots.forEach(slot => slot?.cleanup?.()); slots = []; index = 0; pending = []; },
    },
    useState: (initial: any) => {
      const i = index++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (next: any) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }];
    },
    useRef: (initial: any) => { const i = index++; return slots[i] ?? (slots[i] = { current: initial }); },
    useCallback: (fn: any, deps: any[]) => {
      const i = index++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn };
      return slots[i].value;
    },
    useEffect: (effect: any, deps: any[]) => {
      const i = index++, previous = slots[i];
      if (!same(previous?.deps, deps)) {
        const slot: any = { deps }; slots[i] = slot;
        pending.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
  return hooks;
});
jest.mock('react-native', () => ({ ActivityIndicator: 'Spinner', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (v: any) => v } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon', MaterialCommunityIcons: 'MaterialIcon' }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Line: 'Line', Path: 'Path', Rect: 'Rect' }));
jest.mock('@/hooks/animations/useAmbientMotion', () => ({ useAmbientMotion: () => false }));
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: 'AnimatedView' }, cancelAnimation: jest.fn(), Easing: { inOut: jest.fn(), cubic: jest.fn() }, useSharedValue: () => ({ value: 0 }), useAnimatedStyle: () => ({}), withDelay: jest.fn(), withTiming: jest.fn() }));
jest.mock('@/components/Card', () => ({ Card: 'Card' }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/components/match/GameChampionship', () => ({ GameChampionship: 'Championship' }));
jest.mock('@/components/match/tabs/MatchTabShell', () => ({ TabScroll: 'TabScroll', TabSectionTitle: 'SectionTitle', TabEmpty: 'TabEmpty' }));
jest.mock('@/components/match/rotationView', () => jest.requireActual('@/utils/teamIdentity'));
jest.mock('@/theme', () => ({ colors: { primary: '#2563EB', text: '#12234D', textMuted: '#64748B', surface: '#FFF' }, radius: { lg: 16 }, spacing: { sm: 8, md: 12, lg: 16 }, typography: { bodyBold: {}, caption: {} }, RTL_LABEL_ALIGN: 'left' }));

import { ClubStatsSummary, ClubStatsAwards } from '@/components/community/ClubStatsDashboard';
import { MatchStatsTab } from '@/components/match/tabs/MatchStatsTab';
import { he } from '@/i18n/he';
import { isGuestId, GUEST_ID_PREFIX, toGuestRosterId } from '@/types';
import { buildRoundSummary } from '@/utils/roundSummary';
import { liveTeamsEndToEndWorld } from '../helpers/liveTeamsEndToEndWorld';
import { liveTeamsEditContext } from '@/utils/liveTeamsEdit';
import { roundCommitKey } from '@/services/rotationEngine';
import * as teamIdentity from '@/utils/teamIdentity';
const runtime = (React as any).__runtime;
const read = jest.fn();
const mockWatch = jest.fn();
const hydrate = jest.fn();
const focusEffect = (fn: any) => React.useEffect(() => mockFocused ? fn() : undefined, [fn, mockFocused]);

// Execute the product hook itself, without importing unrelated screen actions.
const source = fs.readFileSync('src/screens/games/MatchDetailsScreen.tsx', 'utf8');
const ast = ts.createSourceFile('MatchDetailsScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useMatchRoundSummary')!;
function productFunction(file: string, name: string, context: Record<string, unknown>) {
  const code = fs.readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  return vm.runInNewContext(ts.transpileModule(`${fn.getText(parsed).replace(/^export /, '')}\n${name};`, {
    fileName: 'isolated.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, context);
}
const rosterResolver = productFunction('src/services/gameService.ts', 'resolveRosterEntry', { isGuestId, GUEST_ID_PREFIX });
const summaryResolver = productFunction('src/screens/games/MatchDetailsScreen.tsx', 'resolveMatchSummaryUser', { resolveRosterEntry: rosterResolver, toGuestRosterId });
const hook = vm.runInNewContext(ts.transpileModule(`${declaration.getText(ast)}\nuseMatchRoundSummary;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, {
  React, useRef: React.useRef, useState: React.useState, useFocusEffect: focusEffect,
  roundSummaryService: { get: read, watch: mockWatch }, useUserStore: { getState: () => ({ currentUser: mockViewer }) },
});
const deferred = () => {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const summary = (gameId = 'one', goals = 3) => ({ gameId, groupId: 'club', stats: { rounds: 2, goals, assists: 2, shootouts: 1 }, leaders: {}, events: [], teamHighlights: { best: [], worst: [] }, pairHighlight: null });
function render(gameId = 'one', enabled = true, refreshKey = 0, groupId?: string) {
  runtime.begin(); return hook(gameId, mockViewer?.id, enabled, refreshKey, hydrate, groupId);
}
function tree(state: any, hasPlayed = true, status = 'finished') {
  return MatchStatsTab({ game: { id: 'one', status, players: [], guests: [] } as any, summary: state.summary,
    readStatus: state.status, onRetry: state.retry, nameOf: () => '', userOf: id => ({ id, name: '' }), hasPlayed,
    onOpenPersonalSummary: jest.fn(), showPersonalSummary: false });
}
const expanded = (node: any): any => {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expanded);
  if (typeof node.type === 'function') return expanded(node.type(node.props));
  return { ...node, props: { ...node.props, children: React.Children.toArray(node.props?.children).map(expanded) } };
};
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const copy = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(copy).join(' ') : node && typeof node === 'object' ? copy(node.props?.children) : '';

test('the real history card and statistics tab display the replacement result read back from the complete save/finish pipeline',async()=>{
 const w=liveTeamsEndToEndWorld();
 await w.service.saveLiveTeamsEdit('audit',{playing:[2,3],waiting:[0,1]},liveTeamsEditContext(w.read()),{userId:'owner',userName:'מנהל'});
 await w.service.recordGoal('audit',{team:'B',scorerId:'t3-p0',assisterId:'t3-p1',minute:2,expectedRoundId:roundCommitKey(w.read().rotation!)});
 await w.service.endEvening('audit');await w.finishStages();
 const saved=await w.roundSummaryService.get('audit','club');const rendered=tree({summary:saved,status:'ready'});
 const card=nodes(rendered).find(node=>typeof node.type==='function'&&node.type.name==='ClubStatsSummary');
 expect(card.props).toMatchObject({games:1,goals:1,assists:1,shootouts:0});
 const history=await w.service.getRoundHistory('audit');expect(history).toHaveLength(1);
 const ctx:any={React,View:'View',Text:'Text',Pressable:'Pressable',Ionicons:'Icon',UserAvatar:'Avatar',he,colors:{text:'#111',textMuted:'#777'},styles:{},...teamIdentity,teamColor:teamIdentity.teamTextColor};
 const file='src/screens/games/MatchRoundsScreen.tsx';
 ctx.teamStyle=productFunction(file,'teamStyle',ctx);ctx.resolveTeamIndex=productFunction(file,'resolveTeamIndex',ctx);ctx.RosterRow=productFunction(file,'RosterRow',ctx);
 const roundCard=productFunction(file,'RoundCard',ctx);
 const text=copy(expanded(roundCard({round:history[0],index:0,resolve:(id:string)=>({id,name:id}),identityTeams:w.read().draftTeams!.teams,expanded:true,onToggle:jest.fn()})));
 expect(text).toContain('משחק 1');expect(text).toContain(teamIdentity.teamName(2,w.read().draftTeams!.teams));expect(text).toContain(teamIdentity.teamName(3,w.read().draftTeams!.teams));
 expect(text).toContain(he.matchRoundsWon(teamIdentity.teamName(3,w.read().draftTeams!.teams)));expect(text).toContain('t3-p0');expect(text).toContain(he.matchRoundsAssist('t3-p1'));
 expect(text).not.toContain('t0-p0');expect(text).not.toContain('t1-p0');
});

beforeEach(() => { runtime.reset(); mockFocused = true; mockViewer = { id: 'manager' }; read.mockReset().mockResolvedValue(summary()); mockWatch.mockReset().mockReturnValue(()=>{}); hydrate.mockReset(); });
afterEach(() => runtime.reset());

test('initial read displays loading before focus effects, never a historical no-coverage claim', async () => {
  const pending = deferred(); read.mockReturnValueOnce(pending.promise);
  const initial = expanded(tree(render()));
  expect(copy(initial)).toContain('טוענים את נתוני המחזור');
  expect(nodes(initial).some(node => node.type === 'TabEmpty')).toBe(false);
  runtime.effects(); expect(render().status).toBe('loading');
  pending.resolve(summary()); await flush();
  expect(render().status).toBe('ready'); expect(render().summary.stats.goals).toBe(3);
});

test.each(['open','active'])('an unfinished %s evening explains when statistics become available, even with an old read failure',status=>{
 const rendered=tree({summary:null,status:'error',retry:jest.fn()},false,status);
 expect(copy(expanded(rendered))).toContain('הסטטיסטיקה תופיע בסיום המחזור');
 expect(copy(expanded(rendered))).toContain('תצוגה מקדימה');
 const preview=nodes(rendered).find(node=>typeof node.type==='function' && node.type.name==='StatsPreview');
 expect(nodes(preview.type(preview.props)).find(node=>typeof node.type==='function'&&node.type.name==='ClubStatsSummary').props).toMatchObject({games:'—',goals:'—',assists:'—',shootouts:'—'});
 expect(nodes(preview.type(preview.props)).find(node=>typeof node.type==='function'&&node.type.name==='ClubStatsAwards').props.leaders.every((leader:any)=>leader.value==='—'&&!leader.user)).toBe(true);
 expect(copy(expanded(rendered))).not.toContain('לא הצלחנו');
});

test('a server seal arriving after the initial empty read appears without reopening; blur removes the listener and ignores late updates',async()=>{
 let receive!:(value:any)=>void;const stop=jest.fn();
 mockWatch.mockImplementation((_gameId,_groupId,callback)=>{receive=callback;return stop;});
 read.mockResolvedValueOnce(null);render('one',true,0,'club');runtime.effects();await flush();
 expect(mockWatch).toHaveBeenCalledWith('one','club',expect.any(Function),expect.any(Function));
 receive(summary());expect(render('one',true,0,'club').summary.stats.goals).toBe(3);
 mockFocused=false;render('one',true,0,'club');runtime.effects();expect(stop).toHaveBeenCalledTimes(1);
 receive(summary('one',99));expect(render('one',true,0,'club').summary.stats.goals).toBe(3);
});

test.each([true, false])('only a successful absent document renders the hasPlayed=%s empty state', async hasPlayed => {
  read.mockResolvedValueOnce(null); render(); runtime.effects(); await flush();
  const state = render(), element = tree(state, hasPlayed);
  expect(state.status).toBe('ready');
  const empty = nodes(element).find(node => node.type === 'TabEmpty');
  expect(empty.props.title).toBe(hasPlayed ? he.gdStatsNoCoverageTitle : he.gdStatsEmptyTitle);
});

test('a failed initial read renders retry; retry starts a new read and recovers', async () => {
  read.mockRejectedValueOnce(Error('offline')); render(); runtime.effects(); await flush();
  const failed = expanded(tree(render()));
  expect(copy(failed)).toContain('לא הצלחנו לטעון את נתוני המחזור');
  expect(nodes(failed).some(node => node.type === 'TabEmpty')).toBe(false);
  nodes(failed).find(node => node.props?.testID === 'match-stats-retry').props.onPress();
  render(); runtime.effects(); expect(render().status).toBe('loading');
  await flush(); expect(render().summary.stats.goals).toBe(3); expect(render().status).toBe('ready');
});

test('same-evening focus refresh retains data while loading and after failure, retry replaces it', async () => {
  render(); runtime.effects(); await flush(); render();
  mockFocused = false; render(); runtime.effects();
  const pending = deferred(); read.mockReturnValueOnce(pending.promise);
  mockFocused = true; render(); runtime.effects();
  expect(render().summary.stats.goals).toBe(3); expect(render().status).toBe('loading');
  pending.reject(Error('offline-refresh')); await flush();
  const failed = expanded(tree(render()));
  expect(copy(failed)).toContain('לא הצלחנו לעדכן את נתוני המחזור');
  expect(copy(failed)).toContain('הנתונים שכבר נטענו נשארו מוצגים');
  expect(nodes(failed).some(node => node.type === 'Championship')).toBe(true);
  read.mockResolvedValueOnce(summary('one', 4)); render().retry(); render(); runtime.effects(); await flush();
  expect(render().summary.stats.goals).toBe(4);
});

test('a completed successful missing refresh clears a preceding summary', async () => {
  render(); runtime.effects(); await flush(); render();
  read.mockResolvedValueOnce(null); render('one', true, 1); runtime.effects(); await flush();
  expect(render('one', true, 1)).toMatchObject({ status: 'ready', summary: null });
});

test('changing evening hides old data before effects, and a late old response cannot hydrate or publish', async () => {
  render(); runtime.effects(); await flush(); render();
  const old = deferred(); read.mockReturnValueOnce(old.promise); render('one', true, 1); runtime.effects();
  expect(render('two').summary).toBeNull(); expect(render('two').status).toBe('loading');
  hydrate.mockClear(); old.resolve(summary('one', 9)); await flush();
  expect(render('two').summary).toBeNull(); expect(hydrate).not.toHaveBeenCalled();
  read.mockResolvedValueOnce(summary('two', 5)); runtime.effects(); await flush();
  expect(render('two').summary.stats.goals).toBe(5);
});

test('changing viewer invalidates an unsettled response even before rerender; old data stays hidden', async () => {
  const old = deferred(); read.mockReturnValueOnce(old.promise); render(); runtime.effects();
  mockViewer = { id: 'other' }; old.resolve(summary()); await flush();
  expect(hydrate).not.toHaveBeenCalled(); expect(render().summary).toBeNull();
  runtime.effects(); await flush(); expect(render().summary.stats.goals).toBe(3);
  mockViewer = null; expect(render().summary).toBeNull(); runtime.effects(); expect(read).toHaveBeenCalledTimes(2);
});

test('blur invalidates the current read, and refocus reads again without a duplicate initial request', async () => {
  const old = deferred(); read.mockReturnValueOnce(old.promise); render(); runtime.effects(); render(); runtime.effects();
  expect(read).toHaveBeenCalledTimes(1);
  mockFocused = false; render(); runtime.effects(); old.resolve(summary('one', 8)); await flush();
  expect(hydrate).not.toHaveBeenCalled(); expect(render().summary).toBeNull();
  mockFocused = true; render(); runtime.effects(); await flush(); expect(read).toHaveBeenCalledTimes(2);
  expect(render().summary.stats.goals).toBe(3);
});

test('an unmounted read does not hydrate, and an unvisited statistics pane does not request a summary', async () => {
  render('one', false); runtime.effects(); expect(read).not.toHaveBeenCalled();
  const pending = deferred(); read.mockReturnValueOnce(pending.promise); render(); runtime.effects(); runtime.reset();
  pending.resolve(summary()); await flush(); expect(hydrate).not.toHaveBeenCalled();
});

test('screen wires the owned read status and retry into its statistics tab', () => {
  expect(source).toContain('summary={summaryRead.summary}');
  expect(source).toContain('readStatus={summaryRead.status}');
  expect(source).toContain('onRetry={summaryRead.retry}');
});

test('the shared club summary retains all four round values, including zero shootouts, without inserting a club evening count', () => {
  const saved = { ...summary(), stats: { rounds: 2, goals: 3, assists: 3, shootouts: 0 } };
  const rendered = tree({ summary: saved, status: 'ready' });
  const card = nodes(rendered).find(node => typeof node.type === 'function' && node.type.name === 'ClubStatsSummary');
  expect(card.props).toMatchObject({ games: 2, goals: 3, assists: 3, shootouts: 0 });
  expect(card.props.evenings).toBeUndefined();
  const text=copy(expanded(card));
  expect(text).toContain('0 הכרעות בפנדלים'); expect(text).toMatch(/2\s+משחקים/);
  expect(text).not.toContain('מחזורים');
  expect(saved.stats).toEqual({ rounds: 2, goals: 3, assists: 3, shootouts: 0 });
});

test('equal round leaders retain every named player, guests, names and the shared value', () => {
  const ids=['p1','guest:one','p3','p4'];
  const saved={...summary(),leaders:{topScorers:{userIds:[...ids,'unknown'],value:5}}};
  const rendered=MatchStatsTab({game:{id:'one',status:'finished'} as any,summary:saved as any,
    nameOf:id=>id==='unknown'?'':id==='guest:one'?'אורח':id,
    userOf:id=>({id,name:id==='guest:one'?'אורח':id}),hasPlayed:true,
    onOpenPersonalSummary:jest.fn(),showPersonalSummary:false});
  const awards=nodes(rendered).find(node=>typeof node.type==='function'&&node.type.name==='ClubStatsAwards');
  expect(awards.props.leaders).toHaveLength(1);
  expect([awards.props.leaders[0].user,...awards.props.leaders[0].tiedUsers].map(user=>user.id)).toEqual(ids);
  expect(awards.props.leaders[0]).toMatchObject({value:5,unit:'שערים'});
  const text=copy(expanded(awards));
  expect(text).toContain('אורח'); expect(text).toContain('p4');expect(text).not.toContain('unknown');
});

test('a guest resolves from the evening with its canonical avatar id, without a public user entry', () => {
  const game = { guests: [{ id: 'guest-one', name: '  משה  ' }] };
  expect(summaryResolver('guest:guest-one', game, {})).toEqual({ id: 'guest:guest-one', name: 'משה' });
  expect(summaryResolver('guest-one', game, {})).toEqual({ id: 'guest:guest-one', name: 'משה' });
  expect(summaryResolver('guest:guest-one', { guests: [{ id: 'guest-one', name: 'משה מעודכן' }] }, {}).name).toBe('משה מעודכן');
});

test('real users keep their photo and win a bare-id collision; prefixed guests never inherit cached user identities', () => {
  const players = { same: { displayName: ' משתמש ', avatarId: 'a03', photoUrl: 'https://photo.invalid/one' }, 'guest:same': { displayName: 'wrong cached user' } };
  const game = { guests: [{ id: 'same', name: 'אורח' }] };
  expect(summaryResolver('same', game, players)).toEqual({ id: 'same', name: 'משתמש', avatarId: 'a03', photoUrl: 'https://photo.invalid/one' });
  expect(summaryResolver('guest:same', game, players)).toEqual({ id: 'guest:same', name: 'אורח' });
  expect(summaryResolver('guest:removed', game, {})).toEqual({ id: 'guest:removed', name: '' });
});

test('an existing summary that names guests renders their leading cards, pair and stable avatars', () => {
  const game = { id: 'one', players: [], guests: [{ id: 'scorer', name: 'אסף' }, { id: 'assist', name: 'משה' }] };
  const saved = { ...summary(), leaders: {
    topScorers: { userIds: ['guest:scorer'], value: 3 }, topAssisters: { userIds: ['guest:assist'], value: 2 },
  }, pairHighlight: { userIds: ['guest:scorer', 'guest:assist'], goals: 2 } };
  const rendered = expanded(MatchStatsTab({ game: game as any, summary: saved as any,
    nameOf: id => summaryResolver(id, game, {}).name, userOf: id => summaryResolver(id, game, {}),
    hasPlayed: true, onOpenPersonalSummary: jest.fn(), showPersonalSummary: false }));
  expect(copy(rendered)).toContain('אסף'); expect(copy(rendered)).toContain('משה');
  const avatars = nodes(rendered).filter(node => node.type === 'Avatar');
  expect(avatars.map(node => node.props.user.id)).toEqual(['guest:scorer', 'guest:assist', 'guest:scorer', 'guest:assist']);
  expect(avatars.map(node => node.props.user.name)).toEqual(['אסף', 'משה', 'אסף', 'משה']);
  const table = nodes(rendered).find(node => node.type === 'Championship');
  expect(table.props.attendedUids).toEqual(['guest:scorer', 'guest:assist']);
  expect(table.props.guests).toEqual(game.guests);
});

test('unknown removed guests do not invent a leading card or pair from placeholder names', () => {
  const game = { id: 'one', players: [], guests: [] };
  const saved = { ...summary(), leaders: { topScorers: { userIds: ['guest:removed'], value: 2 } }, pairHighlight: { userIds: ['guest:removed', 'guest:other'], goals: 2 } };
  const rendered = expanded(MatchStatsTab({ game: game as any, summary: saved as any,
    nameOf: id => summaryResolver(id, game, {}).name, userOf: id => summaryResolver(id, game, {}),
    hasPlayed: true, onOpenPersonalSummary: jest.fn(), showPersonalSummary: false }));
  expect(nodes(rendered).filter(node => node.type === 'Avatar')).toHaveLength(0);
});

test('the actual summary builder includes guest totals without awarding new club titles', () => {
  const saved = buildRoundSummary({ gameId: 'one', groupId: 'club', at: 1, now: 2,
    players: [{ userId: 'user', goals: 1, assists: 0, wins: 1, cleanSheets: 0, rounds: 1 },
      { userId: 'guest:scorer', isGuest: true, goals: 3, assists: 0, wins: 1, cleanSheets: 0, rounds: 1 },
      { userId: 'guest:assist', isGuest: true, goals: 0, assists: 2, wins: 1, cleanSheets: 0, rounds: 1 }],
    rounds: [{ teamAIndex: 0, teamBIndex: 1, winnerSide: 'A', shootout: false,
      goals: [{ scorerId: 'guest:scorer', assisterId: 'guest:assist', ownGoal: false, team: 'A' },
        { scorerId: 'guest:scorer', assisterId: 'guest:assist', ownGoal: false, team: 'A' },
        { scorerId: 'guest:scorer', assisterId: null, ownGoal: false, team: 'A' },
        { scorerId: 'user', assisterId: null, ownGoal: false, team: 'A' }] }],
    career: [], club: { goals: 4, assists: 2, rounds: 1, cleanSheets: 0, shootoutRounds: 0, evenings: 1 },
    records: null, personalBests: {}, standings: [], basis: { since: null, eveningsCompared: 0 },
  });
  expect(saved.stats).toMatchObject({ goals: 4, assists: 2, rounds: 1 });
  expect(saved.leaders.topScorers).toEqual({ userIds: ['user'], value: 1 });
  expect(saved.leaders.topAssisters).toBeNull();
});

test.each([
  ['white', [{ index: 2, colorKey: 'white' }, { index: 0, colorKey: 'yellow' }], 'הלבנים', 'הצהובים'],
  ['swapped', [{ index: 0, colorKey: 'blue' }, { index: 2, colorKey: 'red' }], 'האדומים', 'הכחולים'],
  ['default', undefined, 'הירוקים', 'האדומים'],
  ['unknown-colour fallback', [{ index: 2, colorKey: 'unknown' }], 'הירוקים', 'האדומים'],
])('team highlights use %s saved colours without changing wins, losses or totals', (_label, teams, bestName, worstName) => {
  const game = { id: 'one', players: [], guests: [], draftTeams: teams ? { teams } : undefined };
  const saved = { ...summary(), teamHighlights: {
    best: [{ colourIndex: 2, wins: 2, losses: 0, played: 2 }],
    worst: [{ colourIndex: 0, wins: 0, losses: 2, played: 2 }],
  } };
  const before = JSON.stringify(saved);
  const rendered = MatchStatsTab({ game: game as any, summary: saved as any,
    nameOf: () => '', userOf: id => ({ id, name: '' }),
    hasPlayed: true, onOpenPersonalSummary: jest.fn(), showPersonalSummary: false });
  const highlights = nodes(rendered).filter(node => typeof node.type === 'function' && node.type.name === 'TeamCard');
  expect(highlights.map(node => node.props.team)).toEqual([bestName, worstName]);
  expect(highlights.map(node => node.props.detail)).toEqual([he.gdTeamWinsUnit(2), he.gdTeamLossesUnit(2)]);
  const numbers = nodes(rendered).find(node => typeof node.type === 'function' && node.type.name === 'ClubStatsSummary');
  expect(numbers.props).toMatchObject({games:2,goals:3,assists:2,shootouts:1});
  const visual = expanded(rendered);
  expect(copy(visual)).toContain(bestName); expect(copy(visual)).toContain(worstName);
  expect(JSON.stringify(saved)).toBe(before);
});



test('the existing club summary still separates evenings from games and does not show round shootouts', () => {
  const rendered=expanded(ClubStatsSummary({goals:31,assists:18,games:10,evenings:4}));
  expect(copy(rendered)).toMatch(/4\s+מחזורים/);
  expect(copy(rendered)).toMatch(/10\s+משחקים/);
  expect(copy(rendered)).not.toContain('פנדלים');
});

test('an existing club award still opens its only real player; preview awards cannot open a profile', () => {
  const onPlayerPress=jest.fn();
  const rendered=expanded(ClubStatsAwards({leaders:[{title:'מלך השערים',user:{id:'p1',name:'אלין'},value:6,unit:'שערים'}],onPlayerPress}));
  const row=nodes(rendered).find(node=>node.type==='Pressable');
  expect(row.props.disabled).toBe(false);row.props.onPress();expect(onPlayerPress).toHaveBeenCalledWith('p1');
  const preview=expanded(ClubStatsAwards({leaders:[{title:'מלך השערים',value:'—',unit:'שערים'}],onPlayerPress}));
  expect(nodes(preview).find(node=>node.type==='Pressable').props.disabled).toBe(true);
  expect(nodes(preview).filter(node=>node.type==='Avatar')).toHaveLength(0);
});
