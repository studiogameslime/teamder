import type {ManagerHistoryRow} from '@/services/managerHistoryService';
import type {Game} from '@/types';
export function managerHistoryView(rows: ManagerHistoryRow[], games: Game[]) {
  const scope = new Map(games.map(g => [g.id, g]));
  const measured = rows.filter(r => r.complete && scope.get(r.gameId)?.groupId === r.groupId && scope.get(r.gameId)?.startsAt === r.startsAt);
  const filled = measured.filter(r => r.opensAt !== null && r.firstFullAt !== null && r.firstFullAt >= r.opensAt && r.firstFullAt <= r.startsAt);
  const durations = filled.map(r => r.firstFullAt! - r.opensAt!).sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  const medianMs = durations.length ? durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2 : null;
  const cancellations = new Map<string, {userId: string; total: number; late: number; unknownDeadline: number}>();
  for (const row of measured) for (const [userId, count] of Object.entries(row.cancellations)) {
    const current = cancellations.get(userId) ?? {userId, total: 0, late: 0, unknownDeadline: 0};
    current.total += count.total; current.late += count.late; current.unknownDeadline += count.unknownDeadline;
    cancellations.set(userId, current);
  }
  const counts = [...cancellations.values()].sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId));
  return {covered: measured.length, of: games.length, filled: filled.length, medianMs,
    promotions: measured.reduce((n, r) => n + r.promotions, 0),
    waitingCovered: measured.filter(r => r.waitlistAtStart !== null).length,
    waiting: measured.reduce((n, r) => n + (r.waitlistAtStart?.count ?? 0), 0),
    counts, total: counts.reduce((n, c) => n + c.total, 0), late: counts.reduce((n, c) => n + c.late, 0),
    unknownDeadline: counts.reduce((n, c) => n + c.unknownDeadline, 0)};
}
