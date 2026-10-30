import type { CommunityPlayerEvent, Game, Group } from '@/types';
import { activeGuestCount } from '@/types';
import { cardState } from './cardState';
import { clubHistory, managerClubInsights } from './managerClubInsights';
import { managerOverview, memberIds, registered, registrationState } from './managerDashboard';

/** All registration measures use the saved roster, never inferred attendance. */
export function managerRoster(group: Group, games: Game[], now: number) {
  const ids = memberIds(group), members = new Set(ids);
  const history = clubHistory(group, games, now), recent = history.slice(0, 10);
  const overview = managerOverview(group, games, now);
  const active = ids.filter(id => recent.some(g => registered(g, id)));
  let registrations = 0, capacity = 0, memberRegistrations = 0, outsideRegistrations = 0, capacityCovered = 0;
  for (const g of recent) {
    const accounts = [...new Set(g.players)].filter(id => registered(g, id));
    const count = accounts.length + activeGuestCount(g.guests ?? []);
    registrations += count;
    memberRegistrations += accounts.filter(id => members.has(id)).length;
    outsideRegistrations += accounts.filter(id => !members.has(id)).length + activeGuestCount(g.guests ?? []);
    if (Number.isFinite(g.maxPlayers) && g.maxPlayers > 0) { capacity += g.maxPlayers; capacityCovered++; }
  }
  // Missing capacities cannot turn into a deceptively high percentage.
  const occupancyPercent = recent.length > 0 && capacityCovered === recent.length && capacity > 0
    ? Math.round(registrations / capacity * 100) : null;
  const upcoming = games.filter(g => g.groupId === group.id && g.startsAt > now && ['open', 'scheduled', 'locked'].includes(g.status))
    .sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id))[0];
  const roster = [...new Set(upcoming?.players ?? [])].filter(id => upcoming && registered(upcoming, id));
  const guests = activeGuestCount(upcoming?.guests ?? []);
  const nextMembers = roster.filter(id => members.has(id)).length;
  const total = roster.length + guests;
  const missing = upcoming ? overview.members.filter(m => m.regular && registrationState(upcoming, m.userId) !== 'registered') : [];
  const gear = (['ball', 'jerseys'] as const).flatMap(kind => {
    const holders = [...new Set((kind === 'ball' ? group.ballHolderIds : group.jerseysHolderIds) ?? [])];
    return holders.map(userId => ({kind, userId, state: upcoming ? registrationState(upcoming, userId) : null}));
  });
  return { ids, history, recent, active, inactive: ids.filter(id => !active.includes(id)), overview,
    registrations, capacity, capacityCovered, occupancyPercent, memberRegistrations, outsideRegistrations,
    upcoming, nextMembers, external: roster.length - nextMembers, guests, total,
    vacancies: upcoming && upcoming.maxPlayers > 0 ? Math.max(0, upcoming.maxPlayers - total) : null,
    missing, gear, missingGear: gear.filter(g => g.state !== null && g.state !== 'registered') };
}

export function managerNewcomers(group: Group, games: Game[], now: number) {
  const history = clubHistory(group, games, now);
  const rows = managerClubInsights(group, games, now).newcomers.map(row => ({...row,
    opportunities: history.filter(g => g.startsAt >= row.joinedAt).length}));
  return {rows, first: rows.filter(r => r.completed > 0).length, repeat: rows.filter(r => r.completed >= 2).length,
    waiting: rows.filter(r => !r.completed && !r.next)};
}

/** Cohorts share eight eligible rounds, not eight elapsed calendar weeks. */
export function managerRetention(group: Group, games: Game[], now: number, truncated = false) {
  const history = clubHistory(group, games, now).reverse();
  const cohorts = new Map<string, {month: string; members: number; mature: number; first: number; continued: number}>();
  let unknown = 0;
  for (const id of memberIds(group)) {
    const joined = group.joinedAt?.[id];
    if (typeof joined !== 'number' || !Number.isFinite(joined) || joined <= 0 || joined > now) { unknown++; continue; }
    const d = new Date(joined), month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const row = cohorts.get(month) ?? {month, members: 0, mature: 0, first: 0, continued: 0};
    row.members++;
    // A cut-off older than the join date means the first opportunities were lost.
    const complete = !truncated || !history.length || joined >= history[0].startsAt;
    const eligible = history.filter(g => g.startsAt >= joined);
    if (complete && eligible.length >= 8) {
      row.mature++;
      const first = eligible.slice(0, 4).some(g => registered(g, id));
      if (first) row.first++;
      if (first && eligible.slice(4, 8).some(g => registered(g, id))) row.continued++;
    }
    cohorts.set(month, row);
  }
  return {rows: [...cohorts.values()].sort((a, b) => b.month.localeCompare(a.month)), unknown};
}

export function managerPlayerHistory(group: Group, games: Game[], userId: string, now: number) {
  const joined = group.joinedAt?.[userId];
  const history = clubHistory(group, games, now);
  const firstKnown = history.filter(g => registered(g, userId) || typeof g.cancellations?.[userId] === 'number')
    .reduce((at, g) => Math.min(at, g.startsAt), Infinity);
  const start = typeof joined === 'number' && Number.isFinite(joined) && joined > 0 ? joined : firstKnown;
  return history.filter(g => g.startsAt >= start).slice(0, 5).reverse()
    .map(game => ({game, state: registrationState(game, userId)}));
}

export function managerActiveCards(group: Group, events: CommunityPlayerEvent[], now: number) {
  const members = new Set(memberIds(group));
  return group.cardsEnabled ? [...new Map(events.map(e => [e.id, e])).values()].filter(e =>
    e.groupId === group.id && members.has(e.userId) && ['yellow', 'red'].includes(e.type) &&
    e.at <= now && cardState(e, e.type === 'red' ? group.redCardValidityDays : group.yellowCardValidityDays, now) === 'active')
    .sort((a, b) => a.type.localeCompare(b.type) || b.at - a.at) : [];
}

export function managerArrivals(group: Group, games: Game[], now: number) {
  const game = clubHistory(group, games, now)[0];
  const counts = {arrived: 0, late: 0, no_show: 0, unknown: 0};
  if (!game) return {game, counts, total: 0, covered: 0};
  const ids = [...new Set(game.players)].filter(id => registered(game, id));
  ids.forEach(id => { const state = game.arrivals?.[id]; counts[state && state in counts ? state : 'unknown']++; });
  return {game, counts, total: ids.length, covered: ids.length - counts.unknown};
}

/** A return is the more recent registration signal. Do not list the same
 * member as both a return and an unresolved absence in one attention list. */
export function uniqueManagerAttention<T extends {userId: string}>(absent: T[], returned: {userId: string}[]): T[] {
  const returnedIds = new Set(returned.map(row => row.userId));
  return absent.filter(row => !returnedIds.has(row.userId));
}

/** A stored manager rating exists independently of any saved evening score. */
export function managerPlayerRating(group: Group, userId: string): number | null {
  const value = group.adminRatings?.[userId];
  return group.internalRating && typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 5 ? value : null;
}
