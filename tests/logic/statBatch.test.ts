// Batch-size safety for commitRoundStats (audit P1-12), and proof that
// de-duplicating per document keeps the round's stats arithmetically identical.
//
// Why this matters more than a normal size check: the idempotency latch
// (`committedRounds/{roundId}`) is created INSIDE the same WriteBatch as the
// increments. If that batch overflows Firestore's 500-operation limit, commit()
// throws, the latch never lands, and every retry with the same payload
// overflows in exactly the same place — the evening's stats are lost with no
// path to recovery. So the ceiling has to be proven, not estimated in a comment.

import {
  StatBatch,
  MAX_ROUND_BATCH_OPS,
  worstCaseRoundOps,
} from '../../functions/src/statBatch';

/** Stand-in for a DocumentReference: all StatBatch needs is a stable path. */
const ref = (path: string) => ({ path });

/** Records what a real WriteBatch would have been told to do. */
function recorder() {
  const ops: { kind: 'create' | 'set'; path: string; data: Record<string, unknown> }[] = [];
  return {
    ops,
    create(r: { path: string }, data: Record<string, unknown>) {
      ops.push({ kind: 'create', path: r.path, data });
      return this;
    },
    set(r: { path: string }, data: Record<string, unknown>) {
      ops.push({ kind: 'set', path: r.path, data });
      return this;
    },
  };
}

/** Stands in for FieldValue.increment — keeps the delta readable. */
const inc = (n: number) => ({ __inc: n });

describe('StatBatch — one operation per document', () => {
  it('folds repeated increments on the same field into their sum', () => {
    const sb = new StatBatch();
    const r = ref('gamePlayerStats/g__u');
    sb.bump(r, { gameId: 'g' }, { goals: 2 });
    sb.bump(r, { userId: 'u' }, { goals: 3 });

    expect(sb.opCount).toBe(1);
    const rec = sb.build(recorder(), inc);
    expect(rec.ops).toHaveLength(1);
    expect(rec.ops[0].data).toEqual({ gameId: 'g', userId: 'u', goals: { __inc: 5 } });
  });

  it('merges different fields of one document into a single write', () => {
    const sb = new StatBatch();
    const r = ref('gamePlayerStats/g__u');
    sb.bump(r, { gameId: 'g', userId: 'u' }, { goals: 1 });
    sb.bump(r, { updatedAt: 7 }, { assists: 2 });
    sb.bump(r, {}, { rounds: 1, cleanSheets: 1 });
    sb.bump(r, {}, { wins: 1 });

    // The old code spent four operations here. Same stored result, one op.
    expect(sb.opCount).toBe(1);
    expect(sb.build(recorder(), inc).ops[0].data).toEqual({
      gameId: 'g',
      userId: 'u',
      updatedAt: 7,
      goals: { __inc: 1 },
      assists: { __inc: 2 },
      rounds: { __inc: 1 },
      cleanSheets: { __inc: 1 },
      wins: { __inc: 1 },
    });
  });

  it('expands dotted paths into the nested map the document expects', () => {
    const sb = new StatBatch();
    sb.bump(ref('users/u'), {}, { 'stats.goals': 2, 'stats.wins': 1 });
    expect(sb.build(recorder(), inc).ops[0].data).toEqual({
      stats: { goals: { __inc: 2 }, wins: { __inc: 1 } },
    });
  });

  it('keeps creates separate from merges — the latch must stay a create', () => {
    const sb = new StatBatch();
    sb.create(ref('games/g/committedRounds/3'), { committedAt: 1 });
    sb.bump(ref('users/u'), {}, { 'stats.goals': 1 });
    const rec = sb.build(recorder(), inc);
    expect(rec.ops.map((o) => o.kind)).toEqual(['create', 'set']);
    expect(sb.opCount).toBe(2);
  });

  it('ignores non-finite deltas rather than poisoning a counter', () => {
    const sb = new StatBatch();
    sb.bump(ref('users/u'), {}, { 'stats.goals': Number.NaN });
    sb.bump(ref('users/u'), {}, { 'stats.goals': 3 });
    expect(sb.build(recorder(), inc).ops[0].data).toEqual({
      stats: { goals: { __inc: 3 } },
    });
  });
});

