import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as chronology from '../../src/utils/leaderChronology';

test('the displayed crown uses chronology and keeps the same-round random choice across rerenders', () => {
  const source = fs.readFileSync('src/screens/communities/CommunityStatsScreen.tsx', 'utf8');
  const code = source.slice(source.indexOf('  const leaderMetrics:'), source.indexOf('\n  return (', source.indexOf('  const leaderMetrics:')));
  const he = { communityStatsTopScorer: 'scorer' };
  const context = {
    ...chronology, he, groupId: 'club', recordWindow: {}, visible: true, useEffect: jest.fn(), readLeaderHistory: jest.fn(), viewChamp: {},
    derived: { players: [{ uid: 'later', goals: 20 }, { uid: 'first', goals: 20 }] },
    baseLeaderItems: [{ title: 'scorer', uid: 'later', value: 20, unit: 'goals' }],
    mostLoyal: null, scope: { k: 'all' }, attended: {}, rateScope: false,
    leaderHistory: { key: JSON.stringify(['club', {}]), rows: [{ uid: 'first', gameId: 'one', at: 1, values: { goals: 20 } }, { uid: 'later', gameId: 'two', at: 2, values: { goals: 20 } }] },
    leaderDraws: { current: new Map() }, setLeaderHistory: jest.fn(),
  };
  const output = ts.transpileModule(`(()=>{${code};return leaderItems;})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  expect(vm.runInNewContext(output, context)[0].uid).toBe('first');
  context.leaderHistory.rows[1].at = 1;
  const chosen = vm.runInNewContext(output, context)[0].uid;
  expect(vm.runInNewContext(output, context)[0].uid).toBe(chosen);
  context.leaderHistory.rows.pop();
  expect(vm.runInNewContext(output, context)[0].uid).toBe('later');
});
