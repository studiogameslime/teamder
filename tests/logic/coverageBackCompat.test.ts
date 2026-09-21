import { readSeasonCoverage } from '@/utils/seasonCoverage';

// Backward compatibility: the 1.1.10 client must not care that `coverage`
// exists.
//
// The field is additive, and the reason it is SAFE to add is a property of the
// shipped readers rather than a promise: both of them rebuild their objects
// field by field, picking `key`, `names` and `value` and ignoring everything
// else. Nothing in 1.1.10 validates an archive strictly, whitelists the keys a
// winner may carry, or rejects a document with a field it does not know.
//
// This file re-implements those two shipped readers EXACTLY as
// `git show 4de80d0:src/services/...` has them, and runs winners with and
// without coverage through them. If a future change to the field's shape would
// break the build that is in the stores, it breaks here first.

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const KEYS = ['topScorer','topAssister','mvp','topWinner','mostLoyal',
              'cleanSheetKing','penaltyKing','penaltyKeeper','deadlyDuo'];

/** seasonHistoryService.fromCard's winner loop, as shipped in 1.1.10. */
function shippedCardReader(rawWinners: unknown) {
  const raw = Array.isArray(rawWinners) ? rawWinners : [];
  const known = new Set<string>(KEYS);
  const out: { key: string; names: string[]; value: number }[] = [];
  for (const w of raw) {
    if (typeof w !== 'object' || w === null) continue;
    const x = w as Record<string, unknown>;
    const key = str(x.key);
    if (!known.has(key)) continue;
    const names = Array.isArray(x.names)
      ? x.names.filter((n): n is string => typeof n === 'string')
      : [];
    if (names.length === 0) continue;
    out.push({ key, names, value: num(x.value) });
  }
  return out;
}

/** seasonSummaryService's awards loop, as shipped in 1.1.10. */
function shippedAwardsReader(awards: Record<string, unknown>) {
  const out: { key: string; value: number; holders: number }[] = [];
  for (const key of KEYS) {
    const a = awards[key] as { winners?: unknown; value?: unknown } | null | undefined;
    if (!a || !Array.isArray(a.winners) || a.winners.length === 0) continue;
    const holders = a.winners.filter((w): w is string => typeof w === 'string');
    out.push({ key, value: num(a.value), holders: holders.length });
  }
  return out;
}

const WITHOUT = [
  { key: 'topScorer', names: ['הלן צברי'], value: 10 },
  { key: 'mvp', names: ['הלן צברי'], value: 7.656 },
];
const WITH = [
  { key: 'topScorer', names: ['הלן צברי'], value: 10 },
  { key: 'mvp', names: ['הלן צברי'], value: 7.656, coverage: { rated: 9, of: 22 } },
];

describe('the card reader shipped in 1.1.10', () => {
  it('reads a winner that carries coverage exactly as one that does not', () => {
    expect(shippedCardReader(WITH)).toEqual(shippedCardReader(WITHOUT));
  });

  it('and still gets the value it came for', () => {
    const r = shippedCardReader(WITH);
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({ key: 'mvp', names: ['הלן צברי'], value: 7.656 });
    // The field is simply not in the object it built.
    expect(Object.keys(r[1])).toEqual(['key', 'names', 'value']);
  });

  it('is unmoved by a malformed coverage too', () => {
    // A half-written field must not be able to break an old client either —
    // the new reader drops it, and the old one never looked.
    const broken = [{ key: 'mvp', names: ['x'], value: 7.6, coverage: { rated: 'nine' } }];
    expect(shippedCardReader(broken)).toEqual([{ key: 'mvp', names: ['x'], value: 7.6 }]);
  });
});

describe('the awards reader shipped in 1.1.10', () => {
  const plain = { mvp: { winners: ['u1'], value: 7.656 } };
  const withCov = { mvp: { winners: ['u1'], value: 7.656, coverage: { rated: 9, of: 22 } } };

  it('reads an award that carries coverage exactly as one that does not', () => {
    expect(shippedAwardsReader(withCov)).toEqual(shippedAwardsReader(plain));
  });

  it('and the value is untouched', () => {
    expect(shippedAwardsReader(withCov)[0].value).toBe(7.656);
  });
});

describe('and the NEW reader agrees about what is there', () => {
  it('sees the coverage the old client ignored', () => {
    expect(readSeasonCoverage(WITH[1])).toEqual({ rated: 9, of: 22 });
    expect(readSeasonCoverage(WITHOUT[1])).toBeUndefined();
  });
});
