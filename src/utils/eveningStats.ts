// Pure reducers for the evening summary — no RN/Firebase imports, so they
// unit-test in a plain node env and the logic lives in exactly one place.
//
//   • reduceRounds()   — roundHistory → contribution%, held-the-pitch streak,
//                        scoring streak, GF/GA, best mini-game
//   • computeFun()     — wearable metrics → the shareable "funny" numbers
//   • computeRadar()   — wearable + goals/assists → the DNA radar (0..1 axes)
//   • computeHeatZones — a heat grid → attack/middle/defense split (%)

export type Side = 'A' | 'B' | 'tie';

export interface RoundGoalRec {
  scorerId: string;
  assisterId: string | null;
  ownGoal: boolean;
  team: 'A' | 'B';
}

export interface RoundHistoryDoc {
  roundId: string;
  teamA: string[];
  teamB: string[];
  scoreA: number;
  scoreB: number;
  winnerSide: Side;
  goals: RoundGoalRec[];
  at: number;
}

export interface PhysicalDoc {
  distanceM?: number;
  topSpeedKmh?: number;
  sprints?: number;
  maxHr?: number;
  avgSpeedKmh?: number;
  steps?: number;
  calories?: number;
  /** 0–100 effort score (derived from HR / active time). */
  effortScore?: number;
  hrZones?: {
    light?: number;
    moderate?: number;
    intense?: number;
    peak?: number;
  };
  source?: string;
  /** Row-major normalized (0..1) heat grid + its dimensions. */
  heatGrid?: number[];
  gridRows?: number;
  gridCols?: number;
}

export interface EveningRoundStats {
  /** goals+assists the player was directly involved in, as % of their team's
   *  goals across the evening. null when the team scored nothing. */
  contribution: { pct: number; touched: number; teamGoals: number } | null;
  /** longest run of consecutive mini-games the player's team won (winner-stays). */
  heldPitch: number;
  /** longest run of consecutive mini-games the player scored in. */
  scoringStreak: number;
  teamGoalsFor: number;
  teamGoalsAgainst: number;
  bestMiniGame: { round: number; goals: number; assists: number } | null;
  /** how many mini-games the player actually took the field for. */
  playedRounds: number;
}

