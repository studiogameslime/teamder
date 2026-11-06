import { useEffect, useMemo, useRef, useState } from 'react';
import { loadManagerDashboardScores, type ManagerData } from '@/services/managerDashboardService';
import { didEveningHappen } from '@/utils/eveningPlayed';
import { inSeason } from '@/utils/seasonScope';
import { observeCaughtError } from '@/utils/errorObservation';

export type ManagerScorePeriod = 30 | 90 | 'season';
export function managerScoreGames(data: ManagerData, period: ManagerScorePeriod, now: number) {
  return data.games.filter(game => game.groupId === data.group.id && game.startsAt < now && didEveningHappen(game) &&
    (period === 'season' ? inSeason(game, data.group.seasons) : game.startsAt >= now - period * 86400000));
}

type ScoreRead = { base: ManagerData; scope: string; loading: boolean; failed: boolean; refreshRequired?: boolean; scores: ManagerData['scores'] };

/** Successful reads belong to one base revision only. Switching periods reuses
 * matching sealed rows; refresh and identity changes always create a new base. */
export function useManagerDashboardScores(base: ManagerData | null, viewerId: string, enabled: boolean, period: ManagerScorePeriod, now: number, refreshBase: () => void) {
  const [state, setState] = useState<ScoreRead | null>(null);
  const [retry, setRetry] = useState(0);
  const cache = useRef<{ base: ManagerData; scores: ManagerData['scores'] } | null>(null);
  const games = useMemo(() => base ? managerScoreGames(base, period, now) : [], [base, period, now]);
  const scope = JSON.stringify(games.map(game => game.id));
  const live = useRef({ base, scope, enabled });
  live.current = { base, scope, enabled };

  useEffect(() => {
    if (!base || !enabled) return;
    let alive = true;
    const current = () => alive && live.current.base === base && live.current.scope === scope && live.current.enabled;
    const known = cache.current?.base === base ? cache.current.scores : base.scores;
    const missing = games.filter(game => !Object.prototype.hasOwnProperty.call(known, game.id));
    setState({ base, scope, loading: missing.length > 0, failed: false, scores: known });
    if (missing.length) {
      void loadManagerDashboardScores(base.group, viewerId, missing, { isCurrent: current }).then(result => {
        if (!current()) return;
        const scores = { ...known, ...result.scores };
        cache.current = { base, scores };
        setState({ base, scope, loading: false, failed: result.scoresIncomplete, scores });
      }).catch((error: unknown) => {
        if (!current()) return;
        observeCaughtError(error, { source: 'src/screens/communities/useManagerDashboardScores.ts', handler: 'loadScores', site: 'manager-scores' });
        const refreshRequired = (error as { message?: string })?.message === 'manager-season-changed';
        if (refreshRequired && cache.current?.base === base) cache.current = null;
        setState({ base, scope, loading: false, failed: true, refreshRequired, scores: refreshRequired ? {} : known });
      });
    }
    return () => { alive = false; };
  }, [base, viewerId, enabled, scope, retry]);

  const scores = state?.base === base ? state.scores : base?.scores ?? {};
  const complete = games.every(game => Object.prototype.hasOwnProperty.call(scores, game.id));
  const matches = state?.base === base && state?.scope === scope;
  const loading = !!base && enabled && !complete && (!matches || state.loading);
  const failed = !!base && enabled && matches && state.failed;
  const needsBaseRefresh = !!base && matches && state.refreshRequired === true;
  const data = useMemo(() => base ? { ...base, scores, scoresIncomplete: !complete } : null, [base, scores, complete]);
  return { data, loading, failed, needsBaseRefresh, retry: () => {
    if (needsBaseRefresh) refreshBase();
    else setRetry(value => value + 1);
  } };
}
