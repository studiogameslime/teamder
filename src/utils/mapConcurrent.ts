import { observeCaughtError } from './errorObservation';

/** Bounded parallel reads, with results in input order and no partial success.
 * Stop starting work after the first failure; already running reads settle.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  read: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency');
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await read(items[index], index);
      } catch (error) {
        observeCaughtError(error, { source: 'src/utils/mapConcurrent.ts', handler: 'worker', site: 'mapConcurrent:read' });
        if (!failed) failure = error;
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw failure;
  return results;
}

