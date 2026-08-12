// useGameEvents — realtime listener that turns game-doc changes into
// in-app banners (and, optionally, mirrors the snapshot back into the
// caller's local state so the screen stays up-to-date without an
// extra fetch). Mounted by MatchDetailsScreen and LiveMatchScreen so
// the user sees a brief banner whenever something happens in the
// session, including changes triggered by other devices.
//
// Detected events (banner copy lives in `he.ts`):
//   - player joined / left           (players[] grew or shrank)
//   - guest added                    (guests[] grew)
//   - teams ready                    (liveMatch assignments became non-empty)
//   - goal recorded                  (any score field increased)
//   - evening ended                  (status flipped to 'finished')
//   - game cancelled                 (status flipped to 'cancelled')
//
// Banner coalescing: rapid roster churn (10 people toggling join/cancel
// in seconds) would otherwise produce N stacked toasts. We accumulate
// joins/leaves into pending sets and flush once after a quiet window.
// Within the window, a join that's later cancelled by a leave (same
// uid) cancels out — so a "joined then left" within the same window
// shows no banner at all, and the count reflects the net change.
//
// Important guarantees:
//   * The first snapshot is treated as the initial-load baseline; no
//     banner fires for it. We only banner on diffs from a previous
//     snapshot we've already observed in this hook instance.
//   * Listener is unsubscribed on unmount, so navigating away stops
//     the stream cleanly.
//   * Mock mode is a no-op — there's nothing to listen to.

import { useEffect, useRef } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { docs } from '@/firebase/firestore';
import { USE_MOCK_DATA } from '@/firebase/config';
import { toast } from '@/components/Toast';
import { he } from '@/i18n/he';
import { useGameStore } from '@/store/gameStore';
import { useUserStore } from '@/store/userStore';
import { logError } from '@/services/errorLog';
import type { GameDoc } from '@/firebase/firestore';
import type { Game } from '@/types';

// How long to wait for additional roster diffs before firing the
// banner. 1500ms is long enough that 10 people fat-fingering
// join/cancel within a couple seconds collapse to a single banner,
// short enough that a normal "someone joined" feels real-time.
const ROSTER_BANNER_FLUSH_MS = 1500;

/** Build the joined-banner copy from the list of new uids. Looks each
 *  name up in the players store; falls back to the generic copy when
 *  the name isn't hydrated yet. If 2+ joined within the same window,
 *  shows a counted banner instead of N stacked ones. */
// FULL name, not just the first: in a club with two Omris the banner was
// ambiguous about who actually joined, and the roster right below it shows
// full names anyway (manager request).
function fullNameOf(displayName: string | undefined): string {
  return (displayName ?? '').trim();
}

function describeJoiners(uids: string[]): string {
  if (uids.length === 0) return he.bannerPlayerJoined;
  if (uids.length === 1) {
    const p = useGameStore.getState().players[uids[0]];
    const name = fullNameOf(p?.displayName);
    return name ? he.bannerPlayerJoinedNamed(name) : he.bannerPlayerJoined;
  }
  return he.bannerPlayersJoinedCount(uids.length);
}

function describeLeavers(uids: string[]): string {
  if (uids.length === 0) return he.bannerPlayerLeft;
  if (uids.length === 1) {
    const p = useGameStore.getState().players[uids[0]];
    const name = fullNameOf(p?.displayName);
    return name ? he.bannerPlayerLeftNamed(name) : he.bannerPlayerLeft;
  }
  return he.bannerPlayersLeftCount(uids.length);
}

interface UseGameEventsOptions {
  /** Called with every snapshot (except the very first baseline) so
   *  the caller can mirror remote roster / status changes into its
   *  own state without issuing a second read. */
  onUpdate?: (game: Game) => void;
  /** Called when the live listener hits a permission-denied error — i.e. the
   *  viewer lost read access mid-view (e.g. an admin removed them). Lets the
   *  screen pivot to a blocked state immediately instead of waiting for the
   *  next focus-reload. */
  onAccessBlocked?: () => void;
}