// ── The real shape of a committed round ─────────────────────────────────────
//
// Mirrors every write commitRoundStats issues, so the count below is the count
// production will use — not a guess about it.
function buildRound(opts: {
  a: number;
  b: number;
  guests?: number;
  goals?: number;       // assisted goals, each by a distinct scorer/assister pair
  penalties?: number;   // kicks, each with a distinct kicker and keeper
  grouped?: boolean;
}) {
  const { a, b } = opts;
  const guests = opts.guests ?? 0;
  const goals = opts.goals ?? 0;
  const pens = opts.penalties ?? 0;
  const grouped = opts.grouped !== false;
  const gid = 'G';
  const gameId = 'GAME';

  const A = Array.from({ length: a }, (_, i) => `a${i}`);
  const B = Array.from({ length: b }, (_, i) => `b${i}`);
  const guestIds = Array.from({ length: guests }, (_, i) => `guest:${i}`);
  const onField = [...A, ...B];

  const sb = new StatBatch();
  const u = (id: string) => ref(`users/${id}`);
  const cps = (id: string) => ref(`communityPlayerStats/${gid}__${id}`);
  const gps = (id: string) => ref(`gamePlayerStats/${gameId}__${id}`);
  const pair = (x: string, y: string) => ref(`pairStats/${[x, y].sort().join('__')}`);
  const cpair = (x: string, y: string) =>
    ref(`communityPairStats/${gid}__${[x, y].sort().join('__')}`);

  sb.create(ref(`games/${gameId}/committedRounds/1`), { committedAt: 1 });

  // goals + assists — worst case, every goal by a different scorer/assister
  for (let i = 0; i < goals; i++) {
    const scorer = onField[i % onField.length];
    const assister = onField[(i + 1) % onField.length];
    sb.bump(u(scorer), {}, { 'stats.goals': 1 });
    if (grouped) sb.bump(cps(scorer), { groupId: gid }, { goals: 1 });
    sb.bump(gps(scorer), { gameId }, { goals: 1 });
    sb.bump(u(assister), {}, { 'stats.assists': 1 });
    if (grouped) sb.bump(cps(assister), { groupId: gid }, { assists: 1 });
    sb.bump(gps(assister), { gameId }, { assists: 1 });
    sb.bump(pair(assister, scorer), {}, { assistsAToB: 1 });
    if (grouped) sb.bump(cpair(assister, scorer), { groupId: gid }, { assists: 1 });
  }

  if (grouped) sb.bump(ref(`communityStats/${gid}`), { groupId: gid }, { rounds: 1 });

  // penalties — a distinct kicker and keeper for each kick
  for (let i = 0; i < pens; i++) {
    const kicker = onField[i % onField.length];
    const keeper = onField[(i + 3) % onField.length];
    sb.bump(u(kicker), {}, { 'stats.penTaken': 1 });
    if (grouped) sb.bump(cps(kicker), { groupId: gid }, { penTaken: 1 });
    sb.bump(gps(kicker), { gameId }, { penTaken: 1 });
    sb.bump(u(keeper), {}, { 'stats.penFaced': 1 });
    if (grouped) sb.bump(cps(keeper), { groupId: gid }, { penFaced: 1 });
    sb.bump(gps(keeper), { gameId }, { penFaced: 1 });
  }

  // rounds + clean sheets (clean sheet is the expensive branch: it adds a
  // lifetime users write for every player on the field)
  for (const id of onField) {
    if (grouped) sb.bump(cps(id), { groupId: gid }, { rounds: 1, cleanSheets: 1 });
    sb.bump(gps(id), { gameId }, { rounds: 1, cleanSheets: 1, teamGoalsFor: 0, teamGoalsAgainst: 0 });
    sb.bump(u(id), {}, { 'stats.cleanSheets': 1 });
  }
  for (const g of guestIds) sb.bump(gps(g), { gameId, isGuest: true }, { rounds: 1 });

  // wins / losses
  for (const id of A) {
    if (grouped) sb.bump(cps(id), { groupId: gid }, { wins: 1 });
    sb.bump(gps(id), { gameId }, { wins: 1 });
    sb.bump(u(id), {}, { 'stats.wins': 1 });
  }
  for (const id of B) {
    if (grouped) sb.bump(cps(id), { groupId: gid }, { losses: 1 });
    sb.bump(gps(id), { gameId }, { losses: 1 });
  }

  // against pairs + same-team pairs
  for (const w of A) for (const l of B) sb.bump(pair(w, l), {}, { against: 1 });
  const same = (team: string[]) => {
    for (let i = 0; i < team.length; i++)
      for (let j = i + 1; j < team.length; j++) sb.bump(pair(team[i], team[j]), {}, { sameTeam: 1 });
  };
  same(A);
  same(B);

  return sb;
}

