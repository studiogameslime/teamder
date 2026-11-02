import { cached } from './cache';
import { queryDocumentPage, queryCollectionRecent, type FsDoc } from './firestoreRest';
import { fetchHomeGroups, fetchHomeRoundWindow, readHomePages, homeClubRows, type HomeClub } from './homeDashboard';
import { ids, isClubGroup, millis, text } from './growthInsights';
import { TEAMDER_UID, convIdFor, isSupportResolved } from './teamderChatService';
import { observeSettledErrors } from './errorObservation';

export const HOME_ACTION_DAY = 86400000;
export const FOLLOW_UP_DAYS = 3;
export const SHORTAGE_DAYS = 3;
export interface ShortageRound { id: string; title: string; startsAt: number; registered: number; guests: number; reserved: number; capacity: number; remaining: number }
export interface PendingClubRequest { groupId: string; groupName: string; userId: string }
export interface SupportWaiting { userId: string; messageId: string; lastMessageAt: number; preview: string }
export interface HomeActions {
  solo: HomeClub[] | null; soloUnknown: number; noFirstRound: HomeClub[] | null; firstRoundUnknown: number;
  shortages: ShortageRound[] | null; shortageUnknown: number;
  requests: PendingClubRequest[] | null; support: SupportWaiting[] | null;
  failed: string[]; at: number;
}

export function homeFollowUps(clubs: HomeClub[], now: number): HomeClub[] {
  return clubs.filter(c => c.organizerId && c.contactedAt && Math.max(c.contactedAt, c.lastFollowUpAt ?? 0) <= now - FOLLOW_UP_DAYS * HOME_ACTION_DAY)
    .sort((a, b) => Math.max(a.contactedAt!, a.lastFollowUpAt ?? 0) - Math.max(b.contactedAt!, b.lastFollowUpAt ?? 0));
}

export function soloOrganizerClubs(groups: FsDoc[], now: number): HomeClub[] {
  const byId = new Map(groups.map(g => [g.id, g]));
  return homeClubRows(groups, [], now).rows.filter(c => {
    const g = byId.get(c.id)!;
    const members = [...new Set([...ids(g.playerIds), ...ids(g.adminIds)])];
    return Array.isArray(g.playerIds) && Array.isArray(g.adminIds) && c.organizerId && members.length === 1 && members[0] === c.organizerId;
  });
}

export function pendingClubRequests(groups: FsDoc[]): PendingClubRequest[] {
  return groups.filter(isClubGroup).flatMap(g => {
    const members = new Set([...ids(g.playerIds), ...ids(g.adminIds)]);
    return [...new Set(ids(g.pendingPlayerIds))].filter(id => !members.has(id)).map(userId => ({ groupId: g.id, groupName: text(g.name, 'מועדון ללא שם'), userId }));
  });
}

export function shortageRounds(games: FsDoc[], now: number): { rows: ShortageRound[]; unknown: number } {
  const rows: ShortageRound[] = []; let unknown = 0;
  for (const g of games) {
    if (g.status === 'finished' || g.status === 'cancelled' || millis(g.startsAt) < now || millis(g.startsAt) > now + SHORTAGE_DAYS * HOME_ACTION_DAY) continue;
    if (!Number.isInteger(g.maxPlayers) || g.maxPlayers <= 0 || !Array.isArray(g.players) || g.guests != null && (!Array.isArray(g.guests) || g.guests.some((guest: unknown) => !guest || typeof guest !== 'object'))) { unknown++; continue; }
    const registered = new Set(ids(g.players)).size;
    // Same occupancy rule as Teamder: waitlisted guests do not occupy a slot.
    const guests = (g.guests ?? []).filter((guest: { waitlisted?: boolean }) => !guest.waitlisted).length;
    const reserved = typeof g.pendingPromotion?.uid === 'string' && g.pendingPromotion.uid ? 1 : 0;
    const remaining = Math.max(0, g.maxPlayers - registered - guests - reserved);
    if (remaining) rows.push({ id: g.id, title: text(g.title, 'מחזור ללא שם'), startsAt: millis(g.startsAt), registered, guests, reserved, capacity: g.maxPlayers, remaining });
  }
  return { rows: rows.sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id)), unknown };
}

export function supportWaitingRow(conversation: FsDoc, last: FsDoc | undefined): SupportWaiting | null {
  const participants = ids(conversation.participants);
  const userId = participants.find(id => id !== TEAMDER_UID);
  if (participants.length !== 2 || !participants.includes(TEAMDER_UID) || !userId || /[\/\s]/.test(userId) || userId.includes('__') || conversation.id !== convIdFor(userId) || !last) return null;
  if (!text(last.id) || !millis(last.createdAt) || !participants.includes(last.senderId)) throw new Error('PULSE_HOME_INVALID_SUPPORT_MESSAGE');
  if (last.senderId === TEAMDER_UID || isSupportResolved(conversation, last.id, last.createdAt)) return null;
  return { userId, messageId: last.id, lastMessageAt: last.createdAt, preview: text(last.text).slice(0, 140) };
}

