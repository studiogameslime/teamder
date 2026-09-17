// rotationEngine — pure "winner stays" rotation over the drafted teams.
//
// Rules (confirmed with the organizer):
//   • Two teams play; the rest wait in a queue (front = next up).
//   • A round can only START when both playing teams are FULL (perTeam).
//   • Winner stays, loser goes to the back of the queue, next waiting comes on.
//   • If an incoming team is SHORT, it's completed by borrowing random
//     players from the team that just went off (the loser) — or, at the very
//     first round, from the waiting teams. The field is therefore always full.
//   • Fill mode:
//       - 'temporary' → the borrowed player returns to their OWN team the
//         next time that team comes on (they only filled in for that stint).
//       - 'permanent' → the borrowed player stays with the team they
//         completed (their home team is reassigned).
//
// The engine is pure: every function takes the teams + rotation and returns a
// NEW rotation (and, for permanent fills, a NEW teams array). No I/O, no
// randomness source beyond an injectable picker so it's deterministic in tests.

import type { FillMode, MatchRotation, RotationLoan } from '@/types';

export interface RotationTeam {
  index: number;
  /** Home roster (after any permanent reassignments). */
  playerIds: string[];
}

/** Default random picker — chooses `n` distinct items. Override in tests.
 *  Exported so the interactive-fill UI can pre-select the SAME random
 *  recommendation the auto path would have picked. */
