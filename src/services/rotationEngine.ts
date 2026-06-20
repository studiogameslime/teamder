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

/** Default random picker — chooses `n` distinct items. Override in tests. */
function pickRandom<T>(arr: T[], n: number): T[] {
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
export function canStart(teams: RotationTeam[], perTeam: number): boolean {
  const total = teams.reduce((s, t) => s + t.playerIds.length, 0);
  return teams.length >= 2 && total >= perTeam * 2;
}

/**
 * Fill the two PLAYING teams up to `perTeam` by borrowing from the OFF teams
 * (preferring `loserFirst` when given — the team that just lost). Mutates a
 * working copy of loans/teams per `fillMode` and returns them.
 */
function fillPlaying(
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

  // Source teams to borrow from = teams NOT currently playing, loser first.
  const offIndices = outTeams
    .map((t) => t.index)
    .filter((i) => !playing.includes(i))
    .sort((a, b) => (a === loserFirst ? -1 : b === loserFirst ? 1 : 0));

  for (const teamIdx of playing) {
    let size = rosterOf(teamIdx, outTeams, outLoans).length;
    let deficit = perTeam - size;
    if (deficit <= 0) continue;
    for (const src of offIndices) {
      if (deficit <= 0) break;
      // Available donors from `src` = its home players not already loaned out.
      const loanedOut = new Set(
        outLoans.filter((l) => l.homeTeam === src).map((l) => l.playerId),
      );
      const donors = (outTeams.find((t) => t.index === src)?.playerIds ?? [])
        .filter((p) => !loanedOut.has(p));
      const chosen = pick(donors, deficit);
      for (const playerId of chosen) {
        if (fillMode === 'permanent') {
          // Move the player's home team to the team they completed.
          outTeams = outTeams.map((t) =>
            t.index === src
              ? { ...t, playerIds: t.playerIds.filter((p) => p !== playerId) }
              : t.index === teamIdx
                ? { ...t, playerIds: [...t.playerIds, playerId] }
                : t,
          );
        } else {
          outLoans.push({ playerId, homeTeam: src, filledTeam: teamIdx });
        }
      }
      deficit -= chosen.length;
      size += chosen.length;
    }
  }
  return { teams: outTeams, loans: outLoans };
}

/**
 * Start the rotation: first two teams play (filled to full from the rest),
 * the remaining teams wait. Returns null when there aren't enough players.
 */
export function startRotation(
  teams: RotationTeam[],
  perTeam: number,
  fillMode: FillMode,
  pick: <T>(a: T[], n: number) => T[] = pickRandom,
): { rotation: MatchRotation; teams: RotationTeam[] } | null {
  if (!canStart(teams, perTeam)) return null;
  const ordered = [...teams].sort((a, b) => a.index - b.index);
  const playing: [number, number] = [ordered[0].index, ordered[1].index];
  const waiting = ordered.slice(2).map((t) => t.index);
  const filled = fillPlaying(playing, teams, [], perTeam, fillMode, null, pick);
  return {
    rotation: {
      playing,
      waiting,
      loans: filled.loans,
      wins: {},
      round: 1,
      updatedAt: Date.now(),
    },
    teams: filled.teams,
  };
}

/**
 * Record the result of the current round and rotate. `winner` is one of the
 * two playing indices. Loser → back of queue; winner stays; next waiting
 * comes on and is filled (loser-first). Temporary loans whose HOME team is
 * the one now coming on are first returned home before re-filling.
 */
export function recordWinner(
  winner: number,
  teams: RotationTeam[],
  rotation: MatchRotation,
  perTeam: number,
  fillMode: FillMode,
  pick: <T>(a: T[], n: number) => T[] = pickRandom,
): { rotation: MatchRotation; teams: RotationTeam[] } {
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
  // No one waiting → keep playing the same two (just bump the win tally).
  const wins = { ...(rotation.wins ?? {}) };
  wins[String(winner)] = (wins[String(winner)] ?? 0) + 1;
  if (incoming == null) {
    return {
      teams,
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
  // return home (the player rejoins their own team for this stint).
  let loans = rotation.loans.filter((l) => l.homeTeam !== incoming);

  // Drop loans tied to the loser's stint that just ended (a player borrowed
  // INTO the loser team goes back to their home — the loser is going off).
  loans = loans.filter((l) => l.filledTeam !== loser);

  // Now fill the two playing teams to full, borrowing loser-first.
  const filled = fillPlaying(newPlaying, teams, loans, perTeam, fillMode, loser, pick);
  return {
    teams: filled.teams,
    rotation: {
      playing: newPlaying,
      waiting: newWaiting,
      loans: filled.loans,
      wins,
      round: (rotation.round ?? 1) + 1,
      lastRoundWinners,
      lastRoundLosers,
      lastRoundAt,
      updatedAt: lastRoundAt,
    },
  };
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
export function recordTie(
  teams: RotationTeam[],
  rotation: MatchRotation,
  perTeam: number,
  fillMode: FillMode,
  mode: 'bothOut' | 'veteranOut',
  pick: <T>(a: T[], n: number) => T[] = pickRandom,
): { rotation: MatchRotation; teams: RotationTeam[] } {
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
  const noOneWaiting = rotation.waiting[0] == null;
  if (noOneWaiting) {
    // Nobody to swap in → both stay, just advance the round.
    return { teams, rotation: { ...rotation, ...base } };
  }

  // Helper: rotate so `out` goes to the back and `stay` is joined by `incoming`.
  const rotateOneOut = (stay: number, out: number, incoming: number) => {
    const newPlaying: [number, number] = [stay, incoming];
    const newWaiting = [...rotation.waiting.filter((w) => w !== incoming), out];
    let loans = rotation.loans.filter((l) => l.homeTeam !== incoming);
    loans = loans.filter((l) => l.filledTeam !== out);
    const filled = fillPlaying(newPlaying, teams, loans, perTeam, fillMode, out, pick);
    return {
      teams: filled.teams,
      rotation: { ...base, playing: newPlaying, waiting: newWaiting, loans: filled.loans },
    };
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
  const newWaiting = [...rotation.waiting.slice(2), a, b];
  // Incoming teams come on → return their loaned-out players; drop loans into
  // the two teams going off.
  let loans = rotation.loans.filter((l) => l.homeTeam !== inc1 && l.homeTeam !== inc2);
  loans = loans.filter((l) => l.filledTeam !== a && l.filledTeam !== b);
  const filled = fillPlaying(newPlaying, teams, loans, perTeam, fillMode, null, pick);
  return {
    teams: filled.teams,
    rotation: { ...base, playing: newPlaying, waiting: newWaiting, loans: filled.loans },
  };
}
