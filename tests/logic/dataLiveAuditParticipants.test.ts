import fs from 'fs';
import path from 'path';
import { roundParticipantSides } from '@/utils/roundParticipants';
import { roundParticipantSides as serverParticipants } from '../../functions/src/roundParticipants';
import { reduceRounds, type RoundHistoryDoc } from '@/utils/eveningStats';

describe.each([['client', roundParticipantSides], ['server', serverParticipants]] as const)(
  '%s historical participation', (_name, participants) => {
    it('restores guest scorer and assister after substitution without mutating a current lineup', () => {
      const args = {
        teamA: ['a', 'guest:replacement'], teamB: ['b'],
        goals: [{ scorerId: 'guest:scorer', assisterId: 'guest:assister', team: 'A' }],
      };
      const before = JSON.parse(JSON.stringify(args));
      expect(participants(args)).toEqual({
        teamA: ['a', 'guest:replacement', 'guest:scorer', 'guest:assister'], teamB: ['b'],
      });
      expect(args).toEqual(before);
    });

    it('deduplicates repeated evidence and keeps an existing side over a conflicting old event', () => {
      const goal = { scorerId: 'guest:out', assisterId: 'guest:out', team: 'A' };
      expect(participants({ teamA: ['a', 'a'], teamB: ['a', 'b', 'guest:on-b'], goals: [goal, goal,
        { scorerId: 'guest:on-b', team: 'A' }],
      })).toEqual({ teamA: ['a', 'guest:out'], teamB: ['b', 'guest:on-b'] });
    });

    it('places an own-goal scorer on the conceding side and does not invent an assist', () => {
      expect(participants({ teamA: ['a'], teamB: ['b'], goals: [
        { scorerId: 'guest:own', assisterId: 'guest:false-assist', ownGoal: true, team: 'A' },
        { scorerId: null, assisterId: 'guest:unknown-assist', team: 'A' },
      ] })).toEqual({ teamA: ['a'], teamB: ['b', 'guest:own'] });
    });

    it('requires valid registration on write, including for restored contributors', () => {
      const valid = new Set(['a', 'b', 'guest:valid']);
      expect(participants({ teamA: ['a'], teamB: ['b'], eligible: id => valid.has(id), goals: [
        { scorerId: 'a', assisterId: 'guest:valid', team: 'A' },
        { scorerId: 'guest:forged', assisterId: 'guest:forged-assist', team: 'B' },
        { scorerId: 'guest:no-show', team: 'A' },
      ] })).toEqual({ teamA: ['a', 'guest:valid'], teamB: ['b'] });
    });

    it('does not guess a side when the old goal has no valid team', () => {
      expect(participants({ teamA: ['a'], teamB: ['b'], goals: [
        { scorerId: 'guest:no-side', assisterId: 'guest:other' },
      ] })).toEqual({ teamA: ['a'], teamB: ['b'] });
    });

    it('does not restore a waiting guest after the only goal was removed', () => {
      expect(participants({ teamA: ['a'], teamB: ['b'], goals: [] })).toEqual({ teamA: ['a'], teamB: ['b'] });
    });

    it('retains the existing persisted display-side bound', () => {
      expect(participants({ teamA: ['a', 'a2'], teamB: ['b'], maxSide: 2,
        goals: [{ scorerId: 'guest:out', team: 'A' }],
      })).toEqual({ teamA: ['a', 'a2'], teamB: ['b'] });
    });
  },
);

test('client and generated server participation helpers cannot drift', () => {
  const root = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(root, 'src/utils/roundParticipants.ts'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'functions/src/roundParticipants.ts'), 'utf8');
  expect(server.startsWith('// GENERATED FILE — DO NOT EDIT.')).toBe(true);
  expect(server.slice(server.indexOf('// Completed-game participation'))).toBe(source);
});

test.each(['scorer', 'assister'] as const)('the history reducer includes an outgoing guest %s only in the game they contributed to', role => {
  const first: RoundHistoryDoc = { roundId: 'r1', teamA: ['a', 'guest:in'], teamB: ['b'],
    scoreA: 1, scoreB: 0, winnerSide: 'A', at: 1,
    goals: [{ scorerId: role === 'scorer' ? 'guest:out' : 'a', assisterId: role === 'assister' ? 'guest:out' : null, ownGoal: false, team: 'A' }],
  };
  const next: RoundHistoryDoc = { roundId: 'r2', teamA: ['a', 'guest:in'], teamB: ['b'],
    scoreA: 2, scoreB: 0, winnerSide: 'A', at: 2,
    goals: [{ scorerId: 'a', assisterId: null, ownGoal: false, team: 'A' }, { scorerId: 'guest:in', assisterId: null, ownGoal: false, team: 'A' }],
  };
  expect(reduceRounds('guest:out', [first, next])).toMatchObject({
    playedRounds: 1, heldPitch: 1, teamGoalsFor: 1, teamGoalsAgainst: 0,
    contribution: { pct: 100, touched: 1, teamGoals: 1 },
    bestMiniGame: { round: 1, goals: role === 'scorer' ? 1 : 0, assists: role === 'assister' ? 1 : 0 },
  });
  expect(first.teamA).not.toContain('guest:out');
  expect(next.teamA).not.toContain('guest:out');
});
