// Shared view-model helpers for the live rotation surfaces (scoreboard card,
// waiting list, winner-picker modal). Keeps name/avatar resolution + filler
// detection in one place so every surface renders identical rosters.

import { rosterOf } from '@/services/rotationEngine';
import type { MatchRotation } from '@/types';

const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
export function teamLetter(i: number): string {
  return LETTERS[i] ?? String(i + 1);
}
export function teamName(i: number): string {
  return `קבוצה ${teamLetter(i)}`;
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
