// One mark per title.
//
// All nine season titles were drawn as the same 🏆, on four different surfaces
// — the history screen, the profile shelf, the summary screen and the share
// card — so scanning "who won what" meant reading every line, and the trophy
// itself already means "wins" everywhere else in the app.
//
// Icons, not emoji: an emoji is a different shape, weight and colour on every
// platform, it cannot take the tint of the row it sits in, and the share card
// leaves the app for strangers' phones. These are the Ionicons the rest of the
// app already draws.

import type { Ionicons } from '@expo/vector-icons';
import type { SeasonTitleKey } from '@/utils/seasonAwards';
import { colors } from '@/theme';

type Glyph = keyof typeof Ionicons.glyphMap;

/** The icon each title wears, everywhere it appears. */
export const SEASON_TITLE_ICON: Record<SeasonTitleKey, Glyph> = {
  topScorer: 'football',
  topAssister: 'git-branch',
  mvp: 'star',
  topWinner: 'trophy',
  mostLoyal: 'flame',
  cleanSheetKing: 'shield-checkmark',
  penaltyKing: 'locate',
  penaltyKeeper: 'hand-left',
  deadlyDuo: 'people',
};

/** And its colour. Each title reads as itself at a glance, and the tint is used
 *  on a disc — never as text colour, where these fail contrast. */
export const SEASON_TITLE_TINT: Record<SeasonTitleKey, string> = {
  topScorer: colors.primary,
  topAssister: '#7C3AED',
  mvp: '#F59E0B',
  topWinner: '#16A34A',
  mostLoyal: '#EF4444',
  cleanSheetKing: '#0EA5E9',
  penaltyKing: '#DB2777',
  penaltyKeeper: '#0D9488',
  deadlyDuo: '#6366F1',
};

export function seasonTitleIcon(key: SeasonTitleKey): Glyph {
  return SEASON_TITLE_ICON[key] ?? 'trophy';
}
export function seasonTitleTint(key: SeasonTitleKey): string {
  return SEASON_TITLE_TINT[key] ?? colors.primary;
}
