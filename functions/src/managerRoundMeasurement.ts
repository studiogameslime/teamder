export interface MeasuredRound {
  groupId?: string; startsAt?: number; registrationOpensAt?: number; createdAt?: number;
  maxPlayers?: number; players?: string[]; waitlist?: string[];
  guests?: {waitlisted?: boolean}[]; cancellations?: Record<string, number>;
  cancelDeadlineHours?: number; pendingPromotion?: {uid?: string} | null;
}
export interface ManagerRoundMeasure {
  schema: 1; groupId: string; gameId: string; startsAt: number;
  opensAt: number | null; complete: boolean; observedAt: number; firstFullAt: number | null;
  promotions: number; waitlistAtStart: {at: number; count: number} | null;
  cancellations: Record<string, {total: number; late: number; unknownDeadline: number}>;
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ids = (v?: string[]) => [...new Set((v ?? []).filter(x => typeof x === 'string' && x))];
/** Reducer is applied once per event by a transaction receipt. Handles delayed
 * deliveries using source update time; never upgrades incomplete legacy data. */
export function measureRoundChange(previous: ManagerRoundMeasure | undefined, before: MeasuredRound | undefined,
  after: MeasuredRound, gameId: string, at: number): ManagerRoundMeasure | null {
  if (!after.groupId || !finite(after.startsAt) || !finite(at)) return null;
  const opensAt = finite(after.registrationOpensAt) ? after.registrationOpensAt : finite(after.createdAt) ? after.createdAt : null;
  const sameScope = !previous || previous.groupId === after.groupId && previous.startsAt === after.startsAt && previous.opensAt === opensAt;
  if (previous && !sameScope && at < previous.observedAt) return previous;
  const row: ManagerRoundMeasure = previous && sameScope ? {...previous,
    cancellations: Object.fromEntries(Object.entries(previous.cancellations).map(([id, value]) => [id, {...value}]))} : {
    schema: 1, groupId: after.groupId, gameId, startsAt: after.startsAt, opensAt,
    complete: !previous && !before && opensAt !== null && at <= opensAt,
    observedAt: at, firstFullAt: null, promotions: 0, waitlistAtStart: null, cancellations: {},
  };
  if (before && before.maxPlayers !== after.maxPlayers) row.complete = false;
  row.observedAt = Math.max(row.observedAt, at);
  const oldPlayers = new Set(ids(before?.players)), oldWaiting = new Set(ids(before?.waitlist));
  const players = ids(after.players), guests = (after.guests ?? []).filter(g => g && !g.waitlisted).length;
  if (finite(after.maxPlayers) && after.maxPlayers > 0 && players.length + guests >= after.maxPlayers && opensAt !== null) {
    const first = Math.max(at, opensAt);
    if (first <= after.startsAt) row.firstFullAt = row.firstFullAt === null ? first : Math.min(row.firstFullAt, first);
  }
  row.promotions += players.filter(id => !oldPlayers.has(id) && (oldWaiting.has(id) || before?.pendingPromotion?.uid === id)).length;
  if (at <= after.startsAt && (!row.waitlistAtStart || row.waitlistAtStart.at < at))
    row.waitlistAtStart = {at, count: ids(after.waitlist).length};
  for (const [id, cancelledAt] of Object.entries(after.cancellations ?? {})) {
    if (!finite(cancelledAt) || cancelledAt <= 0 || cancelledAt === before?.cancellations?.[id]) continue;
    const count = row.cancellations[id] ?? {total: 0, late: 0, unknownDeadline: 0};
    count.total++;
    if (!finite(after.cancelDeadlineHours) || after.cancelDeadlineHours < 0) count.unknownDeadline++;
    else if (cancelledAt > after.startsAt - after.cancelDeadlineHours * 3600000) count.late++;
    row.cancellations[id] = count;
  }
  return row;
}
