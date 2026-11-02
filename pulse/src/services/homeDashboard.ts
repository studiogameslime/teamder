import { cached, invalidate } from './cache';
import { createDocOnly, getDoc, patchDoc, queryDocumentPage, type DocumentPageCursor, type FsDoc } from './firestoreRest';
import { isTestAccount } from './firebase';
import { ids, isClubGroup, millis, text } from './growthInsights';
import { observeSettledErrors } from './errorObservation';

const HOUR = 60 * 60 * 1000;
const TTL = 60_000;
const CONTACT_KIND = 'pulseClubContact';
// Owner-selected baseline: only clubs created from 1 Nov 2026, Israel midnight.
// Fixed rather than rolling: tomorrow must not erase today's pending outreach.
export const HOME_CLUBS_SINCE = Date.parse('2026-10-31T22:00:00Z');
const GROUP_FIELDS = ['name', 'city', 'createdAt', 'creatorId', 'adminIds', 'playerIds', 'pendingPlayerIds', 'isPersonal'];
const USER_FIELDS = ['name', 'email', 'qa', 'createdAt', 'lastSeenAt'];
const CONTACT_FIELDS = ['kind', 'groupId', 'organizerId', 'contactedAt', 'lastFollowUpAt'];

export interface ClubContact { organizerId: string; contactedAt: number | null; lastFollowUpAt?: number | null }
export interface HomeClub {
  id: string; name: string; city: string; createdAt: number; members: number;
  organizerId: string | null; contactedAt: number | null;
  lastFollowUpAt?: number | null;
}
export interface HomeRounds { withRegistrations: number; registered: number; at: number }
export interface HomePeople { count: number; at: number }
export interface HomeClubs { rows: HomeClub[]; at: number }
export interface HomeDashboard {
  rounds: HomeRounds | null; signups: HomePeople | null; people: HomePeople | null;
  clubs: HomeClubs | null; failed: string[]; at: number;
}

/** All pages are read. A 100-row window must never be presented as a total. */
export async function readHomePages(collection: string, orderField: string, fields: readonly string[], where?: unknown, direction: 'ASCENDING' | 'DESCENDING' = 'DESCENDING'): Promise<FsDoc[]> {
  const rows: FsDoc[] = [];
  const seen = new Set<string>();
  let cursor: DocumentPageCursor | undefined;
  do {
    const page = await queryDocumentPage(collection, { orderField, direction, fields, where, cursor, limit: 100 });
    rows.push(...page.rows);
    cursor = page.next;
    if (cursor) {
      const key = JSON.stringify(cursor);
      if (seen.has(key)) throw new Error('PULSE_HOME_PAGINATION_LOOP');
      seen.add(key);
    }
  } while (cursor);
  return rows;
}

export function fetchHomeGroups(force = false): Promise<FsDoc[]> {
  return cached('home-groups-v2', () => readHomePages('groups', '__name__', GROUP_FIELDS, undefined, 'ASCENDING'), { force, ttl: TTL });
}

export function fetchHomeRoundWindow(now: number, force = false): Promise<FsDoc[]> {
  return cached('home-round-window-v2', () => readHomePages('games', 'startsAt',
    ['title', 'groupId', 'status', 'startsAt', 'players', 'maxPlayers', 'guests', 'pendingPromotion'], {
      fieldFilter: { field: { fieldPath: 'startsAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(now - 8 * HOUR) } },
    }), { force, ttl: TTL });
}

function range(field: string, from: number, to: number) {
  return { compositeFilter: { op: 'AND', filters: [
    { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(from) } } },
    { fieldFilter: { field: { fieldPath: field }, op: 'LESS_THAN_OR_EQUAL', value: { integerValue: String(to) } } },
  ] } };
}

export function homeDayStart(now: number): number {
  // The dashboard day is Israel's calendar day, even on a device abroad.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => Number(parts.find(p => p.type === name)?.value);
  const utcMidnight = Date.UTC(part('year'), part('month') - 1, part('day'));
  // Israel's offset at local midnight is obtained before that day's DST change.
  const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(utcMidnight - 6 * HOUR));
  return utcMidnight - ((localHour + 6) % 24) * HOUR;
}

export function homeRoundTotals(rows: FsDoc[], now: number): HomeRounds {
  // Same current/upcoming scope as GamesScreen, including future registrations.
  // A round and the registrations within it are different units.
  const rounds = rows.filter(g => g.status !== 'finished' && g.status !== 'cancelled'
    && millis(g.startsAt) >= now - 8 * HOUR && ids(g.players).length > 0);
  return { withRegistrations: rounds.length, registered: rounds.reduce((sum, g) => sum + new Set(ids(g.players)).size, 0), at: now };
}

export function homePeopleCount(rows: FsDoc[], field: 'createdAt' | 'lastSeenAt', now: number): HomePeople {
  const start = homeDayStart(now);
  return { count: new Set(rows.filter(u => !isTestAccount(u.email, u.name) && u.qa !== true && u.name !== 'משתמש שהוסר' && millis(u[field]) >= start && millis(u[field]) <= now).map(u => u.id)).size, at: now };
}

export function clubOrganizer(group: FsDoc): string | null {
  const admins = ids(group.adminIds);
  const creator = text(group.creatorId);
  return creator && (!admins.length || admins.includes(creator)) ? creator : admins[0] ?? null;
}

