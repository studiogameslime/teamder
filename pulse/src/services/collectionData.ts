import { cached } from './cache';
import { listAll } from './firestoreRest';

/** Shared full documents for the small admin aggregations; never run on app launch. */
export function collectionData(collection: 'users' | 'groups' | 'games', force = false) {
  return cached(`collection:${collection}`, () => listAll(collection), { force, ttl: 3 * 60_000 });
}
