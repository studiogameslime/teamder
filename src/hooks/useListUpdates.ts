import { useCallback, useEffect, useRef, useState } from 'react';
import { acceptListUpdate, emptyListUpdates, receiveListUpdate } from '@/utils/listUpdates';

export function useListUpdates<T>(scope: string, data: readonly T[], options: {
  ready: boolean; hold: boolean; key: (item: T) => string; revision?: (item: T) => string;
}) {
  const ids = data.map(options.key);
  const revisions = Object.fromEntries(data.map(item => [options.key(item), options.revision?.(item) ?? '']));
  const signature = JSON.stringify([ids, revisions]);
  const [state, setState] = useState(() => emptyListUpdates(scope));
  const latest = useRef({ scope, ids, revisions, ready: options.ready });
  latest.current = { scope, ids, revisions, ready: options.ready };
  useEffect(() => {
    setState(previous => receiveListUpdate(previous, { ...latest.current, hold: options.hold, now: Date.now() }));
  }, [scope, signature, options.ready, options.hold]);
  const active = state.scope === scope && state.initialized ? state : null;
  const records = new Map(data.map(item => [options.key(item), item]));
  const items = active ? active.order.map(id => records.get(id)).filter((item): item is T => item !== undefined) : [...data];
  const apply = useCallback(() => {
    if (latest.current.scope !== scope || !latest.current.ready) return;
    setState(previous => previous.scope === scope ? acceptListUpdate(previous, Date.now()) : previous);
  }, [scope]);
  const known = new Set(active?.order ?? []);
  return { items, pending: !!active?.pending, pendingCount: active?.pending?.filter(id => !known.has(id)).length ?? 0,
    highlights: active?.highlights ?? {}, apply };
}
