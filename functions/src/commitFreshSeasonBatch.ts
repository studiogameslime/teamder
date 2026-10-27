import { observeCaughtError } from './serverErrorLog';
interface PendingBatch { commit(): Promise<unknown> }

/** Rebuild the complete guarded batch on an optimistic document-version race.
 * The callback MUST re-read and validate its original season each time.
 * A season guard failure, create-only latch collision, or other precondition
 * is never retried here. Exhaustion still reaches the trigger's retry policy.
 */
export async function commitFreshSeasonBatch(build: () => Promise<PendingBatch>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const batch = await build();
    try { await batch.commit(); return; }
    catch (error) {
      const value = error as { code?: number | string; message?: string };
      const versionConflict = (value?.code === 9 || value?.code === 'failed-precondition') &&
        /stored version[\s\S]*required base version/i.test(value.message ?? '');
      if (!versionConflict || attempt >= 2) {
        observeCaughtError(error, { source: 'functions/src/commitFreshSeasonBatch.ts', handler: 'commitFreshSeasonBatch', site: 'finishBatch:exhausted' });
        throw error;
      }
    }
  }
}
