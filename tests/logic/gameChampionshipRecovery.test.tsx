import React from 'react';
jest.mock('react', () => {
  let slots: any[] = [], cursor = 0, effects: Array<() => void> = [];
  return { ...jest.requireActual('react'),
    __runtime: { begin: () => { cursor = 0; }, run: () => { const pending = effects; effects = []; pending.forEach(fn => fn()); }, reset: () => { slots.forEach(s => s?.cleanup?.()); slots = []; effects = []; } },
    useState: (initial: any) => { const i = cursor++; if (!slots[i]) slots[i] = { value: initial }; return [slots[i].value, (v: any) => { slots[i].value = typeof v === 'function' ? v(slots[i].value) : v; }]; },
    useEffect: (effect: any, deps: any[]) => { const i = cursor++; if (JSON.stringify(slots[i]?.deps) !== JSON.stringify(deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = effect(); }); } },
  };
});
jest.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (v: any) => v } }));
jest.mock('@/components/community/CommunityStatsTable', () => ({ CommunityStatsTable: 'Table' }));
jest.mock('@/services', () => ({ gameService: { getGameChampionship: jest.fn() } }));
jest.mock('@/services/gameEveningScores', () => ({ getGameEveningScores: jest.fn(async () => ({})) }));
jest.mock('@/theme', () => ({ colors: {}, spacing: {}, typography: {}, RTL_LABEL_ALIGN: 'left' }));
import { GameChampionship } from '@/components/match/GameChampionship';
import { gameService } from '@/services';
const read = gameService.getGameChampionship as jest.Mock;
const runtime = (React as any).__runtime;
const nodes = (n: any): any[] => n && typeof n === 'object' ? [n, ...React.Children.toArray(n.props?.children).flatMap(nodes)] : [];
const render = (id = 'round') => { runtime.begin(); return GameChampionship({ gameId: id }); };
const flush = () => new Promise<void>(done => setImmediate(done));
beforeEach(() => { runtime.reset(); read.mockReset(); });

test('leaderboard failures show a retry action and a later successful read restores rows', async () => {
  read.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({ players: [{ userId: 'one' }] });
  render(); runtime.run(); await flush();
  const failed = render();
  expect(nodes(failed).some(n => n.type === 'Table')).toBe(false);
  const retry = nodes(failed).find(n => n.props.accessibilityRole === 'button');
  expect(retry).toBeDefined(); retry.props.onPress();
  render(); runtime.run(); await flush();
  expect(nodes(render()).find(n => n.type === 'Table')?.props.players).toEqual([{ userId: 'one' }]);
});
test('switching rounds hides previous rows immediately and ignores their late reply', async () => {
  let resolve!: (v: any) => void;
  read.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ players: [{ userId: 'new' }] });
  render('old'); runtime.run();
  expect(render('new')).toBeNull(); runtime.run(); await flush();
  resolve({ players: [{ userId: 'old' }] }); await flush();
  expect(nodes(render('new')).find(n => n.type === 'Table')?.props.players).toEqual([{ userId: 'new' }]);
});