async function firstRoundChecks(clubs: HomeClub[]): Promise<{ rows: HomeClub[]; unknown: number }> {
  const rows: HomeClub[] = []; let unknown = 0;
  for (let offset = 0; offset < clubs.length; offset += 4) {
    const batch = clubs.slice(offset, offset + 4);
    const results = await Promise.allSettled(batch.map(c => queryDocumentPage('games', { orderField: '__name__', direction: 'ASCENDING', limit: 1, fields: ['groupId'], where: { fieldFilter: { field: { fieldPath: 'groupId' }, op: 'EQUAL', value: { stringValue: c.id } } } })))
      .then(results => observeSettledErrors(results, { source: 'pulse/src/services/homeActions.ts', handler: 'firstRoundChecks', site: 'homeActions:first-round' }));
    results.forEach((result, index) => { if (result.status === 'fulfilled') { if (!result.value.rows.length) rows.push(batch[index]); } else unknown++; });
  }
  return { rows, unknown };
}

async function readSupport(): Promise<SupportWaiting[]> {
  const conversations = await readHomePages('dmConversations', '__name__', ['participants', 'supportLastMessageId', 'supportLastSenderId', 'supportLastMessageAt', 'supportLastText', 'supportResolvedMessageId', 'supportResolvedMessageAt'],
    { fieldFilter: { field: { fieldPath: 'participants' }, op: 'ARRAY_CONTAINS', value: { stringValue: TEAMDER_UID } } });
  const rows: SupportWaiting[] = [];
  for (let offset = 0; offset < conversations.length; offset += 4) {
    await Promise.all(conversations.slice(offset, offset + 4).map(async c => {
      const participants = ids(c.participants);
      const userId = participants.find(id => id !== TEAMDER_UID);
      if (participants.length !== 2 || !participants.includes(TEAMDER_UID) || !userId || /[\/\s]/.test(userId) || userId.includes('__') || c.id !== convIdFor(userId)) return;
      const last = text(c.supportLastMessageId) && text(c.supportLastSenderId) && millis(c.supportLastMessageAt)
        ? { id: c.supportLastMessageId, senderId: c.supportLastSenderId, createdAt: c.supportLastMessageAt, text: c.supportLastText }
        : (await queryCollectionRecent(`dmConversations/${c.id}/messages`, 1, ['senderId', 'createdAt', 'text']))[0];
      const row = supportWaitingRow(c, last); if (row) rows.push(row);
    }));
  }
  return rows.sort((a, b) => a.lastMessageAt - b.lastMessageAt || a.userId.localeCompare(b.userId));
}

export async function fetchHomeActions(force = false): Promise<HomeActions> {
  const now = Date.now();
  const groups = fetchHomeGroups(force);
  const jobs = [
    groups.then(rows => ({ rows: soloOrganizerClubs(rows, now), unknown: homeClubRows(rows, [], now).rows.filter(c => { const g = rows.find(g => g.id === c.id)!; return !Array.isArray(g.playerIds) || !Array.isArray(g.adminIds); }).length })),
    groups.then(rows => cached('home-first-round-checks', () => firstRoundChecks(homeClubRows(rows, [], now).rows), { force, ttl: 60000 })),
    fetchHomeRoundWindow(now, force).then(rows => shortageRounds(rows, now)),
    groups.then(pendingClubRequests),
    cached('home-support-waiting', readSupport, { force, ttl: 60000 }),
  ];
  const results = await Promise.allSettled(jobs).then(results => observeSettledErrors(results, { source: 'pulse/src/services/homeActions.ts', handler: 'fetchHomeActions', site: 'homeActions:sources' }));
  const data: HomeActions = { solo: null, soloUnknown: 0, noFirstRound: null, firstRoundUnknown: 0, shortages: null, shortageUnknown: 0, requests: null, support: null, failed: [], at: now };
  const keys = ['solo', 'noFirstRound', 'shortages', 'requests', 'support'] as const;
  results.forEach((result, index) => {
    if (result.status === 'rejected') { data.failed.push(keys[index]); return; }
    if (index === 0) { const v = result.value as { rows: HomeClub[]; unknown: number }; data.solo = v.rows; data.soloUnknown = v.unknown; }
    else if (index === 1) { const v = result.value as { rows: HomeClub[]; unknown: number }; data.noFirstRound = v.rows; data.firstRoundUnknown = v.unknown; }
    else if (index === 2) { const v = result.value as { rows: ShortageRound[]; unknown: number }; data.shortages = v.rows; data.shortageUnknown = v.unknown; }
    else Object.assign(data, { [keys[index]]: result.value });
  });
  return data;
}