/** Reduce a player's round-history into their per-evening derived stats. */
export function reduceRounds(
  uid: string,
  rounds: RoundHistoryDoc[],
): EveningRoundStats {
  const sorted = [...(rounds ?? [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  let touched = 0;
  let teamGoals = 0;
  let teamGoalsAgainst = 0;
  let scoreStreak = 0;
  let bestScore = 0;
  let winStreak = 0;
  let bestWin = 0;
  let played = 0;
  let best = { round: 0, goals: 0, assists: 0, pts: 0 };

  for (const r of sorted) {
    const onA = (r.teamA ?? []).includes(uid);
    const onB = (r.teamB ?? []).includes(uid);
    if (!onA && !onB) {
      // Sitting a round out breaks both streaks — you didn't hold the pitch and
      // your scoring run is interrupted. Reset BEFORE skipping (otherwise two
      // played rounds either side of a sit-out are wrongly treated as
      // consecutive).
      scoreStreak = 0;
      winStreak = 0;
      continue;
    }
    played += 1;
    const myTeam: 'A' | 'B' = onA ? 'A' : 'B';
    const goals = r.goals ?? [];
    const credited = goals.filter((g) => !g.ownGoal && g.team === myTeam).length;
    const against = goals.filter((g) => !g.ownGoal && g.team !== myTeam).length;
    teamGoals += credited;
    teamGoalsAgainst += against;
    const myGoals = goals.filter((g) => !g.ownGoal && g.scorerId === uid).length;
    const myAssists = goals.filter((g) => g.assisterId === uid).length;
    touched += myGoals + myAssists;

    const pts = myGoals * 2 + myAssists;
    if (pts > best.pts) best = { round: played, goals: myGoals, assists: myAssists, pts };

    if (myGoals > 0) {
      scoreStreak += 1;
      if (scoreStreak > bestScore) bestScore = scoreStreak;
    } else {
      scoreStreak = 0;
    }

    const won = r.winnerSide === myTeam;
    if (won) {
      winStreak += 1;
      if (winStreak > bestWin) bestWin = winStreak;
    } else {
      winStreak = 0;
    }
  }

  return {
    contribution:
      teamGoals > 0
        ? { pct: Math.round((touched / teamGoals) * 100), touched, teamGoals }
        : null,
    heldPitch: bestWin,
    scoringStreak: bestScore,
    teamGoalsFor: teamGoals,
    teamGoalsAgainst,
    bestMiniGame: best.pts > 0 ? { round: best.round, goals: best.goals, assists: best.assists } : null,
    playedRounds: played,
  };
}

export interface FunNumbers {
  /** calories ≈ pizza slices (fun). */
  pizzas: number;
  /** distance in pitch-lengths (~105 m). */
  fieldLengths: number;
  /** calories ≈ phone charges (fun). */
  phoneCharges: number;
}

export function computeFun(p: PhysicalDoc): FunNumbers {
  const cal = Math.max(0, p.calories ?? 0);
  const distM = Math.max(0, p.distanceM ?? 0);
  return {
    pizzas: Math.round((cal / 256) * 10) / 10,
    fieldLengths: Math.round(distM / 105),
    phoneCharges: Math.round(cal / 160),
  };
}

export interface RadarShape {
  attack: number;
  run: number;
  speed: number;
  stamina: number;
  assist: number;
  /** two-axis nickname, e.g. "חלוץ-רץ". */
  profile: string;
}

const RADAR_LABEL: Record<keyof Omit<RadarShape, 'profile'>, string> = {
  attack: 'חלוץ',
  run: 'רץ',
  speed: 'מהיר',
  stamina: 'מנוע',
  assist: 'מבשל',
};

export function computeRadar(
  p: PhysicalDoc,
  goals: number,
  assists: number,
): RadarShape {
  const attack = Math.min(1, (goals * 2 + assists) / 8);
  const run = Math.min(1, (p.distanceM ?? 0) / 8000);
  const speed = Math.min(1, (p.topSpeedKmh ?? 0) / 28);
  const stamina = Math.min(1, (p.effortScore ?? 0) / 100);
  const assist = Math.min(1, assists / 4);
  const axes: Array<[keyof typeof RADAR_LABEL, number]> = [
    ['attack', attack],
    ['run', run],
    ['speed', speed],
    ['stamina', stamina],
    ['assist', assist],
  ];
  axes.sort((a, b) => b[1] - a[1]);
  const profile = `${RADAR_LABEL[axes[0][0]]}-${RADAR_LABEL[axes[1][0]]}`;
  return { attack, run, speed, stamina, assist, profile };
}

export interface HeatZones {
  attack: number;
  middle: number;
  defense: number;
}

/**
 * Split a row-major heat grid into thirds (top third = attacking end).
 * Returns percentages that sum to ~100, or null for an empty/invalid grid.
 */
export function computeHeatZones(
  grid: number[] | undefined,
  rows: number | undefined,
  cols: number | undefined,
): HeatZones | null {
  if (!grid || !grid.length || !rows || !cols) return null;
  if (grid.length < rows * cols) return null;
  let attack = 0;
  let middle = 0;
  let defense = 0;
  let total = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r * cols + c] || 0;
      total += v;
      if (r < rows / 3) attack += v;
      else if (r < (2 * rows) / 3) middle += v;
      else defense += v;
    }
  }
  if (total <= 0) return { attack: 0, middle: 0, defense: 0 };
  return {
    attack: Math.round((attack / total) * 100),
    middle: Math.round((middle / total) * 100),
    defense: Math.round((defense / total) * 100),
  };
}
