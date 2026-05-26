// watchSyncService — pushes the user's current game state to the paired
// Wear OS watch via the native WatchBridge module (Data Layer).
//
// The watch is a thin client: it renders one of three states (live
// stopwatch / upcoming game / not-registered). We compute which one from
// the user's games and hand it over as JSON. For the live stopwatch we
// relay the SAME three timer primitives the phone listens to, so the
// watch reconstructs the identical clock locally — no per-tick pushes.
//
// Everything here is best-effort and Android-only: on iOS, in mock mode,
// or on a build without the native module, it silently no-ops.

import { useEffect } from 'react';
import { NativeModules, Platform } from 'react-native';
import { USE_MOCK_DATA } from '@/firebase/config';
import { gameService } from '@/services/gameService';
import type { Game, UserId } from '@/types';

type WatchPayload =
  | {
      kind: 'live';
      title: string;
      timer: { running: boolean; lastStartedAt: number; accumulatedMs: number };
    }
  | {
      kind: 'upcoming';
      title: string;
      startsAt: number;
      fieldName: string;
      city: string;
      players: number;
      maxPlayers: number;
    }
  | { kind: 'notRegistered' };

/** Pick the watch state from the user's games (already filtered to "mine"). */
export function computeWatchPayload(myGames: Game[]): WatchPayload {
  const now = Date.now();

  // A live session = a game carrying a liveMatch that hasn't finished.
  const live = myGames.find(
    (g) => g.liveMatch != null && g.liveMatch.phase !== 'finished',
  );
  if (live && live.liveMatch) {
    return {
      kind: 'live',
      title: live.title,
      timer: {
        running: !!live.liveMatch.timerRunning,
        lastStartedAt: live.liveMatch.timerLastStartedAt ?? 0,
        accumulatedMs: live.liveMatch.timerAccumulatedMs ?? 0,
      },
    };
  }

  // Otherwise the soonest future game I'm registered to.
  const upcoming = myGames
    .filter((g) => g.startsAt > now && g.status !== 'finished' && g.status !== 'cancelled')
    .sort((a, b) => a.startsAt - b.startsAt)[0];
  if (upcoming) {
    return {
      kind: 'upcoming',
      title: upcoming.title,
      startsAt: upcoming.startsAt,
      fieldName: upcoming.fieldName ?? '',
      city: upcoming.city ?? '',
      players: upcoming.players?.length ?? 0,
      maxPlayers: upcoming.maxPlayers ?? 0,
    };
  }

  return { kind: 'notRegistered' };
}

/** Serialize + hand the payload to the native bridge. Safe no-op when the
 *  bridge isn't available (iOS / mock / pre-bridge build). */
export async function publishWatchState(myGames: Game[]): Promise<void> {
  if (USE_MOCK_DATA || Platform.OS !== 'android') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bridge = (NativeModules as any).WatchBridge;
  if (!bridge?.publishState) return;
  try {
    await bridge.publishState(JSON.stringify(computeWatchPayload(myGames)));
  } catch {
    // best-effort — a missed relay never affects the phone UX
  }
}

/**
 * Mount once (e.g. in App) with the signed-in user's id. Refreshes the
 * watch state on mount and every 20s while the app is alive. The watch
 * ticks the stopwatch locally between refreshes, so a coarse interval is
 * enough to catch start/pause/reset and registration changes.
 */
export function useWatchSync(userId: string | null): void {
  useEffect(() => {
    if (!userId || USE_MOCK_DATA || Platform.OS !== 'android') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(NativeModules as any).WatchBridge?.publishState) return;
    let alive = true;
    const push = async (uid: UserId) => {
      try {
        const games = await gameService.getMyGames(uid);
        if (alive) await publishWatchState(games);
      } catch {
        /* best-effort */
      }
    };
    push(userId);
    const id = setInterval(() => push(userId), 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [userId]);
}
