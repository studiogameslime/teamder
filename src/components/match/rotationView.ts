// Shared view-model helpers for the live rotation surfaces (scoreboard card,
// waiting list, winner-picker modal). Keeps name/avatar resolution + filler
// detection in one place so every surface renders identical rosters.

import { rosterOf } from '@/services/rotationEngine';
import { parseGuestRosterId, type MatchRotation } from '@/types';
import { colors } from '@/theme';

// Team identity (name / tint / palette) now lives in one place — see
// utils/teamIdentity. Re-exported here so the live surfaces keep their import.
import { teamName, chosenFor, type TeamLike } from '@/utils/teamIdentity';
export {
  teamLetter,
  teamName,
  teamDot,
  teamPaletteEntry,
  TEAM_PALETTE,
  type TeamPaletteEntry,
  type TeamLike,
} from '@/utils/teamIdentity';

// Default per-index tints. Theme-dependent (dark mode uses lighter variants),
// which is why this half stays here and not in the pure identity module.
const TEAM_COLORS = [
  colors.team1, colors.team2, colors.team3, colors.team4,
  '#F97316', '#8B5CF6', '#1F2937',
];

/** The tint for a team index — the chosen colour when set, else the index one. */
export function teamColor(i: number, teams?: readonly TeamLike[]): string {
  return chosenFor(i, teams)?.hex ?? TEAM_COLORS[i] ?? colors.textMuted;
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
    // Roster ids for guests carry a `guest:` prefix, but the `guests` array
    // is keyed by the RAW id — match against both so a guest's name resolves
    // in the live rotation / scoreboard instead of showing blank (user
    // reports: "אין שמות לאורחים", DraftBoard guest name missing).
    const rawGuestId = parseGuestRosterId(id);
    const g = guests?.find((x) => x.id === id || (rawGuestId !== null && x.id === rawGuestId));
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
  return Array.from(set).sort((a, b) => a - b).map((i) => teamName(i));
}
