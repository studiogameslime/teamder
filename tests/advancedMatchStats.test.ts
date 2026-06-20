// Advanced-match end-to-end computation check across all 8 configs the
// organizer asked for: 4v4/5v5/6v6/7v7 × {3 teams, 4 teams}. Drives the real
// rotation engine deterministically and asserts, every round:
//   • both playing teams are exactly perTeam (field always full)
//   • no registered player is on two teams or lost
//   • the TWO stat-write paths agree on the lineup — i.e. the loan-aware
//     "against" rosters (sideA/sideB, as finalizeRoundAndRotate now builds
//     them) equal the union of the same-team winner/loser rosters the
//     rotation trigger credits. This is the regression guard for the
//     loan-unaware-roster bug.

import {
  startRotation,
  recordWinner,
  recordTie,
  rosterOf,
  type RotationTeam,
} from '@/services/rotationEngine';
import type { FillMode } from '@/types';

// Deterministic picker — always take the first n. Removes Math.random so the
// rotation is reproducible.
const pickFirst = <T,>(a: T[], n: number): T[] => a.slice(0, n);

type Cfg = {
  name: string;
  perTeam: number;
  sizes: number[]; // one entry per team; <perTeam forces loans
  fill: FillMode;
  tie?: 'bothOut' | 'veteranOut';
};

const FORMATS = [4, 5, 6, 7];
const configs: Cfg[] = [];
for (const perTeam of FORMATS) {
  // 3 teams: last team short by 2 → exercises borrowing + fill mode.
  configs.push({
    name: `${perTeam}v${perTeam} · 3 teams · temporary`,
    perTeam,
    sizes: [perTeam, perTeam, perTeam - 2],
    fill: 'temporary',
  });
  configs.push({
    name: `${perTeam}v${perTeam} · 3 teams · permanent`,
    perTeam,
    sizes: [perTeam, perTeam, perTeam - 2],
    fill: 'permanent',
  });
  // 4 teams: last team short by 1.
  configs.push({
    name: `${perTeam}v${perTeam} · 4 teams · bothOut`,
    perTeam,
    sizes: [perTeam, perTeam, perTeam, perTeam - 1],
    fill: 'temporary',
    tie: 'bothOut',
  });
  configs.push({
    name: `${perTeam}v${perTeam} · 4 teams · veteranOut`,
    perTeam,
    sizes: [perTeam, perTeam, perTeam, perTeam - 1],
    fill: 'temporary',
    tie: 'veteranOut',
  });
}

function buildTeams(sizes: number[]): RotationTeam[] {
  return sizes.map((size, i) => ({
    index: i,
    playerIds: Array.from({ length: size }, (_, p) => `t${i}p${p}`),
  }));
}

describe('advanced match — rotation + stat-roster consistency (all 8 configs)', () => {
  for (const cfg of configs) {
    test(cfg.name, () => {
      const teams0 = buildTeams(cfg.sizes);
      const allPlayers = new Set(teams0.flatMap((t) => t.playerIds));
      const started = startRotation(teams0, cfg.perTeam, cfg.fill, pickFirst);
      expect(started).not.toBeNull();
      let { rotation, teams } = started!;

      const ROUNDS = 12;
      for (let r = 0; r < ROUNDS; r++) {
        const [idxA, idxB] = rotation.playing;
        // EFFECTIVE on-field rosters this round (what finalizeRoundAndRotate now
        // sends as sideA/sideB to commitRoundStats).
        const sideA = rosterOf(idxA, teams, rotation.loans);
        const sideB = rosterOf(idxB, teams, rotation.loans);

        // Invariant 1: both playing teams full.
        expect(sideA).toHaveLength(cfg.perTeam);
        expect(sideB).toHaveLength(cfg.perTeam);

        // Invariant 2: no player on both playing teams at once.
        const overlap = sideA.filter((p) => sideB.includes(p));
        expect(overlap).toEqual([]);

        // Invariant 3: every on-field player is a known player (none invented).
        for (const p of [...sideA, ...sideB]) expect(allPlayers.has(p)).toBe(true);

        // Decide the round: tie every 4th round for 4-team configs, else team A.
        const isTieRound = cfg.tie && r % 4 === 3;
        if (isTieRound) {
          const next = recordTie(teams, rotation, cfg.perTeam, cfg.fill, cfg.tie!, pickFirst);
          // A tie credits no winner/loser rosters.
          expect(next.rotation.lastRoundWinners).toEqual([]);
          expect(next.rotation.lastRoundLosers).toEqual([]);
          rotation = next.rotation;
          teams = next.teams;
        } else {
          const winnerIdx = idxA;
          const before = { ...(rotation.wins ?? {}) };
          const next = recordWinner(winnerIdx, teams, rotation, cfg.perTeam, cfg.fill, pickFirst);
          // Invariant 4: the two stat paths agree on this round's lineup.
          // same-team rosters (winners ∪ losers) == against rosters (sideA ∪ sideB).
          const sameTeamPlayers = new Set([
            ...next.rotation.lastRoundWinners,
            ...next.rotation.lastRoundLosers,
          ]);
          const againstPlayers = new Set([...sideA, ...sideB]);
          expect([...sameTeamPlayers].sort()).toEqual([...againstPlayers].sort());
          // winners are exactly the winning side; losers the other.
          expect([...next.rotation.lastRoundWinners].sort()).toEqual([...sideA].sort());
          expect([...next.rotation.lastRoundLosers].sort()).toEqual([...sideB].sort());
          // Invariant 5: win tally incremented by exactly 1 for the winner.
          expect(next.rotation.wins?.[String(winnerIdx)] ?? 0).toBe(
            (before[String(winnerIdx)] ?? 0) + 1,
          );
          rotation = next.rotation;
          teams = next.teams;
        }

        // Invariant 6: total registered players conserved across the whole
        // teams array (permanent reassignment must never lose/duplicate a uid).
        const everyone = teams.flatMap((t) => t.playerIds);
        expect(new Set(everyone).size).toBe(everyone.length); // no dupes
        expect(new Set(everyone)).toEqual(allPlayers); // none lost
      }
    });
  }
});