export function homeClubRows(groups: FsDoc[], contacts: FsDoc[], now: number): HomeClubs {
  const saved = new Map(contacts.filter(c => c.kind === CONTACT_KIND).map(c => [c.groupId, c]));
  const rows = groups.filter(g => isClubGroup(g) && millis(g.createdAt) >= HOME_CLUBS_SINCE && millis(g.createdAt) <= now).map(g => {
    const organizerId = clubOrganizer(g);
    const contact = saved.get(g.id);
    return { id: g.id, name: text(g.name, 'מועדון ללא שם'), city: text(g.city), createdAt: millis(g.createdAt),
      members: new Set([...ids(g.playerIds), ...ids(g.adminIds)]).size, organizerId,
      contactedAt: organizerId && contact?.organizerId === organizerId && millis(contact.contactedAt) <= now ? millis(contact.contactedAt) || null : null,
      lastFollowUpAt: organizerId && contact?.organizerId === organizerId && millis(contact.lastFollowUpAt) <= now ? millis(contact.lastFollowUpAt) || null : null };
  }).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  return { rows, at: now };
}

export async function fetchHomeDashboard(force = false): Promise<HomeDashboard> {
  const now = Date.now();
  const start = homeDayStart(now);
  const people = (field: 'createdAt' | 'lastSeenAt') => cached(`home-${field}:${start}`, async () =>
    homePeopleCount(await readHomePages('users', field, USER_FIELDS, range(field, start, now)), field, now), { force, ttl: TTL });
  const jobs = [
    cached('home-registration-rounds', async () => homeRoundTotals(await fetchHomeRoundWindow(now, force), now), { force, ttl: TTL }),
    people('createdAt'),
    people('lastSeenAt'),
    cached('home-clubs', async () => {
      const [groups, contacts] = await Promise.all([
        fetchHomeGroups(force),
        readHomePages('adminConfig', '__name__', CONTACT_FIELDS, { fieldFilter: { field: { fieldPath: 'kind' }, op: 'EQUAL', value: { stringValue: CONTACT_KIND } } }),
      ]);
      return homeClubRows(groups, contacts, now);
    }, { force, ttl: TTL }),
  ];
  const results = await Promise.allSettled(jobs).then(results => observeSettledErrors(results, {
    source: 'pulse/src/services/homeDashboard.ts', handler: 'fetchHomeDashboard', site: 'home:sources',
  }));
  const data: HomeDashboard = { rounds: null, signups: null, people: null, clubs: null, failed: [], at: now };
  const keys = ['rounds', 'signups', 'people', 'clubs'] as const;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') Object.assign(data, { [keys[index]]: result.value });
    else {
      data.failed.push(keys[index]);
    }
  });
  return data;
}

const contactPath = (id: string) => {
  if (!id || id.includes('/')) throw new Error('PULSE_HOME_INVALID_GROUP');
  return `adminConfig/pulseClubContact_${id}`;
};

/** A manual acknowledgement, never a message send. Verify the current organizer and the saved value. */
export async function setClubContact(club: HomeClub, contacted: boolean): Promise<ClubContact> {
  const group = await getDoc(`groups/${club.id}`, GROUP_FIELDS);
  if (!group || !isClubGroup(group) || millis(group.createdAt) < HOME_CLUBS_SINCE || !club.organizerId || clubOrganizer(group) !== club.organizerId) throw new Error('PULSE_HOME_ORGANIZER_CHANGED');
  const path = contactPath(group.id);
  const fields = { kind: CONTACT_KIND, groupId: group.id, organizerId: club.organizerId, contactedAt: contacted ? Date.now() : null, lastFollowUpAt: null, updatedAt: Date.now() };
  // Existing-only patches prevent a mistyped id from silently creating a document.
  const created = await createDocOnly(path, fields);
  if (created === 'error' || created === 'conflict' && !await patchDoc(path, fields, { mustExist: true })) throw new Error('PULSE_HOME_CONTACT_WRITE');
  invalidate('home-clubs');
  const saved = await getDoc(path, CONTACT_FIELDS);
  if (!saved || saved.groupId !== group.id || saved.kind !== CONTACT_KIND || saved.organizerId !== fields.organizerId || saved.contactedAt !== fields.contactedAt || saved.lastFollowUpAt !== fields.lastFollowUpAt) throw new Error('PULSE_HOME_CONTACT_VERIFY');
  return { organizerId: fields.organizerId, contactedAt: fields.contactedAt, lastFollowUpAt: null };
}

export async function setClubFollowUp(club: HomeClub): Promise<ClubContact> {
  const group = await getDoc(`groups/${club.id}`, GROUP_FIELDS);
  if (!group || !isClubGroup(group) || millis(group.createdAt) < HOME_CLUBS_SINCE || !club.organizerId || clubOrganizer(group) !== club.organizerId) throw new Error('PULSE_HOME_ORGANIZER_CHANGED');
  const path = contactPath(group.id);
  const before = await getDoc(path, CONTACT_FIELDS);
  if (!before || before.kind !== CONTACT_KIND || before.groupId !== group.id || before.organizerId !== club.organizerId || !millis(before.contactedAt) || before.contactedAt > Date.now()) throw new Error('PULSE_HOME_NO_CONTACT');
  const at = Date.now();
  const ok = await patchDoc(path, { lastFollowUpAt: at, updatedAt: at }, { mustExist: true });
  invalidate('home-clubs');
  if (!ok) throw new Error('PULSE_HOME_FOLLOW_UP_WRITE');
  const saved = await getDoc(path, CONTACT_FIELDS);
  if (!saved || saved.kind !== CONTACT_KIND || saved.groupId !== group.id || saved.organizerId !== club.organizerId || saved.contactedAt !== before.contactedAt || saved.lastFollowUpAt !== at) throw new Error('PULSE_HOME_FOLLOW_UP_VERIFY');
  return { organizerId: club.organizerId, contactedAt: saved.contactedAt, lastFollowUpAt: at };
}
