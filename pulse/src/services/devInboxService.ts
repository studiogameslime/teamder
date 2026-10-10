// Aggregate "open work" count across the three Dev-Inbox streams, for the
// footer notification bubble. This runs on a timer while Pulse is foregrounded,
// so it must be CHEAP: it uses count() aggregations (open = total − closed)
// instead of reading every doc. ~6 reads per call regardless of collection
// size — vs ~170 if we loaded the full lists just to count them.

import { countCollection, countWhereEquals } from './firestoreRest';
import { has } from '../secrets';

export interface OpenCounts {
  errors: number;
  features: number;
  reports: number;
  total: number;
}

export async function openInboxCounts(): Promise<OpenCounts> {
  if (!has.firebase()) return { errors: 0, features: 0, reports: 0, total: 0 };
  // open = total − closed. "closed" is the terminal status per stream; anything
  // else (incl. a missing status) counts as open — matching the old
  // `status !== 'resolved'/'done'` filters.
  const [errTotal, errClosed, featTotal, featClosed, repTotal, repClosed] =
    await Promise.all([
      countCollection('errors'),
      countWhereEquals('errors', 'status', 'resolved'),
      countCollection('pulseFeatures'),
      countWhereEquals('pulseFeatures', 'status', 'done'),
      countCollection('feedback'),
      countWhereEquals('feedback', 'status', 'done'),
    ]);
  const errors = Math.max(0, errTotal - errClosed);
  const features = Math.max(0, featTotal - featClosed);
  const reports = Math.max(0, repTotal - repClosed);
  return { errors, features, reports, total: errors + features + reports };
}
