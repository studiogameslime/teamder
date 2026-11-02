import crypto from 'crypto';
import baseline from '../fixtures/team-balance-before-2026-10-12.json';
import { balanceCore, type BalanceStrategy } from '../../src/utils/teamBalanceCore';

// A intentionally changed with the approved priority model. B remains a useful
// historical regression for the compiled repeat scorer; A has independent
// exhaustive-oracle and approved-roster tests in balancePriority.test.ts.
test.each(baseline.cases.filter(c => c.strategy === 'B'))('legacy B preserves the pre-fix split: $strategy, seed $seed', ({ strategy, seed, sha256 }) => {
  let state = seed;
  const result = balanceCore({ ...baseline.input, strategy: strategy as BalanceStrategy, rng: () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296) });
  expect(crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex')).toBe(sha256);
});
