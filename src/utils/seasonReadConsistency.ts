import { observeCaughtError } from './errorObservation';
import type { GroupSeasons } from '@/types';

/** Firestore may keep retrying a lost connection without settling a read.
 * Let the screen offer retry without treating unavailable history as empty. */
export function withSeasonReadTimeout<T>(read: Promise<T>, timeoutMs = 30_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('Season statistics read timed out'),
      { code: 'deadline-exceeded' })), timeoutMs);
    read.then(value => { clearTimeout(timer); resolve(value); }, error => {
    observeCaughtError(error, {"source":"src/utils/seasonReadConsistency.ts","handler":"withSeasonReadTimeout","site":"seasonReadConsistency:a85036a9e1"}); clearTimeout(timer); reject(error); });
  });
}

/** Changes which invalidate both the live table and its archive list. */
export function seasonReadStamp(s?: GroupSeasons): string {
  return JSON.stringify(s ? [s.enabled, s.currentId, s.revision, s.playedRounds, s.count,
    s.operation, s.pendingClose, s.manualClose, s.cadence, s.nextCadence, s.hasArchivedPeriods] : null);
}

/** Never label counters read across a rollover with the previous season.
 * Bounded retries cover a transition during the read; an unfinished operation
 * stays an explicit unavailable state, never an empty table. */
export async function readConsistentSeasonSnapshot<G extends { seasons?: GroupSeasons }, T>(
  readGroup: () => Promise<G | null>, readData: (group: G) => Promise<T>,
): Promise<{ group: G; data: T }> {
  return withSeasonReadTimeout((async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await readGroup();
    if (!before) throw new Error('Community statistics group unavailable');
    if (before.seasons?.operation) throw new Error('Community season operation in progress');
    const data = await readData(before);
    const after = await readGroup();
    if (!after) throw new Error('Community statistics group unavailable');
    if (!after.seasons?.operation && seasonReadStamp(before.seasons) === seasonReadStamp(after.seasons)) {
      return { group: after, data };
    }
  }
  throw new Error('Community season changed during statistics read');
  })());
}
