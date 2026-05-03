// useGameEvents — realtime listener that turns game-doc changes into
// in-app banners. Mounted by MatchDetailsScreen and LiveMatchScreen so
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
import { banner } from '@/components/Banner';
import { he } from '@/i18n/he';
import type { GameDoc } from '@/firebase/firestore';

/** Sum of all team scores — used to detect "any goal anywhere". */
function totalScore(g: GameDoc | null | undefined): number {
  const lm = g?.liveMatch;
  if (!lm) return 0;
  return (
    (lm.scoreA ?? 0) +
    (lm.scoreB ?? 0) +
    (lm.scoreC ?? 0) +
    (lm.scoreD ?? 0) +
    (lm.scoreE ?? 0)
  );
}

function hasAnyAssignments(g: GameDoc | null | undefined): boolean {
  const lm = g?.liveMatch;
  if (!lm) return false;
  // Object.keys is enough — even one entry means the coach has placed
  // a player on a team, i.e. teams are at least partially built.
  return Object.keys(lm.assignments ?? {}).length > 0;
}

export function useGameEvents(gameId: string | undefined): void {
  // Holds the last observed snapshot data so we can diff against the
  // next one. Lives on a ref (not state) — we don't want re-renders.
  const prevRef = useRef<GameDoc | null>(null);
  // Tracks whether we've consumed the first snapshot yet. The first
  // snapshot arrives synchronously after subscribe and represents the
  // current state, not a change — we record it but never banner.
  const seenFirstRef = useRef(false);

  useEffect(() => {
    if (!gameId) return;
    if (USE_MOCK_DATA) return;

    // Reset on every gameId change so re-entering a different game
    // starts fresh.
    prevRef.current = null;
    seenFirstRef.current = false;

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
          // Initial-load baseline. Just store it.
          prevRef.current = curr;
          seenFirstRef.current = true;
          return;
        }

        // ── Roster diffs ─────────────────────────────────────────────
        const prevPlayers = prev?.players?.length ?? 0;
        const currPlayers = curr.players?.length ?? 0;
        if (currPlayers > prevPlayers) {
          banner.success(he.bannerPlayerJoined);
        } else if (currPlayers < prevPlayers) {
          banner.info(he.bannerPlayerLeft);
        }

        const prevGuests = prev?.guests?.length ?? 0;
        const currGuests = curr.guests?.length ?? 0;
        if (currGuests > prevGuests) {
          banner.success(he.bannerGuestAdded);
        }

        // ── Teams-ready transition ───────────────────────────────────
        // From "no assignments" → "any assignment" once per game (the
        // first time the coach builds teams). Subsequent edits don't
        // re-fire because hasAnyAssignments(prev) stays true.
        if (!hasAnyAssignments(prev) && hasAnyAssignments(curr)) {
          banner.success(he.bannerTeamsReady);
        }

        // ── Goal recorded ────────────────────────────────────────────
        // Strictly increasing total score signals a new goal. A
        // correction (decrement) is intentionally silent.
        const prevScore = totalScore(prev);
        const currScore = totalScore(curr);
        if (currScore > prevScore) {
          banner.success(he.bannerGoalRecorded);
        }

        // ── Status transitions ───────────────────────────────────────
        if (prev?.status !== 'finished' && curr.status === 'finished') {
          banner.info(he.bannerEveningEnded);
        }
        if (prev?.status !== 'cancelled' && curr.status === 'cancelled') {
          banner.info(he.bannerGameCancelled);
        }

        prevRef.current = curr;
      },
      (err) => {
        if (__DEV__) console.warn('[useGameEvents] snapshot error', err);
      }
    );

    return () => {
      unsub();
    };
  }, [gameId]);
}
