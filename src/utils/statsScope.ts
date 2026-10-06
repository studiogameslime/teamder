// Which slice of a club's history a screen is showing — the VOCABULARY.
//
// Pure and renderer-free, separated from the control that draws it for the
// same reason `clubChemistry` is separated from the cards it feeds: this is
// the part with rules in it, and rules are the part worth pinning with tests.
// `SeasonScopeBar` re-exports everything here, so callers still import from
// one place.

import { he } from '@/i18n/he';
import type { GroupSeasons } from '@/types';

/**
 * A union, not a nullable id with a magic string for "all".
 *
 * A sentinel leaks straight into the archive fetch, and the first thing it
 * does is ask Firestore for a season called "__all".
 */
export type StatsScope =
  | { k: 'current' }
  | { k: 'all' }
  | { k: 'season'; id: string };

/** The minimum a caller has to know about a closed season to offer it. */
export interface ScopeSeason {
  seasonId: string;
  no: number;
}

export interface ScopeOption {
  key: string;
  text: string;
  active: boolean;
  scope: StatsScope;
}

/**
 * The options a club actually has, in the order they are offered.
 *
 * Running season first, then all-time, then each closed season newest-first —
 * the order `CommunityStatsScreen` has shown since the control existed.
 */
export function buildScopeOptions(
  seasons: GroupSeasons | undefined,
  pastSeasons: readonly ScopeSeason[],
  scope: StatsScope,
): ScopeOption[] {
  return [
    {
      key: 'current',
      // A club that switched seasons OFF has no running season: the switch-off
      // closed it, and the live rows hold everything played since. The line
      // says that, instead of naming a season that never ran.
      text:
        seasons && !seasons.enabled && (seasons.count ?? 0) > 0
          ? he.communityStatsScopeSinceOff(seasons.count ?? 1)
          : he.communityStatsScopeCurrent(seasons?.currentNo ?? 1),
      active: scope.k === 'current',
      scope: { k: 'current' },
    },
    // Only once there IS a closed season to add — offered to a club with none
    // it was a second line identical to the first.
    ...(pastSeasons.length > 0
      ? [
          {
            key: 'all',
            text: he.communityStatsScopeAllTime,
            active: scope.k === 'all',
            scope: { k: 'all' } as StatsScope,
          },
        ]
      : []),
    ...pastSeasons.map((ps) => ({
      key: ps.seasonId,
      text: he.communityStatsScopePast(ps.no),
      active: scope.k === 'season' && scope.id === ps.seasonId,
      scope: { k: 'season', id: ps.seasonId } as StatsScope,
    })),
  ];
}

/** The label for the closed bar — the active option's own text. */
export function scopeTitleOf(options: readonly ScopeOption[]): string {
  return options.find((o) => o.active)?.text ?? options[0]?.text ?? '';
}

/**
 * Should this club see the control at all?
 *
 * 210 of the app's 211 clubs run no seasons. For them there is exactly one
 * slice — everything the club has ever played — and a dropdown offering one
 * option is a control that asks a question with no second answer. The caller
 * hides the whole row instead.
 */
export function clubHasScopes(
  seasons: GroupSeasons | undefined,
  pastSeasons: readonly ScopeSeason[],
): boolean {
  return !!seasons?.enabled || pastSeasons.length > 0;
}