export function pickRandom<T>(arr: T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    // eslint-disable-next-line no-bitwise
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

/** Effective on-field roster of a team index right now: its home players,
 *  minus anyone currently loaned OUT, plus anyone loaned IN to it. */
export function rosterOf(
  teamIndex: number,
  teams: RotationTeam[],
  loans: RotationLoan[],
): string[] {
  const home = teams.find((t) => t.index === teamIndex)?.playerIds ?? [];
  const loanedOut = new Set(
    loans.filter((l) => l.homeTeam === teamIndex).map((l) => l.playerId),
  );
  const loanedIn = loans
    .filter((l) => l.filledTeam === teamIndex)
    .map((l) => l.playerId);
  return [...home.filter((p) => !loanedOut.has(p)), ...loanedIn];
}

/** Can a rotation be started at all? Need enough players for two full teams. */
export function canStart(teams: RotationTeam[]): boolean {
  // Two teams with somebody in each of them, and nothing about the FORMAT.
  //
  // This used to demand `total >= perTeam * 2` — two teams full to the size
  // the game was created with. Owner report: eight people at the pitch, a game
  // created 4v4, and the evening could not be started at all. That is the
  // common case, not the edge one; clubs play a man short every week, and the
  // format is the plan for the evening, not a rule about who may play.
  //
  // The engine already copes with short teams everywhere else: fillAll stops
  // when the donor pool is empty, and prepareRefillPlaying exists precisely
  // because somebody goes home mid-evening and the round carries on 4v3. The
  // start was the only place that refused.
  //
  // What is still refused is a side with nobody on it. A 7v0 is not a short
  // match, it is a broken one.
  const manned = teams.filter((t) => t.playerIds.length > 0).length;
  return teams.length >= 2 && manned >= 2;
}

/**
 * A rotation transition computed UP TO — but not including — the fill step.
 * Both the automatic path (fill with the random recommendation) and the
 * interactive path (let the admin pick the fillers) start from one of these.
 */
export interface RotationFillState {
  /** Teams as they stand pre-fill (home rosters; permanent moves not yet applied). */
  teams: RotationTeam[];
  /** The two teams now on the field. */
  playing: [number, number];
  perTeam: number;
  fillMode: FillMode;
  /** Team to borrow from first (the one going off / the loser); null at start. */
  loserFirst: number | null;
  /** The new rotation minus the fill (loans are the post-return baseline). */
  rotation: MatchRotation;
}

/**
 * The next playing team that still needs filling, with its ordered donor pool.
 * Donors = the OFF teams' available home players (loser-first), excluding
 * anyone already loaned out of their team. null when both playing teams are
 * full. Pure — drives both the auto loop and the interactive picker UI.
 */
export function nextFillNeeded(
  playing: [number, number],
  teams: RotationTeam[],
  loans: RotationLoan[],
  perTeam: number,
  loserFirst: number | null,
): { team: number; deficit: number; donors: string[] } | null {
  // Source teams to borrow from = teams NOT currently playing, loser first.
  // Proper total-order comparator so the loser sorts before everyone else.
  const offIndices = teams
    .map((t) => t.index)
    .filter((i) => !playing.includes(i))
    .sort((a, b) => (b === loserFirst ? 1 : 0) - (a === loserFirst ? 1 : 0));
  for (const teamIdx of playing) {
    const deficit = perTeam - rosterOf(teamIdx, teams, loans).length;
    if (deficit <= 0) continue;
    const donors: string[] = [];
    for (const src of offIndices) {
      const loanedOut = new Set(
        loans.filter((l) => l.homeTeam === src).map((l) => l.playerId),
      );
      const avail = (teams.find((t) => t.index === src)?.playerIds ?? []).filter(
        (p) => !loanedOut.has(p),
      );
      donors.push(...avail);
    }
    return { team: teamIdx, deficit, donors };
  }
  return null;
}

/**
 * Borrow a chosen set of players into `targetTeam`. Each filler's source is the
 * team that currently holds them (and hasn't loaned them out). Permanent →
 * their home team is reassigned to the target; temporary → a loan is recorded.
 * Pure — used both by the auto loop (chosen = recommendation) and the
 * interactive path (chosen = what the admin picked).
 */
export function applyChosenFill(
  teams: RotationTeam[],
  loans: RotationLoan[],
  targetTeam: number,
  chosenIds: string[],
  fillMode: FillMode,
): { teams: RotationTeam[]; loans: RotationLoan[] } {
  let outTeams = teams.map((t) => ({ ...t, playerIds: [...t.playerIds] }));
  let outLoans = [...loans];
  for (const playerId of chosenIds) {
    const src = outTeams.find(
      (t) =>
        t.index !== targetTeam &&
        t.playerIds.includes(playerId) &&
        !outLoans.some((l) => l.homeTeam === t.index && l.playerId === playerId),
    )?.index;
    if (src == null) continue; // not an available donor — skip defensively
    if (fillMode === 'permanent') {
      outTeams = outTeams.map((t) =>
        t.index === src
          ? { ...t, playerIds: t.playerIds.filter((p) => p !== playerId) }
          : t.index === targetTeam
            ? { ...t, playerIds: [...t.playerIds, playerId] }
            : t,
      );
    } else {
      outLoans.push({ playerId, homeTeam: src, filledTeam: targetTeam });
    }
  }
  return { teams: outTeams, loans: outLoans };
}

/**
 * AUTO fill: loop nextFillNeeded + applyChosenFill, choosing donors with
 * `pick` (the recommendation) each round, until both playing teams are full.
 * This is the non-interactive path; the interactive UI runs the same loop but
 * substitutes the admin's selection for `pick`.
 */
function fillAll(
  playing: [number, number],
  teams: RotationTeam[],
  loans: RotationLoan[],
  perTeam: number,
  fillMode: FillMode,
  loserFirst: number | null,
  pick: <T>(a: T[], n: number) => T[],
): { teams: RotationTeam[]; loans: RotationLoan[] } {
  let outTeams = teams.map((t) => ({ ...t, playerIds: [...t.playerIds] }));
  let outLoans = [...loans];
  // Bounded loop — at most one fill per playing team per source; the guard is a
  // far-above-real backstop against a donor-pool stalemate.
  for (let guard = 0; guard < 100; guard++) {
    const req = nextFillNeeded(playing, outTeams, outLoans, perTeam, loserFirst);
    if (!req) break;
    const chosen = pick(req.donors, req.deficit);
    if (chosen.length === 0) break; // no donors left → can't fill further
    ({ teams: outTeams, loans: outLoans } = applyChosenFill(
      outTeams,
      outLoans,
      req.team,
      chosen,
      fillMode,
    ));
  }
  return { teams: outTeams, loans: outLoans };
}

/**
 * Start the rotation: first two teams play (filled to full from the rest),
 * the remaining teams wait. Returns null when there aren't enough players.
 */
export function startRotationSkeleton(
  teams: RotationTeam[],
  perTeam: number,
  fillMode: FillMode,
  /** Explicit starting order (team indices); the first two play, the rest
   *  wait in this order. When omitted/invalid, defaults to by-index order.
   *  Callers wanting a RANDOM or admin-chosen opening pair pass this — the
   *  engine stays pure (randomness lives in the caller, so tests stay stable). */
  order?: number[],
): RotationFillState | null {
  if (!canStart(teams)) return null;
  const byIndex = [...teams].sort((a, b) => a.index - b.index).map((t) => t.index);
  // Use the caller's order only when it's a valid permutation of the teams.
  const valid =
    Array.isArray(order) &&
    order.length === byIndex.length &&
    new Set(order).size === order.length &&
    order.every((i) => byIndex.includes(i));
  const seq = valid ? (order as number[]) : byIndex;
  const playing: [number, number] = [seq[0], seq[1]];
  const waiting = seq.slice(2);
  return {
    teams,
    playing,
    perTeam,
    fillMode,
    loserFirst: null,
    rotation: { playing, waiting, loans: [], wins: {}, round: 1, updatedAt: Date.now() },
  };
}

export function startRotation(
  teams: RotationTeam[],
  perTeam: number,
  fillMode: FillMode,
  pick: <T>(a: T[], n: number) => T[] = pickRandom,
  order?: number[],
): { rotation: MatchRotation; teams: RotationTeam[] } | null {
  const s = startRotationSkeleton(teams, perTeam, fillMode, order);
  if (!s) return null;
  const filled = fillAll(s.playing, s.teams, s.rotation.loans, perTeam, fillMode, null, pick);
  return { rotation: { ...s.rotation, loans: filled.loans }, teams: filled.teams };
}

/**
 * Record the result of the current round and rotate. `winner` is one of the
 * two playing indices. Loser → back of queue; winner stays; next waiting
 * comes on and is filled (loser-first). Temporary loans whose HOME team is
 * the one now coming on are first returned home before re-filling.
 */
export function recordWinnerSkeleton(
  winner: number,
  teams: RotationTeam[],
  rotation: MatchRotation,
  perTeam: number,
  fillMode: FillMode,
): RotationFillState {
  const [a, b] = rotation.playing;
  const loser = winner === a ? b : a;
  const incoming = rotation.waiting[0];
  // Winning roster (as it stood THIS round, before rotating) — registered
  // players only; guests have no account to credit. Drives per-player wins.
  const lastRoundWinners = rosterOf(winner, teams, rotation.loans).filter(
    (id) => !id.startsWith('guest:'),
  );
  // Losing roster too — for pairwise "losses together" + "same team" counts.
  const lastRoundLosers = rosterOf(loser, teams, rotation.loans).filter(
    (id) => !id.startsWith('guest:'),
  );
  const lastRoundAt = Date.now();
  const wins = { ...(rotation.wins ?? {}) };
  wins[String(winner)] = (wins[String(winner)] ?? 0) + 1;
  // No one waiting → keep playing the same two (just bump the win tally).
  if (incoming == null) {
    return {
      teams,
      playing: rotation.playing,
      perTeam,
      fillMode,
      loserFirst: null,
      rotation: {
        ...rotation,
        wins,
        round: (rotation.round ?? 1) + 1,
        lastRoundWinners,
        lastRoundLosers,
        lastRoundAt,
        updatedAt: lastRoundAt,
      },
    };
  }

  const newPlaying: [number, number] = [winner, incoming];
  const newWaiting = [...rotation.waiting.slice(1), loser];
  // The incoming team comes ON → any temporary loans whose HOME is `incoming`
  // return home; drop loans tied to the loser's stint that just ended.
  let loans = rotation.loans.filter((l) => l.homeTeam !== incoming);
  loans = loans.filter((l) => l.filledTeam !== loser);

  return {
    teams,
    playing: newPlaying,
    perTeam,
    fillMode,
    loserFirst: loser,
    rotation: {
      playing: newPlaying,
      waiting: newWaiting,
      loans,
      wins,
      round: (rotation.round ?? 1) + 1,
      lastRoundWinners,
      lastRoundLosers,
      lastRoundAt,
      updatedAt: lastRoundAt,
    },
  };
}

export function recordWinner(
  winner: number,
  teams: RotationTeam[],
  rotation: MatchRotation,
  perTeam: number,
  fillMode: FillMode,
  pick: <T>(a: T[], n: number) => T[] = pickRandom,
): { rotation: MatchRotation; teams: RotationTeam[] } {
  const s = recordWinnerSkeleton(winner, teams, rotation, perTeam, fillMode);
  const filled = fillAll(
    s.playing,
    s.teams,
    s.rotation.loans,
    perTeam,
    fillMode,
    s.loserFirst,
    pick,
  );
  return { teams: filled.teams, rotation: { ...s.rotation, loans: filled.loans } };
}

/**
 * Record a TIE and rotate per the 4-team tie rule (advancedTieMode):
 *   • 'bothOut'    → both on-field teams go off; the two waiting teams come on.
 *   • 'veteranOut' → only the "veteran" (playing[0], the team that stayed and
 *                    has been on longest) goes off; the challenger (playing[1])
 *                    stays, and the next waiting team comes on.
 * A tie has no winner, so no win tally / no winner-loser rosters are recorded
 * (lastRoundWinners/Losers are emptied). Falls back gracefully when too few
 * teams are waiting (keeps both on, or rotates one).
 */
export function recordTieSkeleton(
  teams: RotationTeam[],
  rotation: MatchRotation,
  perTeam: number,
  fillMode: FillMode,
  mode: 'bothOut' | 'veteranOut',
): RotationFillState {
  const [a, b] = rotation.playing;
  const lastRoundAt = Date.now();
  const base = {
    wins: { ...(rotation.wins ?? {}) },
    round: (rotation.round ?? 1) + 1,
    lastRoundWinners: [] as string[],
    lastRoundLosers: [] as string[],
    lastRoundAt,
    updatedAt: lastRoundAt,
  };
  const state = (
    playing: [number, number],
    rot: MatchRotation,
    loserFirst: number | null,
  ): RotationFillState => ({ teams, playing, perTeam, fillMode, loserFirst, rotation: rot });

  const noOneWaiting = rotation.waiting[0] == null;
  if (noOneWaiting) {
    // Nobody to swap in → both stay, just advance the round (no fill).
    return state(rotation.playing, { ...rotation, ...base }, null);
  }

  // Helper: rotate so `out` goes to the back and `stay` is joined by `incoming`.
  const rotateOneOut = (stay: number, out: number, incoming: number): RotationFillState => {
    const newPlaying: [number, number] = [stay, incoming];
    const newWaiting = [...rotation.waiting.filter((w) => w !== incoming), out];
    let loans = rotation.loans.filter((l) => l.homeTeam !== incoming);
    loans = loans.filter((l) => l.filledTeam !== out);
    return state(newPlaying, { ...base, playing: newPlaying, waiting: newWaiting, loans }, out);
  };

  if (mode === 'veteranOut') {
    // Veteran = playing[0] (incumbent); challenger b stays.
    return rotateOneOut(b, a, rotation.waiting[0]);
  }

  // bothOut
  const inc1 = rotation.waiting[0];
  const inc2 = rotation.waiting[1];
  if (inc2 == null) {
    // Only one team waiting → can't swap both; treat as veteran-out fallback.
    return rotateOneOut(b, a, inc1);
  }
  const newPlaying: [number, number] = [inc1, inc2];
  // `b` before `a`. playing[0] is always the INCUMBENT — rotateOneOut builds
  // [stay, incoming] — so `a` has been on the pitch longer than `b`. Pushing
  // `a` first sent the team that had played most back on soonest, which is
  // backwards from how a pitch queue actually works: whoever sat longer goes
  // on first. Nobody chose the old order; it was just the order `playing`
  // happened to be in. The admin can still swap the two from the waiting list.
  const newWaiting = [...rotation.waiting.slice(2), b, a];
  // Incoming teams come on → return their loaned-out players; drop loans into
  // the two teams going off.
  let loans = rotation.loans.filter((l) => l.homeTeam !== inc1 && l.homeTeam !== inc2);
  loans = loans.filter((l) => l.filledTeam !== a && l.filledTeam !== b);
  return state(newPlaying, { ...base, playing: newPlaying, waiting: newWaiting, loans }, null);
}

export function recordTie(
  teams: RotationTeam[],
  rotation: MatchRotation,
  perTeam: number,
  fillMode: FillMode,
  mode: 'bothOut' | 'veteranOut',
  pick: <T>(a: T[], n: number) => T[] = pickRandom,
): { rotation: MatchRotation; teams: RotationTeam[] } {
  const s = recordTieSkeleton(teams, rotation, perTeam, fillMode, mode);
  const filled = fillAll(
    s.playing,
    s.teams,
    s.rotation.loans,
    perTeam,
    fillMode,
    s.loserFirst,
    pick,
  );
  return { teams: filled.teams, rotation: { ...s.rotation, loans: filled.loans } };
}

/**
 * Whether a reordered waiting queue may be written.
 *
 * The admin taps a list that was rendered a moment ago. If a round turned over
 * in between, the array they send names teams that are now ON the pitch —
 * writing it would put a playing team back in the queue and drop a waiting one
 * entirely. So the only orders accepted are permutations of the queue as it
 * stands at write time, and an unchanged order is not a write at all.
 */
export function acceptsReorder(current: number[], incoming: number[]): boolean {
  if (!Array.isArray(incoming) || current.length !== incoming.length) return false;
  const key = (xs: number[]) => [...xs].sort((a, b) => a - b).join();
  if (key(current) !== key(incoming)) return false;
  return current.join() !== incoming.join();
}

/**
 * The identity of the mini-game about to be persisted.
 *
 * The commit's idempotency key used to be `${round}:${updatedAt}`. That is not
 * stable within a round: `rotation.updatedAt` is restamped mid-round by
 * `markPlayerWentHome`, `movePlayerToTeam` and `removePlayerFromTeams` (each
 * when the player held a loan) and unconditionally by `reorderWaiting`. So a
 * commit whose success response was lost, followed by any of those, produced a
 * DIFFERENT key on the retry — the `committedRounds` latch missed it and the
 * whole mini-game was credited twice: rounds, wins/losses, GF/GA, clean sheets,
 * pair stats, and a duplicate roundHistory doc that the club-chemistry rollup
 * then ingested as a real second mini-game.
 *
 * The rule: keep the id while the round number is unchanged, mint a new one
 * when it moves.
 *
 * Keying the decision on `roundInstanceRound` rather than on "is an id
 * present?" is what makes it safe. `recordWinnerSkeleton` has two branches and
 * one of them builds the next round by SPREADING the current rotation — so an
 * id CAN arrive attached to a round it was not minted for. Comparing the two
 * numbers detects exactly that and re-mints, instead of silently carrying one
 * mini-game's identity into the next and blocking its commit.
 */
export function resolveRoundInstance(
  next: {
    round?: number;
    roundInstanceId?: string;
    roundInstanceRound?: number;
  },
  mint: () => string = defaultRoundInstanceId,
): { roundInstanceId: string; roundInstanceRound: number } {
  const round = next.round ?? 1;
  const inherited =
    !!next.roundInstanceId && next.roundInstanceRound === round
      ? next.roundInstanceId
      : null;
  return {
    roundInstanceId: inherited ?? mint(),
    roundInstanceRound: round,
  };
}

/** Opaque, collision-safe enough for one game's rounds. Not derived from any
 *  mutable field — that derivation is the bug this replaces. */
export function defaultRoundInstanceId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The key the round-end commit sends as its idempotency token.
 *
 * Kept here, next to the mint, so the two can never drift — and so a test can
 * assert the property that actually matters: the SAME live round always
 * produces the SAME key, no matter what else on the rotation has moved.
 */
export function roundCommitKey(rot: {
  round?: number;
  roundInstanceId?: string;
  updatedAt?: number;
}): string {
  // Legacy fallback only for a rotation written before this field existed —
  // an evening already in flight at deploy time. It carries the old
  // instability until that evening's next round transition mints an id.
  return rot.roundInstanceId ?? `${rot.round ?? 'r'}:${rot.updatedAt ?? 0}`;
}
