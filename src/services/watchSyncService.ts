// watchSyncService — pushes the user's current game state to the paired
// Wear OS watch via the native WatchBridge module (Data Layer).
//
// The watch is a thin client: it renders one of three states (live
// stopwatch / upcoming game / not-registered). We compute which one from
// the user's games and hand it over as JSON. For the live stopwatch we
// relay the SAME three timer primitives the phone listens to, so the
// watch reconstructs the identical clock locally — no per-tick pushes.
//
// The phone home-screen widget (TeamderWidgetProvider) consumes the same
// payload via SharedPreferences. Its play/pause/reset buttons mutate
// Firestore directly from native Kotlin, so they need:
//   • `gameId` — which game to target
//   • `viewer.id` + `viewer.name` — to stamp `timerControlledBy*`
//   • `controlledBy*` — so the widget can show "מופעל ע״י X" when the
//     timer is being run by someone other than the local user
// These are added to the payload below.
//
// Everything here is best-effort and Android-only: on iOS, in mock mode,
// or on a build without the native module, it silently no-ops.

import { useEffect } from 'react';
import { NativeModules, Platform } from 'react-native';
import { USE_MOCK_DATA } from '@/firebase/config';
import { gameService } from '@/services/gameService';
import { getServerOffsetMs, serverNow, syncServerClock } from '@/services/serverClock';
import { userService } from '@/services/userService';
import { useUserStore } from '@/store/userStore';
import type { Game } from '@/types';

/** One roster entry relayed to the watch's players-list screen. */
type WatchPlayer = {
  name: string;
  photo: string; // '' when none → watch draws an initial avatar
  role: 'admin' | 'guest' | 'member';
};

/** Local-device user info — included in every payload so the native
 *  widget can identify itself when writing back to Firestore. */
type Viewer = { id: string; name: string };

type WatchPayload = {
  viewer: Viewer;
  /** serverNow() - localNow on THIS device, in ms. The phone-side widget
   *  (same device) and the paired watch (whose clock Wear OS keeps synced
   *  to the phone) both add this to their local clock so they reconstruct
   *  the timer in the SAME server-time base the in-app screen uses — no
   *  cross-device skew. A constant correction, so it survives a stale
   *  cached payload (unlike a one-shot "server time now" stamp would). */
  clockOffsetMs: number;
  /** True server time (ms) stamped at publish. The watch/widget measure THEIR
   *  OWN offset from this on receipt (serverNowMs − their monotonic/wall clock)
   *  instead of trusting the phone's offset against a clock that may not be the
   *  watch's. Anchors the device-independent `baseElapsedMs` below. */
  serverNowMs: number;
} & (
  | {
      kind: 'live';
      gameId: string;
      title: string;
      timer: {
        running: boolean;
        lastStartedAt: number;
        accumulatedMs: number;
        /** Fully-resolved elapsed ms AT the publish instant (serverNowMs), in
         *  NO device's clock base. The watch counts up from this using its own
         *  MONOTONIC uptime — immune to wall-clock skew (the real fix for the
         *  "timer stuck at 0" bug). */
        baseElapsedMs: number;
      };
      /** uid of the admin who last touched the timer (or '' when never). */
      controlledBy: string;
      /** Display name of the controller — used by the widget for the
       *  "מופעל ע״י X" hint when controller != viewer. */
      controlledByName: string;
      /** Roster of the LIVE game — so the players widget shows the current
       *  squad instead of "אין משחק קרוב" while a game is in progress. */
      startsAt: number;
      fieldName: string;
      city: string;
      playersCount: number;
      maxPlayers: number;
      players: WatchPlayer[];
    }
  | {
      kind: 'upcoming';
      gameId: string;
      title: string;
      startsAt: number;
      fieldName: string;
      city: string;
      playersCount: number;
      maxPlayers: number;
      players: WatchPlayer[];
    }
  | {
      /** Game exists and is visible to the user but registration hasn't
       *  opened yet (status:'scheduled', `registrationOpensAt` in the
       *  future). All three surfaces render "המשחק יפתח להרשמה ב…". */
      kind: 'scheduled';
      gameId: string;
      title: string;
      /** ms epoch — moment when registration opens (status flips to 'open'). */
      registrationOpensAt: number;
      /** Kickoff time, for context. */
      startsAt: number;
      fieldName: string;
      city: string;
    }
  | { kind: 'notRegistered' }
);

