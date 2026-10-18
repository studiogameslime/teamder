import { mockGame, mockGamesV2, mockPlayers } from '@/data/mockData';
import { gameService } from '@/services/gameService';
import type { Game, PenaltyOutcome } from '@/types';

const names = ['אלין','אלרואי','נדב','ליאור','אורי','רון','בן','אסף','איתי','נועם','אדם','משה','יוסי','תומר','גל','עידו','ערן','דניאל','עומר','יובל','גיא','רועי','רז','שי','אביב','ניב','שחר','מתן','תום','אופיר','אייל','זיו','ארז'];
const originalRecord = gameService.recordShootoutKick;
const originalGoal = gameService.recordGoal;

/** Native preview fixtures only. No account, club or Firebase document is created. */
export function liveGameFixture(kind: string, managerId: string): Game {
  if (!__DEV__ || process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK !== '1') throw new Error('Local mock preview only');
  gameService.recordShootoutKick = originalRecord;
  gameService.recordGoal = originalGoal;
  const size = kind.includes('large') ? 11 : kind.includes('seven') ? 7 : kind.includes('four') ? 4 : 5;
  const count = kind.includes('5') || (kind.includes('active') && kind.includes('large')) ? 5 : 3;
  const originals = mockPlayers.filter(p => !p.id.startsWith('qa-live-design-player-'));
  const ids = Array.from({ length: count * size }, (_, i) => {
    const id = `qa-live-design-player-${i}`;
    if (!mockPlayers.some(p => p.id === id)) mockPlayers.push({ ...originals[i % originals.length], id, displayName: names[i % names.length] + (i >= names.length ? ` ${i + 1}` : '') });
    return id;
  });
  const mode = kind.includes('permanent') ? 'permanent' as const : 'temporary' as const;
  const start = kind.startsWith('start') || kind === 'fill3';
  const { useGameStore } = require('@/store/gameStore') as typeof import('@/store/gameStore');
  useGameStore.setState({ players: { ...useGameStore.getState().players, ...Object.fromEntries(mockPlayers.filter(p => ids.includes(p.id)).map(p => [p.id, p])) } });
  const game: Game = { ...(mockGamesV2.find(g => g.id === 'gv2-live3') ?? mockGame),
    id: `qa-live-design-${kind}-${Date.now()}`, title: 'ליגת השכונה', groupId: 'g1', createdBy: managerId,
    players: ids, guests: [], advancedMode: !kind.includes('plain'), advancedFillMode: mode, numberOfTeams: count,
    format: size === 11 ? '11v11' : size === 7 ? '7v7' : size === 4 ? '4v4' : '5v5', status: 'active', matchDurationMinutes: 15,
    updatedAt: Date.now(), lastCommittedRoundId: undefined,
    draftTeams: { ...(mockGamesV2.find(g => g.draftTeams)?.draftTeams!), fillMode: mode, leftHome: [],
      completionMode: kind === 'fill3' ? 'balanced' : undefined,
      teams: Array.from({ length: count }, (_, index) => ({ index, captainId: ids[index * size], playerIds: ids.slice(index * size, (index + 1) * size).slice(0, kind === 'fill3' && index < 2 ? 4 : size) })),
    },
    rotation: start ? undefined : { playing: [0,1], waiting: Array.from({length:count-2},(_,i)=>i+2), loans: [], round: 1, roundInstanceId: `qa-live-design-round-${Date.now()}`, roundInstanceRound: 1, updatedAt: Date.now(), wins: { '0': 2, '1': 1 } },
    liveMatch: { ...(mockGamesV2.find(g => g.liveMatch)?.liveMatch!), phase: 'roundRunning', scoreA: start ? 0 : 2, scoreB: start ? 0 : kind.includes('penalties') ? 2 : 1,
      goals: [], goalTally: {}, shootout: undefined, timerRunning: false, timerLastStartedAt: null, timerAccumulatedMs: start ? 0 : 120000, timerEvents: [] },
  };
  if (kind.includes('penalties')) {
    const amount = kind.includes('unequal') ? 3 : kind.endsWith('_tie') ? 2 : kind.includes('history') ? 24 : 0;
    game.liveMatch!.shootout = { firstTeam: 'A', keeperA: amount || kind.includes('failure') ? ids[0] : null, keeperB: amount || kind.includes('failure') ? ids[size] : null,
      kicks: Array.from({ length: amount }, (_, i) => { const outcome: PenaltyOutcome = kind.endsWith('_tie') ? 'goal' : i % 2 === 0 ? 'goal' : 'miss'; return { id: `qa-kick-${i}`, team: i % 2 === 0 ? 'A' : 'B', kickerId: ids[i % 2 === 0 ? 1 : size + 1], keeperId: ids[i % 2 === 0 ? size : 0], scored: outcome === 'goal', outcome, at: Date.now() + i }; }) };
  }
  if (kind.includes('failure')) gameService.recordShootoutKick = async (...args) => {
    gameService.recordShootoutKick = originalRecord;
    if (args[0] === game.id) throw new Error('Local simulated failure');
    return originalRecord.apply(gameService, args);
  };
  if (kind.includes('goal_failure')) gameService.recordGoal = async (...args) => {
    gameService.recordGoal = originalGoal;
    if (args[0] === game.id) throw new Error('Local simulated goal failure');
    return originalGoal.apply(gameService, args);
  };
  mockGamesV2.push(game);
  return game;
}
