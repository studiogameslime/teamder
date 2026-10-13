/** Observes a tab gesture without claiming, cancelling or completing it. */
export type TouchPoint = { x: number; y: number };
type Geometry = { x: number; y: number; width: number; height: number };
type TraceData = Record<string, string | number | boolean>;
type Emit = (name: string, data: TraceData) => void;
type Measure = (done: (rect: Geometry) => void) => void;

export function touchPoint(event: { nativeEvent?: { pageX?: number; pageY?: number } }): TouchPoint | undefined {
  const { pageX: x, pageY: y } = event.nativeEvent ?? {};
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
    ? { x, y } : undefined;
}

/** At most one event per phase per gesture; never log move frames or raw events. */
export function createTabTouchTrace(tab: string, emit: Emit) {
  let index = 0;
  let completed = true;
  let start: TouchPoint | undefined;
  let maxDx = 0, maxDy = 0;
  let phases = new Set<string>();
  const once = (phase: string, data: TraceData = {}) => {
    if (phases.has(phase)) return;
    phases.add(phase);
    emit(`club_tab_${phase}`, { tab, index, ...data });
  };
  const update = (point?: TouchPoint) => {
    if (!point || !start) return;
    maxDx = Math.max(maxDx, Math.abs(point.x - start.x));
    maxDy = Math.max(maxDy, Math.abs(point.y - start.y));
  };
  return {
    pressIn(point: TouchPoint | undefined, measure: Measure) {
      if (completed) {
        index += 1; completed = false; start = point; maxDx = 0; maxDy = 0; phases = new Set();
      }
      if (phases.has('press_in')) return;
      once('press_in', point ?? {});
      const ticket = index;
      // Same native page-coordinate measurement used by Pressability. Delayed
      // callbacks from a previous gesture must not be attributed to the next.
      try {
        measure(rect => {
          if (ticket !== index || !Object.values(rect).every(Number.isFinite) || rect.width < 0 || rect.height < 0) return;
          const inside = !!start && start.x >= rect.x && start.x <= rect.x + rect.width && start.y >= rect.y && start.y <= rect.y + rect.height;
          once('measure', { ...rect, phase: start ? (inside ? 'inside' : 'outside') : 'unknown' });
        });
      } catch { /* Observation must never break the tab action. */ }
    },
    move(point?: TouchPoint) {
      if (completed) return;
      update(point);
      once('touch_move', point ? { ...point, dx: maxDx, dy: maxDy } : {});
    },
    finish(phase: 'touch_end' | 'touch_cancel', point?: TouchPoint) {
      if (completed) return;
      // Android can synthesize CANCEL in the ScrollView's local coordinates
      // without converting it to root/page space. It is a cancellation signal,
      // not evidence that the finger moved to that apparent page position.
      if (phase === 'touch_end') update(point);
      once(phase, { ...(phase === 'touch_end' ? point : undefined), dx: maxDx, dy: maxDy });
      completed = true;
    },
    // Press-out can carry the same synthetic cancellation coordinates.
    pressOut() { once('press_out'); },
    dispose() { index += 1; completed = true; phases = new Set(); },
  };
}
