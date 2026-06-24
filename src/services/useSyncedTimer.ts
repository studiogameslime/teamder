// useSyncedTimer — single source of truth for the live-match clock.
//
// Reads the three primitives stored on `LiveMatchState`
// (timerRunning, timerLastStartedAt, timerAccumulatedMs) and produces
// a tick-by-tick displayed value that every device sees in lockstep.
// No server-side ticking required: each client reconstructs the time
// from the same three numbers and a wall-clock `Date.now()`.
//
// The hook also surfaces "who is controlling" so the UI can render a
// small "הטיימר מופעל על ידי דני" hint, and a `lastChangeAt` epoch
// so consumers (e.g. a toast layer) can detect external mutations.

import { useEffect, useRef, useState } from 'react';
import type { LiveMatchState } from '@/types';
import { serverNow, syncServerClock } from '@/services/serverClock';

/** Update interval for the displayed ms value. 250 ms is fine
 *  visually (text only shows whole seconds) and saves battery vs
 *  every-frame ticking. */
const TICK_INTERVAL_MS = 250;

interface SyncedTimerView {
  /** Currently-displayed elapsed milliseconds. Ticks while running,
   *  stays put while paused. */
  displayMs: number;
  /** Is the timer currently ticking on the server? */
  running: boolean;
  /** True if the server-side timer was ever started (we have a
   *  non-zero accumulator OR a live `lastStartedAt`). Reset = false. */
  started: boolean;
  /** Display name of the admin who last touched a timer control.
   *  Null on first paint / legacy data. */
  controlledByName: string | null;
  /** User id behind `controlledByName` — used to suppress the "X
   *  changed the timer" toast on the device that initiated the
   *  change. */
  controlledById: string | null;
}

export function useSyncedTimer(
  liveMatch: LiveMatchState | null | undefined,
): SyncedTimerView {
  const running = !!liveMatch?.timerRunning;
  const lastStartedAt = liveMatch?.timerLastStartedAt ?? null;
  const accumulated = liveMatch?.timerAccumulatedMs ?? 0;

  // Computes the current display value from the three primitives. Uses
  // `serverNow()` (NOT `Date.now()`) so devices with skewed wall clocks
  // still reconstruct the SAME elapsed time from the shared anchor.
  const compute = useRef<() => number>(() => 0);
  compute.current = () => {
    if (running && typeof lastStartedAt === 'number' && lastStartedAt > 0) {
      const delta = serverNow() - lastStartedAt;
      return accumulated + Math.max(0, delta);
    }
    return accumulated;
  };

  const [displayMs, setDisplayMs] = useState<number>(compute.current());

  // Make sure this device's server-clock offset is measured whenever a live
  // match is on screen. De-duped + cached inside the service, so mounting
  // several timer consumers triggers at most one network sync.
  useEffect(() => {
    if (liveMatch) void syncServerClock();
  }, [liveMatch]);

  // Re-sync the server clock periodically WHILE a match is on screen. A single
  // measurement at mount drifts over a long match (one device's wall clock can
  // creep), desyncing the timer across phones. Re-probing every ~2 min (the
  // service's own RESYNC window de-dupes the actual network call) corrects it.
  // Cleared as soon as the live match ends / screen unmounts.
  const hasLiveMatch = !!liveMatch;
  useEffect(() => {
    if (!hasLiveMatch) return;
    const id = setInterval(() => void syncServerClock(), 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [hasLiveMatch]);

  // Snap to the latest server state on every change. This catches
  // pause / reset / external admin mutations immediately, not on the
  // next tick.
  useEffect(() => {
    setDisplayMs(compute.current());
  }, [running, lastStartedAt, accumulated]);

  // Local tick while running. We don't use Reanimated here because
  // the displayed value lives inside <Text/> content, which can only
  // be driven by React state on the JS thread.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setDisplayMs(compute.current());
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running]);

  return {
    displayMs,
    running,
    started: running || accumulated > 0,
    controlledByName: liveMatch?.timerControlledByName ?? null,
    controlledById: liveMatch?.timerControlledBy ?? null,
  };
}
