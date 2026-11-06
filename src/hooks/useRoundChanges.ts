import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { Game } from '@/types';
import { roundChanges, roundVisit, type RoundVisit } from '@/utils/roundVisit';
import { readRoundVisit, saveRoundVisit } from '@/services/roundVisitService';
import { observedRejection } from '@/utils/errorObservation';

export function useRoundChanges(owner: string | undefined, id: string, game: Game | null) {
  const key = JSON.stringify([owner, id]);
  const [baseline, setBaseline] = useState<{key: string; ready: boolean; visit: RoundVisit | null}>({key, ready: false, visit: null});
  const latest = useRef<{key: string; visit: RoundVisit | null}>({key, visit: null});
  if (latest.current.key !== key) latest.current = {key, visit: null};
  latest.current.visit = game?.id === id ? roundVisit(game) : null;
  useFocusEffect(useCallback(() => {
    let alive = true;
    const current = latest.current;
    setBaseline({key, ready: false, visit: null});
    if (owner && id) void readRoundVisit(owner, id).then(visit => {
      if (alive) setBaseline({key, ready: true, visit});
    });
    return () => {
      alive = false;
      if (owner && id && current.key === key && current.visit) void saveRoundVisit(owner, id, current.visit).catch(observedRejection(() => undefined, {source: 'src/hooks/useRoundChanges.ts', handler: 'useRoundChanges', site: 'roundVisit:acknowledge'}));
    };
  }, [key, owner, id]));
  useEffect(() => {
    // The first view has no change badge. Later live updates compare to the
    // first visible version until this visit ends.
    if (baseline.key === key && baseline.ready && !baseline.visit && latest.current.visit)
      setBaseline({key, ready: true, visit: latest.current.visit});
  }, [baseline, key, game]);
  return latest.current.visit ? roundChanges(baseline.key === key && baseline.ready ? baseline.visit : null, latest.current.visit) : {time: false, location: false};
}