/**
 * Pick the watch state from the user's games (already filtered to "mine").
 * Async because the upcoming-game state resolves the roster's display
 * names + photos from /users.
 */
export async function computeWatchPayload(
  myGames: Game[],
  viewer: Viewer,
): Promise<WatchPayload> {
  const now = Date.now();

  // A live session = a game carrying a liveMatch that hasn't finished.
  const live = myGames.find(
    (g) => g.liveMatch != null && g.liveMatch.phase !== 'finished',
  );
  if (live && live.liveMatch) {
    const players = await resolveRoster(live);
    const running = !!live.liveMatch.timerRunning;
    const lastStartedAt = live.liveMatch.timerLastStartedAt ?? 0;
    const accumulatedMs = live.liveMatch.timerAccumulatedMs ?? 0;
    const nowServer = serverNow();
    // Resolve elapsed to a device-independent base at the publish instant.
    const baseElapsedMs =
      running && lastStartedAt > 0
        ? accumulatedMs + Math.max(0, nowServer - lastStartedAt)
        : accumulatedMs;
    return {
      viewer,
      clockOffsetMs: getServerOffsetMs(),
      serverNowMs: nowServer,
      kind: 'live',
      gameId: live.id,
      title: live.title,
      timer: {
        running,
        lastStartedAt,
        accumulatedMs,
        baseElapsedMs,
      },
      controlledBy: live.liveMatch.timerControlledBy ?? '',
      controlledByName: live.liveMatch.timerControlledByName ?? '',
      startsAt: live.startsAt,
      fieldName: live.fieldName ?? '',
      city: live.city ?? '',
      playersCount: players.length,
      maxPlayers: live.maxPlayers ?? 0,
      players,
    };
  }

  // Otherwise the soonest non-terminal future game. Status decides
  // which "upcoming-ish" variant we emit:
  //   scheduled → registration hasn't opened yet ("יפתח להרשמה ב…")
  //   open/locked/active (without live phase) → standard upcoming card
  const upcoming = myGames
    .filter((g) => g.startsAt > now && g.status !== 'finished' && g.status !== 'cancelled')
    .sort((a, b) => a.startsAt - b.startsAt)[0];
  if (upcoming) {
    if (
      upcoming.status === 'scheduled' &&
      typeof upcoming.registrationOpensAt === 'number' &&
      upcoming.registrationOpensAt > now
    ) {
      return {
        viewer,
        clockOffsetMs: getServerOffsetMs(),
        serverNowMs: serverNow(),
        kind: 'scheduled',
        gameId: upcoming.id,
        title: upcoming.title,
        registrationOpensAt: upcoming.registrationOpensAt,
        startsAt: upcoming.startsAt,
        fieldName: upcoming.fieldName ?? '',
        city: upcoming.city ?? '',
      };
    }
    const players = await resolveRoster(upcoming);
    return {
      viewer,
      clockOffsetMs: getServerOffsetMs(),
      serverNowMs: serverNow(),
      kind: 'upcoming',
      gameId: upcoming.id,
      title: upcoming.title,
      startsAt: upcoming.startsAt,
      fieldName: upcoming.fieldName ?? '',
      city: upcoming.city ?? '',
      playersCount: players.length,
      maxPlayers: upcoming.maxPlayers ?? 0,
      players,
    };
  }

  return { viewer, clockOffsetMs: getServerOffsetMs(), serverNowMs: serverNow(), kind: 'notRegistered' };
}

