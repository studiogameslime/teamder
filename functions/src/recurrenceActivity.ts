import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { eveningPlayState, playEvidence } from './eveningPlayed';

export const RECURRENCE_GRACE_MS = 3 * 60 * 60 * 1000;
export const INACTIVE_OCCURRENCE_LIMIT = 3;

interface OccurrenceActivity {
  gameId: string;
  startsAt: number;
  inactive: boolean;
}

/** Unknown/offline play with registrations is deliberately not a failed week. */
export function isInactiveOccurrence(game: DocumentData): boolean {
  const state = eveningPlayState(game);
  if (state === 'notHappened') return true;
  if (state === 'happened' || playEvidence(game)) return false;
  return !['players', 'guests', 'waitlist', 'pending'].some(key =>
    Array.isArray(game[key]) && game[key].length > 0,
  );
}

/** Retain three actual kickoffs, never three cron runs or three skipped weeks.
 * Current documents replace saved decisions; deleted empty weeks remain known.
 * Duplicate documents for one kickoff are one week, protected if any is active. */
export function recurrenceActivity(
  saved: unknown,
  games: ReadonlyArray<{ id: string; data(): DocumentData }>,
  now: number,
): OccurrenceActivity[] {
  const byId = new Map<string, OccurrenceActivity>();
  for (const item of Array.isArray(saved) ? saved : []) {
    if (item && typeof item.gameId === 'string' && typeof item.inactive === 'boolean' &&
        Number.isFinite(item.startsAt) && item.startsAt > 0 && item.startsAt <= now - RECURRENCE_GRACE_MS) {
      byId.set(item.gameId, { gameId: item.gameId, startsAt: item.startsAt, inactive: item.inactive });
    }
  }
  for (const doc of games) {
    const game = doc.data();
    if (Number.isFinite(game.startsAt) && game.startsAt > 0 && game.startsAt <= now - RECURRENCE_GRACE_MS) {
      byId.set(doc.id, { gameId: doc.id, startsAt: game.startsAt, inactive: isInactiveOccurrence(game) });
    }
  }
  const byKickoff = new Map<number, OccurrenceActivity>();
  for (const item of byId.values()) {
    const prior = byKickoff.get(item.startsAt);
    // Keep the active document's ID so a later re-read can revise its decision.
    if (!prior || !item.inactive) byKickoff.set(item.startsAt, item);
  }
  return [...byKickoff.values()].sort((a, b) => b.startsAt - a.startsAt).slice(0, INACTIVE_OCCURRENCE_LIMIT);
}

export function recurrenceShouldStop(activity: OccurrenceActivity[]): boolean {
  return activity.length === INACTIVE_OCCURRENCE_LIMIT && activity.every(item => item.inactive);
}

export async function readSeriesActivity(
  db: Firestore, tx: Transaction, seriesRef: DocumentReference, series: DocumentData, now: number,
): Promise<OccurrenceActivity[]> {
  // Bounded by the (seriesId, startsAt DESC) index. No client schema needed.
  const recent = await tx.get(db.collection('games').where('seriesId', '==', seriesRef.id)
    .where('startsAt', '<=', now - RECURRENCE_GRACE_MS).orderBy('startsAt', 'desc').limit(INACTIVE_OCCURRENCE_LIMIT));
  return recurrenceActivity(series.recurrenceActivity, recent.docs.filter(doc => doc.data().groupId === series.groupId), now);
}

export function seriesActivityPatch(activity: OccurrenceActivity[], now: number): DocumentData {
  return {
    recurrenceActivity: activity,
    ...(recurrenceShouldStop(activity) ? { active: false, stoppedReason: 'inactive-occurrences', stoppedAt: now, updatedAt: now } : {}),
  };
}

/** Remember empty weeks in the SAME transaction that deletes them. A failed
 * read must leave the game for retry, rather than lose a week from the streak. */
export async function deleteEmptyGameWithRecurrence(
  db: Firestore, gameRef: DocumentReference, roundRefs: DocumentReference[], now: number,
): Promise<boolean> {
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(gameRef);
    const game = snapshot.data();
    if (!game || !['open', 'locked', 'active'].includes(game.status) ||
        typeof game.startsAt !== 'number' || game.startsAt >= now - RECURRENCE_GRACE_MS ||
        (Array.isArray(game.players) && game.players.length > 0) ||
        (Array.isArray(game.guests) && game.guests.length > 0) || playEvidence(game) ||
        eveningPlayState(game) === 'happened') return false;
    // The legacy source must survive until cloning carries its history forward.
    if (!game.seriesId && game.recurring === true && !game.recurringNextCreatedAt) return false;
    if (typeof game.seriesId === 'string' && game.seriesId) {
      const seriesRef = db.collection('gameSeries').doc(game.seriesId);
      const series = (await tx.get(seriesRef)).data();
      if (series?.active === true && series.groupId === game.groupId) {
        const activity = await readSeriesActivity(db, tx, seriesRef, series, now);
        tx.update(seriesRef, seriesActivityPatch(activity, now));
      }
    }
    roundRefs.forEach(ref => tx.delete(ref));
    tx.delete(gameRef);
    return true;
  });
}
