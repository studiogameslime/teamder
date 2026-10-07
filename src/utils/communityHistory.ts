import type { Game, GameSummary, MatchRound } from '@/types';
import { activeGuestCount } from '@/types';
import { isAttendedGame } from '@/utils/playedGames';

type HistoryGame = Pick<Game,
  'status' | 'startsAt' | 'players' | 'arrivals' | 'guests' | 'committedRoundCount' |
  'rotation' | 'endedBy' | 'playVerified' | 'liveMatch'
>;

const recordedNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Canonical attendance, evening-wide counts and PERSONAL scoring. No global
 * club totals and no current draft-team membership used as historical facts. */
export function communityHistoryFacets(
  game: HistoryGame,
  rounds: MatchRound[],
  viewerId: string,
  stats?: Record<string, unknown>,
  now = Date.now(),
): Pick<GameSummary, 'viewerPlayed' | 'playerCount' | 'matchCount' | 'viewerGoals' | 'viewerAssists'> {
  const viewerPlayed = isAttendedGame(game, viewerId, now);
  const finishedRounds = rounds.filter((round) => !!round.endedAt || !!round.winner).length;
  const rotationCount = Math.max(0, (game.rotation?.round ?? 1) - 1);
  return {
    viewerPlayed,
    playerCount: new Set((game.players ?? []).filter((uid) => game.arrivals?.[uid] !== 'no_show')).size
      + activeGuestCount(game.guests),
    matchCount: Math.max(game.committedRoundCount ?? 0, rotationCount, finishedRounds),
    // Not participating means zero personal contributions; an unavailable
    // stat row for a participant remains absent, rather than inventing zero.
    // The server uses sparse increment fields: an existing per-game row
    // without a goals/assists counter means no contributions of that kind.
    // This is the same convention as eveningSummaryService.readStatRow.
    viewerGoals: viewerPlayed ? (stats ? recordedNumber(stats.goals ?? 0) : null) : 0,
    viewerAssists: viewerPlayed ? (stats ? recordedNumber(stats.assists ?? 0) : null) : 0,
  };
}
