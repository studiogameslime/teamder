import type { Game, User } from '@/types';
import { isAttendedGame } from './playedGames';
import { effectiveStatus, isStaleAfterStart } from '@/services/gameLifecycle';

export function ownPlayerRounds(games: Game[], userId: string, now = Date.now()) {
  const attended = games.filter(game => isAttendedGame(game, userId, now))
    .sort((a, b) => b.startsAt - a.startsAt || a.id.localeCompare(b.id));
  const next = games.filter(game =>
    ['scheduled', 'open', 'locked', 'active'].includes(effectiveStatus(game))
    && (game.players ?? []).includes(userId)
    && !isStaleAfterStart(game)
    && (game.startsAt > now || effectiveStatus(game) === 'active'))
    .sort((a, b) => Number(effectiveStatus(b) === 'active') - Number(effectiveStatus(a) === 'active') || a.startsAt - b.startsAt)[0] ?? null;
  return { attendedCount: attended.length, last: attended[0] ?? null, next };
}

/** Public sharing is for a non-friend audience; private totals never enter it. */
export function publicCardStats(user: User, attendedCount: number) {
  return user.socialPrivacy?.statistics === 'everyone'
    ? { rounds: attendedCount, goals: user.stats?.goals ?? 0, assists: user.stats?.assists ?? 0 }
    : null;
}

export function recordedRoundStats(row?: Record<string, unknown>) {
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    goals: row ? number(row.goals === undefined ? 0 : row.goals) : null,
    assists: row ? number(row.assists === undefined ? 0 : row.assists) : null,
    // `rounds` counts this player's mini-games, never the whole evening's games.
    games: row ? number(row.rounds) : null,
  };
}
