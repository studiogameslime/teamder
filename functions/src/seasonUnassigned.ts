import * as admin from 'firebase-admin';
import { __seasonFields, seasonPairKey } from './seasonRollover';
import { didEveningHappen, eveningPlayState, isOrganizedEveningAwaitingDecision } from './eveningPlayed';

type Data = Record<string, any>;
const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? v : 0;

/** Competition membership, rather than the most recent disable date, defines
 * the pool. Noncompetitive periods remain reusable until explicitly included
 * in a competition. Closed competitive archives are never changed. */
export async function unassignedSeasonActivity(db: admin.firestore.Firestore, groupId: string, s: Data,
  all: admin.firestore.QueryDocumentSnapshot[], now: number) {
  const snapshots = await db.collection('seasonSummary').where('groupId', '==', groupId)
    .select('kind', 'nonSeason', 'seasonId', 'startsAt', 'endsAt', 'completedRounds', 'poolConsumedBy').get();
  const roots = snapshots.docs.filter(d => d.get('kind') !== 'pairPage' && d.get('kind') !== 'cancelledAttempt');
  const competitive = roots.filter(d => !d.get('nonSeason'));
  const closed = new Set(competitive.map(d => d.get('seasonId')));
  const periods = roots.filter(d => d.get('nonSeason') === true && !d.get('poolConsumedBy'));
  const periodIds = new Set(periods.map(d => d.get('seasonId')));
  const lastClosedAt = Math.max(0, ...competitive.map(d => num(d.get('endsAt'))));
  const resumed = s.operation?.kind === 'enableClubSeasons';
  const games = all.filter(d => {
    const g = d.data(), stamp = typeof g.seasonId === 'string' ? g.seasonId : '';
    if (resumed && stamp === `s${(s.count ?? 0) + 1}`) return true;
    if (closed.has(stamp)) return false;
    if (stamp) return stamp.startsWith('off_') || stamp.startsWith('discard_') ||
      (!s.enabled && stamp === s.currentId && !closed.has(s.currentId));
    // Legacy unlabelled games already sealed into a competitive season must
    // not re-enter. An explicit noncompetitive archive can identify an older
    // unlabelled period without making every old game eligible again.
    return !lastClosedAt || num(g.startsAt) > lastClosedAt || periods.some(p =>
      num(g.startsAt) >= num(p.get('startsAt')) && num(g.startsAt) <= num(p.get('endsAt')));
  });
  const played = games.filter(d => didEveningHappen(d.data()));
  const livePlayed = played.filter(d => !periodIds.has(d.get('seasonId')) && !(!d.get('seasonId') && periods.some(p =>
    num(d.get('startsAt')) >= num(p.get('startsAt')) && num(d.get('startsAt')) <= num(p.get('endsAt')))));
  const dates = [...played.map(d => num(d.get('startsAt'))), ...periods.map(d => num(d.get('startsAt')))].filter(n => n > 0);
  return { games, periods, played: livePlayed.length + periods.reduce((n, p) => n + num(p.get('completedRounds')), 0),
    startsAt: dates.length ? Math.min(...dates) : 0,
    unverified: games.filter(d => eveningPlayState(d.data()) === 'unverified' || isOrganizedEveningAwaitingDecision(d.data(), now)).length };
}

function addFields(current: Data, source: Data, fields: readonly string[]): Data {
  const patch: Data = Object.fromEntries(fields.filter(f => typeof source[f] === 'number').map(f => [f, num(current[f]) + num(source[f])]));
  for (const field of ['csRounds', 'asRounds']) if (fields.includes(field) &&
    ((num(current.rounds) > 0 && typeof current[field] !== 'number') || (num(source.rounds) > 0 && typeof source[field] !== 'number'))) {
    patch[field] = admin.firestore.FieldValue.delete();
  }
  return patch;
}

/** Move noncompetitive data back into the live counters. Each chunk adds its
 * rows and removes those SAME rows from their old period atomically. A retry
 * sees only the remaining rows, so a crash cannot add a contribution twice.
 * This is not a reopen: competitive seasons and titles are immutable. */
