import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { clubLeaderDisplay } from '../../src/utils/clubLeaderDisplay';

function display(players: any[], overrides: object = {}) {
  const source = fs.readFileSync('src/screens/communities/CommunityStatsScreen.tsx', 'utf8');
  const code = source.slice(source.indexOf('  const leaderMetrics:'), source.indexOf('\n  return (', source.indexOf('  const leaderMetrics:')));
  const context = {
    clubLeaderDisplay, he: { communityStatsTopScorer: 'scorer', communityStatsMostLoyal: 'attendance', communityStatsPenaltyKing: 'penalty' },
    derived: { players }, baseLeaderItems: [{ title: 'scorer', uid: players[0].uid, value: 20 }],
    mostLoyal: null, scope: { k: 'all' }, attended: {}, rateScope: false,
    ...overrides,
  };
  const output = ts.transpileModule(`(()=>{${code};return leaderItems;})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(output, context);
}

test('equal leaders keep the same representative after a reordered refresh', () => {
  const players = [{ uid: 'later', goals: 20 }, { uid: 'first', goals: 20 }, { uid: 'other', goals: 19 }];
  expect(display(players)[0]).toMatchObject({ uid: 'first', tiedIds: ['later'] });
  expect(display([...players].reverse())[0]).toMatchObject({ uid: 'first', tiedIds: ['later'] });
});

test('the current attendance crown uses actual attended evenings', () => {
  expect(display([{ uid: 'b', games: 4 }, { uid: 'a', games: 9 }], {
    scope: { k: 'current' }, attended: { a: 5, b: 5 }, baseLeaderItems: [{ title: 'attendance', uid: 'b', value: 5 }],
  })[0]).toMatchObject({ uid: 'a', tiedIds: ['b'] });
});

test('penalty co-leaders keep the existing count and attempts tie criteria', () => {
  const players = [{ uid: 'b', penScored: 3, penTaken: 4 }, { uid: 'a', penScored: 3, penTaken: 4 }, { uid: 'c', penScored: 3, penTaken: 10 }];
  expect(display(players, { derived: { players, penaltyKing: { count: 3, attempts: 4 } },
    baseLeaderItems: [{ title: 'penalty', uid: 'b', value: 75 }],
  })[0]).toMatchObject({ uid: 'a', tiedIds: ['b'] });
});