/**
 * Resolve a game's roster into watch rows: real registrants (name + photo
 * from /users, role 'admin' for the creator) followed by guests (name
 * only, role 'guest'). Missing users degrade to a generic name rather
 * than dropping the row.
 */
async function resolveRoster(game: Game): Promise<WatchPlayer[]> {
  const ids = game.players ?? [];
  const users = await Promise.all(
    ids.map((uid) => userService.getUserById(uid).catch(() => null)),
  );
  const real: WatchPlayer[] = ids.map((uid, i) => ({
    name: users[i]?.name?.trim() || 'שחקן',
    photo: users[i]?.photoUrl ?? '',
    role: uid === game.createdBy ? 'admin' : 'member',
  }));
  // Only ACTIVE guests occupy a seat — a waitlisted guest isn't on the roster,
  // so excluding them keeps the watch/widget count consistent with the app.
  const guests: WatchPlayer[] = (game.guests ?? [])
    .filter((g) => g.waitlisted !== true)
    .map((g) => ({
      name: g.name,
      photo: '',
      role: 'guest',
    }));
  return [...real, ...guests];
}

/** Serialize + hand the payload to the native bridge. Safe no-op when the
 *  bridge isn't available (iOS / mock / pre-bridge build). */
export async function publishWatchState(
  myGames: Game[],
  viewer: Viewer,
): Promise<void> {
  if (USE_MOCK_DATA || Platform.OS !== 'android') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bridge = (NativeModules as any).WatchBridge;
  if (!bridge?.publishState) return;
  // AWAIT the server-clock sync so the payload's serverNowMs / baseElapsedMs are
  // anchored to true server time even on the very first (cold-start) publish —
  // otherwise the first live payload could ship an offset of 0. De-duped +
  // cached, so it's a no-op network-wise once synced this session.
  await syncServerClock();
  try {
    await bridge.publishState(
      JSON.stringify(await computeWatchPayload(myGames, viewer)),
    );
  } catch (err) {
    // Best-effort relay to the Wear OS companion — a failure here is almost
    // always environmental (no watch paired, Data Layer busy) and never
    // affects the phone UX, so we deliberately do NOT log it as a bug (it
    // only added noise to the panel). Dev-only console for debugging.
    if (__DEV__) console.warn('[watch] publishWatchState failed', err);
  }
}

/**
 * Mount once (e.g. in App) with the signed-in user's id. Subscribes to
 * Firestore for realtime updates on every game the user participates in
 * and re-publishes to all surfaces (watch app + Wear Tile + phone
 * widgets) within ~1s of any change — registrations from other devices,
 * timer start/pause/reset, game lifecycle flips, etc.
 *
 * Replaced the previous 20-second polling loop: the watch ticks the
 * stopwatch locally between events anyway, but the player roster,
 * registration count, and controller name all need to refresh promptly
 * when ANOTHER user (another phone, the same user on another device,
 * the admin) writes to the game. onSnapshot delivers that.
 *
 * Caveat: subscription is alive only while the JS process is alive.
 * Once the app is killed by the system, real-time refresh stops. For
 * "refresh while app is dead" we'd need an FCM-data path that wakes a
 * native receiver — out of scope for v1.
 */
export function useWatchSync(userId: string | null): void {
  // Pull the viewer's name from the user store so the native widget can
  // stamp `timerControlledByName` natively (mirroring the JS path).
  const userName = useUserStore((s) => s.currentUser?.name ?? '');

  useEffect(() => {
    if (!userId || USE_MOCK_DATA || Platform.OS !== 'android') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(NativeModules as any).WatchBridge?.publishState) return;
    let alive = true;
    const viewer: Viewer = { id: userId, name: userName };
    const unsub = gameService.subscribeMyLiveOrUpcomingGames(
      userId,
      (games) => {
        if (!alive) return;
        // Fire-and-forget — publishWatchState is best-effort and any
        // hiccup is recovered by the next snapshot.
        void publishWatchState(games, viewer);
      },
    );
    return () => {
      alive = false;
      unsub();
    };
  }, [userId, userName]);
}