describe('commitRoundStats stays under the Firestore batch ceiling', () => {
  const FIRESTORE_LIMIT = 500;
  // The caps enforced in commitRoundStats.
  const MAX_SIDE = 11;
  const MAX_DISPLAY_SIDE = 25;
  const MAX_GOALS = 60;
  const MAX_PENS = 16;

  it('a normal 6-a-side round uses well under a third of the ceiling', () => {
    // ~108 ops, dominated by the pair writes (36 against + 30 same-team).
    const sb = buildRound({ a: 6, b: 6, goals: 4 });
    expect(sb.opCount).toBeLessThan(FIRESTORE_LIMIT / 3);
  });

  it('11v11 with a full shootout and a capped goal log stays under the guard', () => {
    const sb = buildRound({
      a: MAX_SIDE,
      b: MAX_SIDE,
      guests: MAX_DISPLAY_SIDE * 2 - MAX_SIDE * 2,
      goals: MAX_GOALS,
      penalties: MAX_PENS,
    });
    expect(sb.opCount).toBeLessThanOrEqual(MAX_ROUND_BATCH_OPS);
    expect(sb.opCount).toBeLessThan(FIRESTORE_LIMIT);
  });

  it('the analytic worst case bounds the simulated one, and clears the guard', () => {
    const analytic = worstCaseRoundOps({
      a: MAX_SIDE,
      b: MAX_SIDE,
      guests: MAX_DISPLAY_SIDE * 2 - MAX_SIDE * 2,
      assistPairs: MAX_GOALS,
    });
    const simulated = buildRound({
      a: MAX_SIDE,
      b: MAX_SIDE,
      guests: MAX_DISPLAY_SIDE * 2 - MAX_SIDE * 2,
      goals: MAX_GOALS,
      penalties: MAX_PENS,
    }).opCount;

    expect(simulated).toBeLessThanOrEqual(analytic);
    expect(analytic).toBeLessThanOrEqual(MAX_ROUND_BATCH_OPS);
    expect(analytic).toBeLessThan(FIRESTORE_LIMIT);
    // Real headroom, not a hairline pass.
    expect(FIRESTORE_LIMIT - analytic).toBeGreaterThanOrEqual(60);
  });

  it('an ungrouped (orphan) game costs strictly less', () => {
    const grouped = worstCaseRoundOps({ a: 11, b: 11, assistPairs: 60 });
    const orphan = worstCaseRoundOps({ a: 11, b: 11, assistPairs: 60, grouped: false });
    expect(orphan).toBeLessThan(grouped);
  });

  // Regression witness for the bug this refactor closes: the previous shape
  // charged one operation per STAT, and that genuinely crossed 500.
  it('the old one-op-per-stat shape would have overflowed at 11v11', () => {
    const n = 11;
    const goals = 7;
    const pens = 16;
    const perStatOps =
      1 +                       // latch
      1 +                       // communityStats
      goals * 3 +               // scorer: users + community + game
      goals * 3 +               // assister: users + community + game
      goals * 2 +               // pairStats + communityPairStats
      pens * 3 +                // kicker
      pens * 3 +                // keeper
      2 * n * 2 +               // rounds: community + game, per player
      2 * n +                   // lifetime clean sheet, per player
      2 * n * 2 +               // wins/losses: community + game
      n +                       // lifetime wins
      n * n +                   // against pairs
      n * (n - 1);              // same-team pairs
    expect(perStatOps).toBeGreaterThan(FIRESTORE_LIMIT);

    // The same round, de-duplicated, fits comfortably.
    expect(buildRound({ a: n, b: n, goals, penalties: pens }).opCount)
      .toBeLessThan(FIRESTORE_LIMIT);
  });
});
