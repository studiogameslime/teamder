import type { PlayerSearch, SocialPlayer } from '@/types/social';
import type { UserAvailability } from '@/types';

export function normalizePlayerSearch(value: string): string {
  return value.normalize('NFKC').replace(/[\u0591-\u05C7]/g, '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const TIMES: Record<string, string> = { morning: 'בוקר', noon: 'צהריים', evening: 'ערב' };
type Availability = Pick<UserAvailability, 'preferredDays' | 'preferredTimes' | 'availabilitySlots' | 'isAvailableForInvites'>;
/** Legacy empty times means any window, exactly as in the availability editor. */
export function playerAvailabilitySlots(a?: Availability): Record<number, string[]> {
  if (!a || a.isAvailableForInvites === false) return {};
  if (a.availabilitySlots) return Object.fromEntries(Object.entries(a.availabilitySlots)
    .filter(([day]) => /^[0-6]$/.test(day))
    .map(([day, times]) => [day, (times ?? []).filter(t => TIMES[t])]));
  const days = (a.preferredDays ?? []).filter(d => DAYS[d]);
  const times = (a.preferredTimes ?? []).filter(t => TIMES[t]);
  if (!days.length && !times.length) return {};
  return Object.fromEntries((days.length ? days : [0,1,2,3,4,5,6]).map(day => [day, times.length ? times : Object.keys(TIMES)]));
}
/** All-player search includes friends; friendsOnly narrows the same search. */
export function playerDiscoveryMatches(player: SocialPlayer, opts: PlayerSearch): boolean {
  return playerSearchMatches(player, opts);
}
export function playerAvailabilityLines(a?: Pick<UserAvailability, 'preferredDays' | 'preferredTimes' | 'availabilitySlots' | 'isAvailableForInvites'>): string[] {
  if (!a || a.isAvailableForInvites === false) return [];
  if (a.availabilitySlots) return Object.entries(a.availabilitySlots).flatMap(([day, slots]) => {
    const times = (slots ?? []).filter(t => TIMES[t]);
    return DAYS[Number(day)] && times.length ? [`${DAYS[Number(day)]} · ${times.map(t => TIMES[t]).join(', ')}`] : [];
  });
  return (a.preferredDays ?? []).filter(d => DAYS[d]).map(d => `${DAYS[d]}${a.preferredTimes?.length ? ' · ' + a.preferredTimes.map(t => TIMES[t]).filter(Boolean).join(', ') : ''}`);
}
export function playerSearchMatches(player: SocialPlayer, opts: PlayerSearch): boolean {
  if (opts.text && !normalizePlayerSearch(player.name).includes(normalizePlayerSearch(opts.text))) return false;
  if (opts.city && !normalizePlayerSearch(player.city).includes(normalizePlayerSearch(opts.city))) return false;
  if (opts.friendsOnly && !player.friend) return false;
  if (opts.days?.length || opts.times?.length) {
    const { days, times, ...single } = opts;
    // OR within each category, AND between categories; test a real slot,
    // never combine a morning on one day with an evening on another.
    return (days?.length ? days : [opts.day]).some(day =>
      (times?.length ? times : [opts.time]).some(time => playerSearchMatches(player, { ...single, day, time })));
  }
  if (opts.day !== undefined) {
    const a = player.availability;
    if (!a || a.isAvailableForInvites === false) return false;
    const slots = a.availabilitySlots;
    const times = slots ? slots[opts.day as 0] : a.preferredDays?.includes(opts.day as 0) ? a.preferredTimes : undefined;
    if (slots ? !times?.length : !a.preferredDays?.includes(opts.day as 0)) return false;
    if (opts.time && !times?.includes(opts.time as 'evening')) return false;
  }
  if (opts.day === undefined && opts.time) {
    const a = player.availability;
    if (!a || a.isAvailableForInvites === false) return false;
    const times = a.availabilitySlots ? Object.values(a.availabilitySlots).flat() : a.preferredDays?.length ? a.preferredTimes : [];
    if (!times?.includes(opts.time as 'evening')) return false;
  }
  return true;
}
