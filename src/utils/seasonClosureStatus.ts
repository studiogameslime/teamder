export type SeasonClosureReason = 'active' | 'unverified' | 'unsealed';
export interface SeasonClosureStatus {
  seasonId: string;
  since: number;
  active: number;
  unverified: number;
  unsealed: number;
  rounds: { id: string; startsAt?: number; reason: SeasonClosureReason }[];
}

/** Keep the server diagnosis through the real document converter. Old or
 * malformed diagnoses must never describe a subsequently opened season. */
export function readSeasonClosureStatus(value: unknown, currentId: string): SeasonClosureStatus | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (v.seasonId !== currentId || typeof v.since !== 'number' || !Number.isFinite(v.since)) return;
  const count = (key: string) => typeof v[key] === 'number' && Number.isSafeInteger(v[key]) && (v[key] as number) >= 0;
  if (!['active', 'unverified', 'unsealed'].every(count)) return;
  return { seasonId: currentId, since: v.since, active: v.active as number,
    unverified: v.unverified as number, unsealed: v.unsealed as number,
    rounds: (Array.isArray(v.rounds) ? v.rounds : []).flatMap(row => {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id ||
        !['active', 'unverified', 'unsealed'].includes(row.reason)) return [];
      return [{ id: row.id, reason: row.reason as SeasonClosureReason,
        ...(typeof row.startsAt === 'number' && Number.isFinite(row.startsAt) && row.startsAt > 0 ? { startsAt: row.startsAt } : {}) }];
    }).slice(0, 8) };
}

/** Several blockers can coexist; never hide a server backlog behind a timer. */
export function seasonClosureMessages(status: SeasonClosureStatus | undefined): string[] {
  if (!status) return [];
  const lines: string[] = [];
  if (status.active) lines.push(`סגירת העונה ממתינה לסיום ${status.active === 1 ? 'מחזור פעיל' : `${status.active} מחזורים פעילים`}.`);
  if (status.unverified) lines.push(`${status.unverified === 1 ? 'מחזור אחד ממתין' : `${status.unverified} מחזורים ממתינים`} לאימות. מנהל המועדון צריך לאשר אם ${status.unverified === 1 ? 'התקיים' : 'התקיימו'}.`);
  if (status.unsealed) lines.push(`${status.unsealed === 1 ? 'סיכום מחזור אחד טרם הושלם' : `סיכומי ${status.unsealed} מחזורים טרם הושלמו`}. המערכת מנסה להשלים את העיבוד אוטומטית; אין צורך להזין מחדש תוצאות.`);
  return lines;
}
