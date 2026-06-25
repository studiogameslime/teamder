// Shared view-model helpers for the live rotation surfaces (scoreboard card,
// waiting list, winner-picker modal). Keeps name/avatar resolution + filler
// detection in one place so every surface renders identical rosters.

import { rosterOf } from '@/services/rotationEngine';
import { parseGuestRosterId, type MatchRotation } from '@/types';
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

// Admin-selectable team colours. `key` is stored on DraftTeam.colorKey; `plural`
// is the team name when chosen ("האדומים"); `hex` tints the team everywhere.
export interface TeamPaletteEntry {
  key: string;
  plural: string;
  hex: string;
  /** true when the colour is light → needs dark text/contrast on top. */
  light?: boolean;
}
export const TEAM_PALETTE: TeamPaletteEntry[] = [
  { key: 'red', plural: 'האדומים', hex: '#EF4444' },
  { key: 'blue', plural: 'הכחולים', hex: '#3B82F6' },
  { key: 'green', plural: 'הירוקים', hex: '#22C55E' },
  { key: 'yellow', plural: 'הצהובים', hex: '#EAB308' },
  { key: 'orange', plural: 'הכתומים', hex: '#F97316' },
  { key: 'purple', plural: 'הסגולים', hex: '#8B5CF6' },
  { key: 'black', plural: 'השחורים', hex: '#1F2937' },
  { key: 'white', plural: 'הלבנים', hex: '#E5E7EB', light: true },
];
const PALETTE_BY_KEY: Record<string, TeamPaletteEntry> = Object.fromEntries(
  TEAM_PALETTE.map((p) => [p.key, p]),
);
export function teamPaletteEntry(colorKey?: string): TeamPaletteEntry | undefined {
  return colorKey ? PALETTE_BY_KEY[colorKey] : undefined;
}

type TeamLike = { index: number; colorKey?: string };

/** Team name. When a `teams` list is passed and the team at index `i` has a
 *  chosen colour, the name is that colour in plural ("האדומים"); otherwise the
 *  default "קבוצה אדומה" / letter. */
export function teamName(i: number, teams?: TeamLike[]): string {
  const chosen = teamPaletteEntry(teams?.find((t) => t.index === i)?.colorKey);
  if (chosen) return chosen.plural;
  const c = TEAM_COLOR_NAMES[i];
  return c ? `קבוצה ${c}` : `קבוצה ${teamLetter(i)}`;
}

/** The tint for a team index — the chosen colour when set, else the fixed
 *  index colour. */
export function teamColor(i: number, teams?: TeamLike[]): string {
  const chosen = teamPaletteEntry(teams?.find((t) => t.index === i)?.colorKey);
  if (chosen) return chosen.hex;
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
