// Approximate daylight windows for Israel, in local minutes, by month.
// This is a seasonal visual heuristic, not a sunset forecast.
const DAYLIGHT_WINDOWS = [
  [390, 1035], [375, 1050], [375, 1080], [375, 1155], [345, 1185], [330, 1200],
  [345, 1200], [360, 1185], [375, 1125], [390, 1080], [375, 1005], [390, 1005],
] as const;
const israelClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', month: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
});

/** Scheduled date in Israel; never the viewer's timezone or current time. */
export function roundCoverPeriod(startsAt?: number): 'day' | 'night' {
  if (typeof startsAt !== 'number' || !Number.isFinite(startsAt) || startsAt <= 0 || !Number.isFinite(new Date(startsAt).getTime())) return 'day';
  const parts = israelClock.formatToParts(new Date(startsAt));
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  const month = value('month'), minutes = value('hour') * 60 + value('minute');
  const window = DAYLIGHT_WINDOWS[month - 1];
  if (!window || !Number.isFinite(minutes)) return 'day';
  return minutes >= window[0] && minutes < window[1] ? 'day' : 'night';
}