export function useGameEvents(
  gameId: string | undefined,
  opts: UseGameEventsOptions = {},
): void {
  const { onUpdate, onAccessBlocked } = opts;

  // Holds the last observed snapshot data so we can diff against the
  // next one. Lives on a ref (not state) — we don't want re-renders.
  const prevRef = useRef<GameDoc | null>(null);
  // Tracks whether we've consumed the first snapshot yet. The first
  // snapshot arrives synchronously after subscribe and represents the
  // current state, not a change — we record it but never banner.
  const seenFirstRef = useRef(false);

  // Pending roster-change accumulator. A uid added to `pendingJoined`
  // and later observed in `left` cancels out (cleared from both),
  // because the net effect across the window is "no change". Same
  // for the reverse direction.
  const pendingJoinedRef = useRef<Set<string>>(new Set());
  const pendingLeftRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the latest onUpdate in a ref so the listener doesn't need
  // to resubscribe whenever the parent re-renders with a fresh
  // callback identity.
  const onUpdateRef = useRef<typeof onUpdate>(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);
  const onAccessBlockedRef = useRef<typeof onAccessBlocked>(onAccessBlocked);
  useEffect(() => {
    onAccessBlockedRef.current = onAccessBlocked;
  }, [onAccessBlocked]);

  useEffect(() => {
    if (!gameId) return;
    if (USE_MOCK_DATA) return;

    // Reset on every gameId change so re-entering a different game
    // starts fresh.
    prevRef.current = null;
    seenFirstRef.current = false;
    pendingJoinedRef.current.clear();
    pendingLeftRef.current.clear();
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const flushRosterBanners = () => {
      flushTimerRef.current = null;
      const joined = Array.from(pendingJoinedRef.current);
      const left = Array.from(pendingLeftRef.current);
      pendingJoinedRef.current.clear();
      pendingLeftRef.current.clear();

      if (joined.length > 0) {
        const store = useGameStore.getState();
        const missing = joined.filter((u) => !store.players[u]);
        const fire = () => toast.success(describeJoiners(joined));
        if (missing.length > 0) {
          void store
            .hydratePlayers(missing)
            .catch(() => {})
            .finally(fire);
        } else {
          fire();
        }
      }
      if (left.length > 0) {
        toast.info(describeLeavers(left));
      }
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(
        flushRosterBanners,
        ROSTER_BANNER_FLUSH_MS,
      );
    };

    const unsub = onSnapshot(
      docs.game(gameId),
      (snap) => {
        if (!snap.exists()) {
          prevRef.current = null;
          return;
        }
        const curr = snap.data();
        const prev = prevRef.current;

        if (!seenFirstRef.current) {
          // Initial-load baseline. Store it; the screen's own initial
          // load fills the state, so we don't echo back via onUpdate
          // (would compete with that flow and cause a flicker).
          prevRef.current = curr;
          seenFirstRef.current = true;
          return;
        }

        // Mirror the latest snapshot into the caller's state so the
        // list, counts, statuses, etc. update in real time without a
        // second fetch. The shape matches gameService.getGameById's
        // return — GameDoc plus an empty `matches` array.
        try {
          onUpdateRef.current?.({ ...curr, matches: [] } as Game);
        } catch (err) {
          logError('useGameEventsOnUpdate', err, { gameId });
          if (__DEV__) console.warn('[useGameEvents] onUpdate threw', err);
        }

        // ── Roster diffs ─────────────────────────────────────────────
        // Diff at the uid level (not just length) so we can name the
        // joiner/leaver in the banner — "יוסי נרשם למשחק" instead of
        // the generic copy. Also suppresses the banner for the current
        // user's own action (no point pinging you about your own
        // tap), and accumulates diffs across the flush window so a
        // toggle-storm collapses to one banner with the net change.
        const prevSet = new Set<string>(prev?.players ?? []);
        const currSet = new Set<string>(curr.players ?? []);
        const justJoined: string[] = [];
        const justLeft: string[] = [];
        for (const uid of currSet) {
          if (!prevSet.has(uid)) justJoined.push(uid);
        }
        for (const uid of prevSet) {
          if (!currSet.has(uid)) justLeft.push(uid);
        }
        const myUid = useUserStore.getState().currentUser?.id ?? '';
        let touched = false;
        for (const uid of justJoined) {
          if (myUid && uid === myUid) continue;
          if (pendingLeftRef.current.has(uid)) {
            // Cancels a pending "left" — net = no change.
            pendingLeftRef.current.delete(uid);
          } else {
            pendingJoinedRef.current.add(uid);
          }
          touched = true;
        }
        for (const uid of justLeft) {
          if (myUid && uid === myUid) continue;
          if (pendingJoinedRef.current.has(uid)) {
            pendingJoinedRef.current.delete(uid);
          } else {
            pendingLeftRef.current.add(uid);
          }
          touched = true;
        }
        if (touched) scheduleFlush();

        const prevGuests = prev?.guests?.length ?? 0;
        const currGuests = curr.guests?.length ?? 0;
        if (currGuests > prevGuests) {
          toast.success(he.bannerGuestAdded);
        }

        // ── Status transitions ───────────────────────────────────────
        if (prev?.status !== 'finished' && curr.status === 'finished') {
          toast.info(he.bannerEveningEnded);
        }
        if (prev?.status !== 'cancelled' && curr.status === 'cancelled') {
          toast.info(he.bannerGameCancelled);
        }

        prevRef.current = curr;
      },
      (err) => {
        // Lost read access mid-view (admin removed the viewer) → let the
        // screen pivot to the blocked state live, not just on the next focus.
        const code =
          typeof (err as { code?: unknown })?.code === 'string'
            ? (err as { code: string }).code
            : '';
        if (code === 'permission-denied') {
          onAccessBlockedRef.current?.();
        }
        logError('useGameEventsSnapshot', err, { gameId });
        if (__DEV__) console.warn('[useGameEvents] snapshot error', err);
      }
    );

    return () => {
      unsub();
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingJoinedRef.current.clear();
      pendingLeftRef.current.clear();
    };
  }, [gameId]);
}
