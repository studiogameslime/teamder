import type { Game } from '@/types';

/** A fill dialog is a proposal based on one lineup and one clock state.
 * Exclude the live scoreboard: committing the old result clears it before
 * the dialog closes. Every field below is otherwise required to stay current.
 * Both inputs are converter-normalized game reads, never raw documents. */
export function rotationWriteSource(game: Pick<Game, 'status' | 'rotation' | 'draftTeams' | 'players' | 'guests' | 'liveMatch'>): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
    );
    return value;
  };
  return JSON.stringify(canonical({
    status: game.status,
    rotation: game.rotation ?? null,
    draft: game.draftTeams ?? null,
    players: game.players ?? [],
    guests: (game.guests ?? []).map(guest => ({ id: guest.id, waitlisted: !!guest.waitlisted })),
    clock: {
      running: !!game.liveMatch?.timerRunning,
      startedAt: game.liveMatch?.timerLastStartedAt ?? null,
      accumulated: game.liveMatch?.timerAccumulatedMs ?? 0,
    },
  }));
}
