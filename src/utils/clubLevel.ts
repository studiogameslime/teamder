// Club level — a single headline "how big/established is this club" number,
// derived from the same client-side aggregates as the club achievements.
// Pure + deterministic; no persistence.

import type { ClubMetrics } from '@/data/clubAchievements';

export interface ClubLevelInfo {
  level: number;
  /** Hebrew tier name for the level band. */
  tierName: string;
  points: number;
  /** Points still needed for the next level, or null at the cap. */
  pointsToNext: number | null;
  /** 0–1 progress through the current level toward the next. */
  progressPct: number;
}

const MAX_LEVEL = 10;

// Weighted activity score. Goals are high-volume so weighted lowest; members
// and longevity (in months) matter a lot; game-nights are the backbone.
function clubPoints(m: ClubMetrics): number {
  const ageMonths = Math.max(0, Math.round(m.ageYears * 12));
  return Math.round(
    m.gameNights * 10 + m.clubGoals * 1 + m.members * 8 + ageMonths * 6,
  );
}

// Cumulative points required to REACH a given level (level 1 = 0). Each level
// costs progressively more (a club never "maxes out" by just playing forever).
function thresholdFor(level: number): number {
  if (level <= 1) return 0;
  return Math.round(50 * Math.pow(level - 1, 1.7));
}

function tierNameForLevel(level: number): string {
  if (level <= 1) return 'מועדון חדש';
  if (level <= 3) return 'מועדון שכונתי';
  if (level <= 5) return 'מועדון מבוסס';
  if (level <= 7) return 'מועדון על';
  return 'אגדה';
}

export function computeClubLevel(m: ClubMetrics): ClubLevelInfo {
  const points = clubPoints(m);
  let level = 1;
  while (level < MAX_LEVEL && points >= thresholdFor(level + 1)) level += 1;

  const floor = thresholdFor(level);
  if (level >= MAX_LEVEL) {
    return {
      level,
      tierName: tierNameForLevel(level),
      points,
      pointsToNext: null,
      progressPct: 1,
    };
  }
  const ceil = thresholdFor(level + 1);
  const span = Math.max(1, ceil - floor);
  return {
    level,
    tierName: tierNameForLevel(level),
    points,
    pointsToNext: Math.max(0, ceil - points),
    progressPct: Math.min(1, Math.max(0, (points - floor) / span)),
  };
}
