import { useCallback, useEffect, useRef, useState } from 'react';

/** Feed confirmed snapshots only, never optimistic edits. First snapshot is a baseline. */
export function useArrivalTracker(scope: string) {
  const alive = useRef(true);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const baseline = useRef<{ scope: string; ids: Set<string> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [arrivals, setArrivals] = useState<Record<string, number>>({});
  const observe = useCallback((ids: readonly string[]) => {
    if (!alive.current || activeScope.current !== scope) return;
    const previous = baseline.current;
    baseline.current = { scope, ids: new Set(ids) };
    if (timer.current) clearTimeout(timer.current);
    const next: Record<string, number> = {};
    if (previous?.scope === scope) {
      // One short wave, even when reconnecting brings a large backlog.
      ids.filter(id => !previous.ids.has(id)).slice(-5).forEach(id => { next[id] = Date.now(); });
    }
    setArrivals(current => ({ ...current, ...next }));
    timer.current = setTimeout(() => setArrivals({}), 500);
  }, [scope]);
  useEffect(() => {
    alive.current = true;
    setArrivals({});
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); };
  }, [scope]);
  return { arrivals, observe };
}