export async function restoreUnassignedPeriods(db: admin.firestore.Firestore, groupId: string,
  sourceIds: string[], destination: string, now: number) {
  const livePlayers = await db.collection('communityPlayerStats').where('groupId', '==', groupId).get();
  const playerRefs = new Map(livePlayers.docs.map(d => [String(d.get('userId')), d.ref]));
  const livePairs = await db.collection('communityPairStats').where('groupId', '==', groupId).get();
  const pairRefs = new Map(livePairs.docs.map(d => [seasonPairKey(String(d.get('a')), String(d.get('b'))).key, d.ref]));
  for (const id of sourceIds) {
    const ref = db.collection('seasonSummary').doc(id), original = await ref.get();
    if (!original.exists || original.get('groupId') !== groupId || original.get('nonSeason') !== true) throw new Error('Invalid unassigned period');
    if (original.get('poolConsumedBy')) continue;
    if (!original.get('zeroedAt')) throw new Error('Unassigned period has not finished archiving');
    if (original.get('seasonId') === destination) throw new Error('Unassigned period conflicts with destination');
    const pages: string[] = original.get('pairPages') ?? [];
    if (!Array.isArray(pages) || pages.some(id => typeof id !== 'string')) throw new Error('Invalid season pair page');
    // Validate every page before changing anything; a missing page is never
    // treated as an empty chemistry history.
    for (const pageId of pages) {
      const page = await db.collection('seasonSummary').doc(pageId).get();
      if (!page.exists || page.get('groupId') !== groupId || page.get('seasonId') !== original.get('seasonId')) throw new Error('Missing season pair page');
    }
    for (const kind of ['players', 'pairs'] as const) {
      const sources: admin.firestore.DocumentReference[] = kind === 'players' ? [ref] : [ref, ...pages.map(p => db.collection('seasonSummary').doc(p))];
      for (const source of sources) for (;;) {
        const moved = await db.runTransaction(async tx => {
          const frozen = await tx.get(source);
          const remaining: Data = { ...(frozen.get(kind) ?? {}) };
          const entries = Object.entries(remaining).filter(([, row]) => kind !== 'players' || !row.poolTransferred).slice(0, 80) as [string, Data][];
          if (!entries.length) return 0;
          const refs = entries.map(([key, row]) => kind === 'players'
            ? playerRefs.get(key) ?? db.collection('communityPlayerStats').doc(`${groupId}__${key}`)
            : pairRefs.get(key) ?? db.collection('communityPairStats').doc(`${groupId}__${row.a}__${row.b}`));
          const live = await tx.getAll(...refs);
          entries.forEach(([key, archived], i) => {
            const current = live[i].data() ?? {};
            const flip = kind === 'pairs' && current.a && current.a !== archived.a;
            const row = flip ? { ...archived, winsA: archived.winsB, winsB: archived.winsA,
              assistsAToB: archived.assistsBToA, assistsBToA: archived.assistsAToB } : archived;
            tx.set(refs[i], { groupId, ...(kind === 'players' ? { userId: key,
              ...(!current.displayName && archived.displayName ? { displayName: archived.displayName } : {}) }
              : { a: current.a ?? row.a, b: current.b ?? row.b }),
              ...addFields(current, row, kind === 'players' ? __seasonFields.player : __seasonFields.pair),
              seasonWoundBack: admin.firestore.FieldValue.delete(), updatedAt: now }, { merge: true });
            if (kind === 'players') remaining[key] = {
              ...Object.fromEntries(__seasonFields.player.map(f => [f, 0])),
              displayName: archived.displayName ?? '', poolTransferred: true,
            };
            else delete remaining[key];
          });
          tx.update(source, kind, remaining);
          return entries.length;
        });
        if (!moved) break;
      }
    }
    const clubRef = db.collection('communityStats').doc(groupId);
    await db.runTransaction(async tx => {
      const [frozen, club] = await tx.getAll(ref, clubRef);
      if (frozen.get('poolConsumedBy')) return;
      tx.set(clubRef, { groupId, ...addFields(club.data() ?? {}, frozen.get('totals') ?? {}, __seasonFields.club),
        chemistrySince: Math.min(num(club.get('chemistrySince')) || now, num(frozen.get('startsAt')) || now),
        seasonWoundBack: admin.firestore.FieldValue.delete(), updatedAt: now }, { merge: true });
      // A consumed noncompetitive period remains an administrative receipt.
      // Empty numeric rows prevent all-time readers counting it a second time.
      tx.update(ref, { totals: {}, completedRounds: 0, poolConsumedBy: destination, poolConsumedAt: now });
      tx.set(db.collection('seasonCards').doc(id), { groupId, seasonId: frozen.get('seasonId'), nonSeason: true,
        totals: { rounds: 0, goals: 0, assists: 0 }, completedRounds: 0, players: 0, poolConsumedBy: destination }, { merge: true });
    });
  }
}
