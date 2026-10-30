import {httpsCallable} from './diagnosticCallable';
import {getFirebase, USE_MOCK_DATA} from '@/firebase/config';
import type {Game} from '@/types';
import {observeCaughtError} from '@/utils/errorObservation';

export interface ManagerHistoryRow {
  gameId: string; groupId: string; startsAt: number; opensAt: number | null;
  complete: boolean; observedAt: number; firstFullAt: number | null; promotions: number;
  waitlistAtStart: {at: number; count: number} | null;
  cancellations: Record<string, {total: number; late: number; unknownDeadline: number}>;
}
export type ManagerHistory = {status: 'available'; rows: ManagerHistoryRow[]} | {status: 'unavailable'; rows: []};
const nonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const timestamp = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
export function readManagerHistory(value: unknown, groupId: string, games: Game[]): ManagerHistoryRow[] {
  if (!Array.isArray(value)) throw new Error('manager-history-invalid');
  const scope = new Map(games.filter(g => g.groupId === groupId).map(g => [g.id, g]));
  const rows = value.map(v => {
    if (!v || typeof v !== 'object') throw new Error('manager-history-invalid');
    const r = v as Record<string, any>, game = scope.get(r.gameId);
    if (!game || r.groupId !== groupId || r.startsAt !== game.startsAt || typeof r.complete !== 'boolean' ||
      !timestamp(r.observedAt) || !(r.opensAt === null || timestamp(r.opensAt)) ||
      !(r.firstFullAt === null || timestamp(r.firstFullAt)) || !nonnegative(r.promotions) ||
      !r.cancellations || typeof r.cancellations !== 'object' || Array.isArray(r.cancellations)) throw new Error('manager-history-invalid');
    if (r.waitlistAtStart !== null && (!r.waitlistAtStart || !timestamp(r.waitlistAtStart.at) ||
      r.waitlistAtStart.at > game.startsAt || !nonnegative(r.waitlistAtStart.count))) throw new Error('manager-history-invalid');
    for (const c of Object.values(r.cancellations) as any[]) {
      if (!c || ![c.total, c.late, c.unknownDeadline].every(nonnegative) || c.late + c.unknownDeadline > c.total)
        throw new Error('manager-history-invalid');
    }
    return r as ManagerHistoryRow;
  });
  if (new Set(rows.map(r => r.gameId)).size !== rows.length) throw new Error('manager-history-invalid');
  return rows;
}
export async function loadManagerHistory(groupId: string, viewerId: string, games: Game[]): Promise<ManagerHistory> {
  if (USE_MOCK_DATA) {
    if (__DEV__ && process.env.EXPO_PUBLIC_QA_ROUTES === '1') return {status: 'available', rows: (await import('@/data/managerDashboardDemo')).managerDemoHistory(groupId, games)};
    return {status: 'available', rows: []};
  }
  const check = () => { if (getFirebase().auth.currentUser?.uid !== viewerId) throw new Error('manager-session-changed'); };
  check();
  try {
    const response = await httpsCallable<{groupId: string; gameIds: string[]}, {rows: unknown}>(getFirebase().functions,
      'getManagerRoundHistory')({groupId, gameIds: [...new Set(games.filter(g => g.groupId === groupId).map(g => g.id))].slice(0, 200)});
    check();
    return {status: 'available', rows: readManagerHistory(response.data.rows, groupId, games)};
  } catch (error) {
    check();
    // Expected during the staged release; never convert a network/permission
    // failure into an empty, successfully measured history.
    const code = (error as {code?: string})?.code;
    if (code === 'functions/not-found' || code === 'functions/unimplemented') return {status: 'unavailable', rows: []};
    observeCaughtError(error, {source: 'src/services/managerHistoryService.ts', handler: 'loadManagerHistory', site: 'manager-history-call'});
    throw error;
  }
}
