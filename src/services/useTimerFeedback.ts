import { useEffect, useRef, useState } from 'react';
import type { LiveMatchState } from '@/types';
import { serverNow } from '@/services/serverClock';
import { observeCaughtError } from '@/utils/errorObservation';

// This projection is display-only. Scores, round commits and the watch keep
// using the authoritative live state. A changed server clock always wins.
function clockKey(live: LiveMatchState | null): string {
  const event = live?.timerEvents?.slice(-1)[0];
  return JSON.stringify([!!live?.timerRunning, live?.timerLastStartedAt ?? null,
    live?.timerAccumulatedMs ?? 0, live?.timerControlledBy, event?.type, event?.at]);
}

function clockFields(live: LiveMatchState): Partial<LiveMatchState> {
  return { timerRunning: live.timerRunning, timerLastStartedAt: live.timerLastStartedAt,
    timerAccumulatedMs: live.timerAccumulatedMs };
}

export function useTimerFeedback(live: LiveMatchState | null, context: string | null) {
  const [, redraw] = useState(0);
  const state = useRef({ context, live, sequence: 0, pending: false,
    overlay: null as { baseline: string; fields: Partial<LiveMatchState> } | null });
  const current = state.current;
  if (current.context !== context) {
    current.context = context;
    current.sequence += 1;
    current.pending = false;
    current.overlay = null;
  }
  current.live = live;
  if (current.overlay && current.overlay.baseline !== clockKey(live)) current.overlay = null;
  useEffect(() => () => { current.sequence += 1; current.pending = false; current.overlay = null; }, [current]);

  const visibleLive = current.overlay ? { ...(live ?? {
    phase: 'roundReady' as const, assignments: {}, benchOrder: [], scoreA: 0, scoreB: 0,
  }), ...current.overlay.fields } : live;

  const run = async (action: 'start' | 'pause', write: (isCurrent: () => boolean) => Promise<LiveMatchState | null>): Promise<boolean> => {
    if (!current.context || current.pending) return false;
    const baseline = clockKey(current.live);
    const previousOverlay = current.overlay;
    const before = current.overlay?.baseline === baseline
      ? { ...current.live, ...current.overlay.fields } : current.live;
    const now = serverNow();
    const accumulated = before?.timerAccumulatedMs ?? 0;
    current.overlay = { baseline, fields: action === 'start'
      ? { timerRunning: true, timerLastStartedAt: before?.timerRunning ? before.timerLastStartedAt : now, timerAccumulatedMs: accumulated }
      : { timerRunning: false, timerLastStartedAt: null, timerAccumulatedMs: accumulated +
        (before?.timerRunning && before.timerLastStartedAt ? Math.max(0, now - before.timerLastStartedAt) : 0) } };
    current.pending = true; // Synchronous latch also blocks taps before React renders.
    const sequence = ++current.sequence;
    redraw(value => value + 1);
    try {
      const confirmed = await write(() => sequence === current.sequence);
      if (!confirmed) throw new Error('השעון אינו זמין במשחק הנוכחי.');
      if (sequence !== current.sequence) return false;
      // Keep the committed clock if its listener has not arrived yet. Never
      // restore an old snapshot between acknowledgement and realtime delivery.
      current.overlay = clockKey(current.live) === baseline
        ? { baseline, fields: clockFields(confirmed) } : null;
      return true;
    } catch (error) {
      if (sequence !== current.sequence) return false;
      observeCaughtError(error, { source: 'src/services/useTimerFeedback.ts', handler: 'run', site: 'useTimerFeedback:run' });
      current.overlay = clockKey(current.live) === baseline ? previousOverlay : null;
      throw error;
    } finally {
      if (sequence === current.sequence) {
        current.pending = false;
        redraw(value => value + 1);
      }
    }
  };
  return { visibleLive, pending: current.pending, isPending: () => current.pending, run };
}
