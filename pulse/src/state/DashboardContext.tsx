import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { InteractionManager } from 'react-native';
import { runPoll } from '../services/poller';
import { getSnapshot, type Snapshot, emptySnapshot } from '../services/store';

interface DashboardState {
  snapshot: Snapshot;
  loading: boolean;
  refreshing: boolean;
  lastNewCount: number | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<DashboardState | undefined>(undefined);

/** How long after the UI settles before the startup poll runs. */
const POLL_DELAY_MS = 1500;

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastNewCount, setLastNewCount] = useState<number | null>(null);

  // Show cached data instantly, then poll fresh — but NOT in the way of the
  // first paint.
  //
  // This provider wraps the whole app, so its poll fired on every launch no
  // matter which screen you opened: ten parallel calls to App Store Connect,
  // Google Play, GA4, revenue and the chat scan, all competing with the first
  // screen's own fetch. Moving the dashboard off the launch tab did nothing
  // about it, because the work never lived on that screen. It lives here.
  //
  // The poll still runs, and still drives the new-review / chat local pushes —
  // it just waits until the UI has settled. A couple of seconds costs those
  // alerts nothing.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const cached = await getSnapshot();
      if (!alive) return;
      setSnapshot(cached);
      setLoading(false);
      const handle = InteractionManager.runAfterInteractions(() => {
        timer = setTimeout(async () => {
          try {
            const { snapshot: fresh, newReviews } = await runPoll();
            if (!alive) return;
            setSnapshot(fresh);
            setLastNewCount(newReviews);
          } catch {
            /* keep cached */
          }
        }, POLL_DELAY_MS);
      });
      if (!alive) handle.cancel();
    })();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { snapshot: fresh, newReviews } = await runPoll({ silent: true });
      setSnapshot(fresh);
      setLastNewCount(newReviews);
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <Ctx.Provider
      value={{ snapshot, loading, refreshing, lastNewCount, refresh }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useDashboard(): DashboardState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDashboard outside provider');
  return v;
}
