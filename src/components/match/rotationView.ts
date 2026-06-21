// Shared view-model helpers for the live rotation surfaces (scoreboard card,
// waiting list, winner-picker modal). Keeps name/avatar resolution + filler
// detection in one place so every surface renders identical rosters.

import { rosterOf } from '@/services/rotationEngine';
import type { MatchRotation } from '@/types';
import { colors } from '@/theme';

const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
export function teamLetter(i: number): string {
  return LETTERS[i] ?? String(i + 1);
}

// Teams are identified by COLOR (clearer than "קבוצה א/ב"). The color is fixed
// per team INDEX so a team keeps its identity across rotations. Falls back to
// the Hebrew letter for a hypothetical 5th+ team.
const TEAM_COLOR_NAMES = ['אדומה', 'כחולה', 'ירוקה', 'צהובה'];
const TEAM_COLORS = [colors.team1, colors.team2, colors.team3, colors.team4];

export function teamName(i: number): string {
  const c = TEAM_COLOR_NAMES[i];
  return c ? `קבוצה ${c}` : `קבוצה ${teamLetter(i)}`;
}

/** The fixed tint for a team index — matches its color name. */
export function teamColor(i: number): string {
  return TEAM_COLORS[i] ?? colors.textMuted;
}

/** First name only — keeps live roster rows compact ("Eliran Tzabari" →
 *  "Eliran", "מתן לוי" → "מתן"). */
export function firstName(name: string): string {
  return (name ?? '').trim().split(/\s+/)[0] || name;
}

export type PlayerLite = {
  displayName?: string;
  avatarId?: string;
  photoUrl?: string;
};

export interface RosterMember {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
  /** True when this player is on loan from another team (a "filler"). */
  isFiller: boolean;
  /** Home team index when isFiller. */
  fromTeam?: number;
}

/** Build a name/avatar resolver from the players map + per-game guests. */
export function makeResolver(
  playersMap: Record<string, PlayerLite>,
  guests?: { id: string; name: string }[],
) {
  return (id: string): PlayerLite => {
    const g = guests?.find((x) => x.id === id);
    if (g) return { displayName: g.name };
    return playersMap[id] ?? {};
  };
}

/** Effective on-pitch roster of a team, with filler flags resolved. */
export function buildRoster(
  teamIdx: number,
  teams: { index: number; playerIds: string[] }[],
  rotation: MatchRotation,
  resolve: (id: string) => PlayerLite,
): RosterMember[] {
  const ids = rosterOf(teamIdx, teams, rotation.loans);
  const loanedIn = new Map(
    rotation.loans
      .filter((l) => l.filledTeam === teamIdx)
      .map((l) => [l.playerId, l.homeTeam] as const),
  );
  return ids.map((id) => {
    const r = resolve(id);
    return {
      id,
      name: r.displayName ?? '…',
      avatarId: r.avatarId,
      photoUrl: r.photoUrl,
      isFiller: loanedIn.has(id),
      fromTeam: loanedIn.get(id),
    };
  });
}

/** Static (drafted) roster of a team — used for the waiting list, which shows
 *  home rosters (no loans in play yet for off-pitch teams). */
export function draftRoster(
  teamIdx: number,
  teams: { index: number; playerIds: string[] }[],
  resolve: (id: string) => PlayerLite,
): RosterMember[] {
  const ids = teams.find((t) => t.index === teamIdx)?.playerIds ?? [];
  return ids.map((id) => {
    const r = resolve(id);
    return {
      id,
      name: r.displayName ?? '…',
      avatarId: r.avatarId,
      photoUrl: r.photoUrl,
      isFiller: false,
    };
  });
}

/** Distinct source-team names of the fillers on a roster, for the legend line. */
export function fillerSources(roster: RosterMember[]): string[] {
  const set = new Set<number>();
  for (const m of roster) if (m.isFiller && m.fromTeam != null) set.add(m.fromTeam);
  return Array.from(set).sort((a, b) => a - b).map(teamName);
}
