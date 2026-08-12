// Who gets credited for an assist.
//
// ⚠️ MIRRORED from the assist loop in functions/src/index.ts (commitRoundStats).
// The Cloud Function can't import from src/, so this encodes the decision table
// it implements. Keep the two in sync — this test exists because the rule was
// wrong in production and the failure was silent.

/** A real Firebase uid: not guest-prefixed, not a legacy raw guest id. */
const RAW_GUEST_RE = /^[0-9a-z]+-[0-9a-z]+$/;
const isReal = (id: string) =>
  typeof id === 'string' && !!id && !id.startsWith('guest:') && !RAW_GUEST_RE.test(id);

interface Goal {
  scorerId: string | null;
  assisterId: string | null;
  ownGoal?: boolean;
}

/** The rule as the function now implements it. */
function creditAssists(
  goals: Goal[],
  onField: Set<string>,
  guestRoster: Set<string>,
): { assists: Record<string, number>; pairs: Array<[string, string]> } {
  const scorerPlayed = (id: string) =>
    (isReal(id) && onField.has(id)) || guestRoster.has(id);
  const assists: Record<string, number> = {};
  const pairs: Array<[string, string]> = [];
  for (const g of goals) {
    if (g.ownGoal || !g.scorerId || !scorerPlayed(g.scorerId)) continue;
    if (!g.assisterId || !isReal(g.assisterId) || g.assisterId === g.scorerId) continue;
    if (!onField.has(g.assisterId)) continue;
    assists[g.assisterId] = (assists[g.assisterId] ?? 0) + 1;
    if (isReal(g.scorerId)) pairs.push([g.assisterId, g.scorerId]);
  }
  return { assists, pairs };
}

const OMRI = 'OmriRealUid00000000000000000';
const DANI = 'DaniRealUid00000000000000000';
const GUEST = 'guest:abc123';
const onField = new Set([OMRI, DANI]);
const guests = new Set([GUEST]);

describe('an assist to a guest still counts', () => {
  it('credits the setter when the scorer is a guest', () => {
    // The reported bug: two goals laid on for a guest showed in the match
    // history and never reached the assister's stats or the club table.
    const { assists } = creditAssists(
      [
        { scorerId: GUEST, assisterId: OMRI },
        { scorerId: GUEST, assisterId: OMRI },
      ],
      onField,
      guests,
    );
    expect(assists[OMRI]).toBe(2);
  });

  it('keeps the guest out of the head-to-head pairs', () => {
    // A pair doc keyed on a guest id belongs to nobody.
    const { pairs } = creditAssists(
      [{ scorerId: GUEST, assisterId: OMRI }],
      onField,
      guests,
    );
    expect(pairs).toEqual([]);
  });

  it('still records the pair between two real players', () => {
    const { pairs } = creditAssists(
      [{ scorerId: DANI, assisterId: OMRI }],
      onField,
      guests,
    );
    expect(pairs).toEqual([[OMRI, DANI]]);
  });
});

describe('what an assist still requires', () => {
  it('rejects a guest who is not registered to this game', () => {
    // Same anti-forgery guard a real roster gives: an unknown guest id can't
    // manufacture assists for a friend.
    const { assists } = creditAssists(
      [{ scorerId: 'guest:not-in-this-game', assisterId: OMRI }],
      onField,
      guests,
    );
    expect(assists[OMRI]).toBeUndefined();
  });

  it('rejects an assister who did not play the round', () => {
    const { assists } = creditAssists(
      [{ scorerId: GUEST, assisterId: 'BenchedUid000000000000000000' }],
      onField,
      guests,
    );
    expect(Object.keys(assists)).toHaveLength(0);
  });

  it('never credits an assist on an own goal', () => {
    const { assists } = creditAssists(
      [{ scorerId: GUEST, assisterId: OMRI, ownGoal: true }],
      onField,
      guests,
    );
    expect(Object.keys(assists)).toHaveLength(0);
  });

  it('never lets a guest be the assister', () => {
    const { assists } = creditAssists(
      [{ scorerId: DANI, assisterId: GUEST }],
      onField,
      guests,
    );
    expect(Object.keys(assists)).toHaveLength(0);
  });
});
