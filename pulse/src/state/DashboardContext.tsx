import { observeCaughtError } from '../services/errorObservation';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
} from 'react';
import { runPoll } from '../services/poller';
import { getSnapshot, type Snapshot, emptySnapshot } from '../services/store';

interface DashboardState {
  snapshot: Snapshot;
  loading: boolean;
  refreshing: boolean;
  lastNewCount: number | null;
  refresh: () => Promise<void>;
  ensureFresh: () => Promise<void>;
}

const Ctx = createContext<DashboardState | undefined>(undefined);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastNewCount, setLastNewCount] = useState<number | null>(null);

  const inFlight = useRef<Promise<void> | null>(null);
  const lastFetch = useRef(0);
  const alive = useRef(true);
  const hydrated = useRef(false);
  useEffect(() => {
    alive.current = true;
    void getSnapshot().then(value => {
      if (!alive.current || hydrated.current) return;
      setSnapshot(value); setLoading(false);
    });
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    setRefreshing(true);
    const pending = runPoll({ silent: true }).then(({ snapshot: fresh, newReviews }) => {
      if (!alive.current) return;
      hydrated.current = true;
      setSnapshot(fresh); setLastNewCount(newReviews); lastFetch.current = Date.now();
    }).finally(() => { inFlight.current = null; if (alive.current) { setRefreshing(false); setLoading(false); } });
    inFlight.current = pending;
    return pending;
  }, []);
  const ensureFresh = useCallback(() => Date.now() - lastFetch.current < 5 * 60_000 ? Promise.resolve() : refresh(), [refresh]);

  return (
    <Ctx.Provider
      value={{ snapshot, loading, refreshing, lastNewCount, refresh, ensureFresh }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useDashboard(load = false): DashboardState {
  const v = useContext(Ctx);
  useEffect(() => { if (load && v) void v.ensureFresh().catch((caughtErrore8b735a90e: unknown) => {
    observeCaughtError(caughtErrore8b735a90e, {"source":"pulse/src/state/DashboardContext.tsx","handler":"useDashboard","site":"DashboardContext:e8b735a90e"});}); }, [load, v?.ensureFresh]);
  if (!v) throw new Error('useDashboard outside provider');
  return v;
}
