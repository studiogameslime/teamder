import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { ENFORCE_APP_CHECK } from './appCheckPolicy';
import { onCall, type CallableRequest } from './observedFunctions';
import { ExpectedCallableError as HttpsError } from './expectedCallableError';
import { observeCaughtError } from './serverErrorLog';

type Data = Record<string, any>;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
const text = (value: unknown, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128 || /[\/\x00-\x1f]/.test(value)) throw new HttpsError('invalid-argument', 'Invalid id');
  return value;
}
function owner(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Full account required');
  if (request.data?.expectedUid !== uid) throw new HttpsError('failed-precondition', 'Account changed');
  return uid;
}
function dayKey(at: number) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const value = (kind: string) => parts.find(p => p.type === kind)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
/** 30 Jerusalem calendar days, including today. UTC arithmetic avoids DST-length days. */
export function comparisonWindow(now: number) {
  const today = dayKey(now);
  const since = new Date(Date.parse(today + 'T12:00:00Z') - 29 * 86400000).toISOString().slice(0, 10);
  return { today, since };
}
export function comparisonCount(data: Data, range: 'month' | 'all', now: number) {
  if (range === 'all') return count(data.total);
  const { today, since } = comparisonWindow(now);
  return Object.entries(data.days ?? {}).reduce((sum, [day, value]) => sum + (day >= since && day <= today ? count(value) : 0), 0);
}

/** Immutable visit receipt + one summary per viewer. Client writes are not used. */
export const recordPlayerComparison = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const uid = owner(request), targetId = id(request.data?.targetId), groupId = id(request.data?.groupId);
  if (targetId === uid) throw new HttpsError('invalid-argument', 'Self comparison');
  const visitId = request.data?.visitId;
  if (typeof visitId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(visitId)) throw new HttpsError('invalid-argument', 'Invalid visit');
  const scope = request.data?.scope;
  if (!scope || !['current', 'all', 'season'].includes(scope.k)) throw new HttpsError('invalid-argument', 'Invalid scope');
  const seasonId = scope.k === 'season' ? id(scope.id) : undefined;
  const db = getFirestore();
  const root = `playerComparisonActivity/${targetId}`;
  const receipt = db.doc(`${root}/visits/${createHash('sha256').update(`${uid}:${visitId}`).digest('hex')}`);
  const summary = db.doc(`${root}/viewers/${uid}`);
  const rate = db.doc(`serverRateLimits/${uid}_comparisonVisits`);
  return db.runTransaction(async tx => {
    const refs = [db.doc(`users/${uid}`), db.doc(`users/${targetId}`), db.doc(`groups/${groupId}`),
      db.doc(`users/${uid}/blocked/${targetId}`), db.doc(`users/${targetId}/blocked/${uid}`), receipt, summary, rate];
    if (seasonId) refs.push(db.doc(`seasonSummary/${groupId}__${seasonId}`));
    const [viewerDoc, targetDoc, groupDoc, blockedA, blockedB, receiptDoc, summaryDoc, rateDoc, seasonDoc] = await tx.getAll(...refs);
    const now = Date.now();
    const viewer = viewerDoc.data(), target = targetDoc.data(), group = groupDoc.data();
    if (!viewer || viewer.isGuest || !target || target.isGuest) throw new HttpsError('permission-denied', 'Full players required');
    // Comparison tables already require club membership. No global-profile
    // privacy override is introduced, and no existing permission is changed.
    const members = [...strings(group?.playerIds), ...strings(group?.adminIds)];
    if (!group || group.isPersonal || group.deletedAt || !members.includes(uid) || !members.includes(targetId) || blockedA.exists || blockedB.exists) {
      throw new HttpsError('permission-denied', 'Comparison unavailable');
    }
    if (seasonId && (!seasonDoc?.exists || seasonDoc.data()?.groupId !== groupId)) throw new HttpsError('invalid-argument', 'Season unavailable');
    if (receiptDoc.exists) return { recorded: false };
    const previousRate = rateDoc.data() ?? {}, sameMinute = now - count(previousRate.start) < 60000;
    const requests = sameMinute ? count(previousRate.count) : 0;
    if (requests >= 30) throw new HttpsError('resource-exhausted', 'Please wait');
    const previous = summaryDoc.data() ?? {};
    // A transaction retry or small cross-instance clock skew must not replace
    // newer context, nor drop its day bucket around Jerusalem midnight.
    const latestAt = Math.max(now, count(previous.lastAt));
    const newest = now >= count(previous.lastAt);
    const { today: latestDay, since } = comparisonWindow(latestAt);
    const today = dayKey(now);
    const days: Record<string, number> = {};
    for (const [day, value] of Object.entries(previous.days ?? {})) if (day >= since && day <= latestDay) days[day] = count(value);
    if (today >= since) days[today] = (days[today] ?? 0) + 1;
    const season = seasonDoc?.data();
    const scopeLabel = scope.k === 'all' ? 'כל הזמנים' : scope.k === 'season'
      ? season?.nonSeason ? 'תקופה ללא עונה' : `עונה ${count(season?.no ?? season?.seasonNo) || 'קודמת'}`
      : group.seasons?.enabled === false ? 'ללא עונה פעילה' : 'העונה הנוכחית';
    tx.create(receipt, { viewerId: uid, groupId, at: now, scope: scope.k, ...(seasonId ? { seasonId } : {}) });
    tx.set(summary, { total: count(previous.total) + 1, days, lastAt: latestAt,
      lastGroupId: newest ? groupId : text(previous.lastGroupId, 128), lastGroupName: newest ? text(group.name) : text(previous.lastGroupName), lastScope: newest ? scopeLabel : text(previous.lastScope) });
    tx.set(rate, { start: sameMinute ? previousRate.start : now, count: requests + 1 });
    return { recorded: true };
  });
});

