// Player-availability aggregation for the "מבט-על" heatmap. Reads ONLY users
// who marked themselves available (server-side filtered) — cost scales with the
// number of available players, NOT the whole users collection. No poll path.
import { queryEqualsBool } from './firestoreRest';

export const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const TIME_BUCKETS = [
  { key: 'morning', label: 'בוקר' },
  { key: 'noon', label: 'צהריים' },
  { key: 'evening', label: 'ערב' },
  { key: 'night', label: 'לילה' },
] as const;

const B_IDX: Record<string, number> = { morning: 0, noon: 1, evening: 2, night: 3 };
const ALL_TIMES = ['morning', 'noon', 'evening', 'night'];

export interface AvailPlayer {
  id: string;
  name: string;
  city: string;
  days: number[];
  times: string[]; // resolved (empty original → all four buckets)
  allDay: boolean; // true when the player set no specific time-of-day
}

export interface AvailabilityData {
  total: number; // available players counted (after the city filter)
  totalAll: number; // available players overall (ignoring filter)
  grid: number[][]; // [day 0..6][bucket 0..3] -> count
  dayTotal: number[]; // [day] -> count
  byCity: { city: string; count: number }[];
  noTime: number; // marked availability but no time-of-day (counted all-day)
  players: AvailPlayer[]; // the counted players — for the tap-a-cell drill-down
}

// Players in a given cell: available that day AND that time bucket. Pass
// bucketIdx = -1 for the day TOTAL (any time that day).
export function playersInCell(
  players: AvailPlayer[],
  day: number,
  bucketIdx: number,
): AvailPlayer[] {
  const bucketKey = ['morning', 'noon', 'evening', 'night'][bucketIdx];
  return players.filter(
    (p) =>
      p.days.includes(day) &&
      (bucketIdx < 0 || p.times.includes(bucketKey)),
  );
}

export async function fetchAvailability(cityFilter?: string): Promise<AvailabilityData> {
  const docs = await queryEqualsBool(
    'users',
    'availability.isAvailableForInvites',
    true,
    2000,
  );
  const grid = Array.from({ length: 7 }, () => [0, 0, 0, 0]);
  const dayTotal = new Array(7).fill(0);
  const cityCount = new Map<string, number>();
  const players: AvailPlayer[] = [];
  let total = 0;
  let totalAll = 0;
  let noTime = 0;
  for (const d of docs) {
    const av = (d as { availability?: Record<string, unknown> }).availability;
    if (!av || typeof av !== 'object') continue;
    const days: number[] = (
      Array.isArray(av.preferredDays) ? (av.preferredDays as number[]) : []
    ).filter((x) => x >= 0 && x <= 6);
    if (!days.length) continue; // only players who actually picked days
    const city = typeof av.homeCity === 'string' && av.homeCity ? av.homeCity : '—';
    cityCount.set(city, (cityCount.get(city) ?? 0) + 1);
    totalAll++;
    if (cityFilter && city !== cityFilter) continue;
    total++;
    const rawTimes = Array.isArray(av.preferredTimes)
      ? (av.preferredTimes as string[])
      : [];
    const times = rawTimes.length ? rawTimes : ALL_TIMES; // no time → all-day
    if (!rawTimes.length) noTime++;
    const name = typeof d.name === 'string' ? d.name : '—';
    players.push({ id: d.id, name, city, days, times, allDay: !rawTimes.length });
    for (const day of days) {
      dayTotal[day]++;
      for (const t of times) {
        const i = B_IDX[t];
        if (i !== undefined) grid[day][i]++;
      }
    }
  }
  const byCity = [...cityCount.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count);
  return { total, totalAll, grid, dayTotal, byCity, noTime, players };
}