/** Only the token owner can read their list; contact details never leave here. */
export const getMyComparisonActivity = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const uid = owner(request), db = getFirestore();
  if (request.data?.userId !== undefined && request.data.userId !== uid) throw new HttpsError('permission-denied', 'Owner only');
  const range = request.data?.range;
  if (range !== 'month' && range !== 'all') throw new HttpsError('invalid-argument', 'Invalid range');
  await db.runTransaction(async tx => {
    const rate = db.doc(`serverRateLimits/${uid}_comparisonList`);
    const [me, previous] = await tx.getAll(db.doc(`users/${uid}`), rate);
    if (!me.exists || me.data()?.isGuest) throw new HttpsError('permission-denied', 'Full account required');
    const value = previous.data() ?? {}, now = Date.now(), sameMinute = now - count(value.start) < 60000;
    const used = sameMinute ? count(value.count) : 0;
    if (used >= 60) throw new HttpsError('resource-exhausted', 'Please wait');
    tx.set(rate, { start: sameMinute ? value.start : now, count: used + 1 });
  });
  let cursor: { at: number; uid: string } | undefined;
  if (request.data?.cursor !== undefined && request.data.cursor !== null) {
    try {
      if (typeof request.data.cursor !== 'string' || request.data.cursor.length > 500) throw new Error('cursor');
      const value = JSON.parse(Buffer.from(request.data.cursor, 'base64url').toString('utf8'));
      if (value.owner !== uid || value.range !== range || !Number.isSafeInteger(value.at) || value.at <= 0) throw new Error('cursor');
      cursor = { at: value.at, uid: id(value.uid) };
    } catch {
      const error = new HttpsError('invalid-argument', 'Invalid cursor');
      observeCaughtError(error, { source: 'functions/src/comparisonActivity.ts', handler: 'cursor', site: 'comparisonActivity:cursor' });
      throw error;
    }
  }
  const now = Date.now();
  // One compact summary per viewer, not an unbounded read of individual visits.
  // Exact totals are computed before pagination; no 50-row approximation.
  const summaries = await db.collection(`playerComparisonActivity/${uid}/viewers`).get();
  const candidates = summaries.docs.map(d => ({ uid: d.id, value: d.data(), count: comparisonCount(d.data(), range, now) })).filter(d => d.count > 0);
  const rows: Array<{ id: string; name: string; avatarId?: string; photoUrl?: string; count: number; lastAt: number; groupId: string; groupName: string; scopeLabel: string }> = [];
  for (let i = 0; i < candidates.length; i += 50) {
    const batch = candidates.slice(i, i + 50);
    const docs = await db.getAll(...batch.flatMap(row => [db.doc(`users/${row.uid}`), db.doc(`users/${uid}/blocked/${row.uid}`), db.doc(`users/${row.uid}/blocked/${uid}`)]));
    batch.forEach((row, index) => {
      const [person, blockedA, blockedB] = docs.slice(index * 3, index * 3 + 3), user = person.data();
      if (!user || user.isGuest || blockedA.exists || blockedB.exists) return;
      rows.push({ id: row.uid, name: text(user.name, 60), ...(text(user.avatarId, 80) ? { avatarId: text(user.avatarId, 80) } : {}),
        ...(text(user.photoUrl, 2048) ? { photoUrl: text(user.photoUrl, 2048) } : {}), count: row.count, lastAt: count(row.value.lastAt),
        groupId: text(row.value.lastGroupId, 128), groupName: text(row.value.lastGroupName), scopeLabel: text(row.value.lastScope) });
    });
  }
  rows.sort((a, b) => b.lastAt - a.lastAt || a.id.localeCompare(b.id));
  const eligible = cursor ? rows.filter(row => row.lastAt < cursor!.at || row.lastAt === cursor!.at && row.id.localeCompare(cursor!.uid) > 0) : rows;
  const page = eligible.slice(0, 30), last = page[page.length - 1];
  return { players: rows.length, comparisons: rows.reduce((sum, row) => sum + row.count, 0), rows: page,
    cursor: eligible.length > page.length ? Buffer.from(JSON.stringify({ owner: uid, range, at: last.lastAt, uid: last.id })).toString('base64url') : null };
});
