import { observeCaughtError } from '@/utils/errorObservation';

const TRANSIENT_READ_CODES = new Set(['functions/internal', 'functions/unavailable', 'functions/deadline-exceeded', 'unavailable', 'deadline-exceeded']);

/** Read operations only. A retry must never repeat a write or change owner. */
export async function retryRead<T>(read: () => Promise<T>, assertOwner: () => void): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    assertOwner();
    try {
      const result = await read();
      assertOwner();
      return result;
    } catch (error) {
      // Check before waiting as well as before the next request. Never convert
      // a stale account or exhausted request into an apparently valid empty list.
      assertOwner();
      const code = (error as { code?: string })?.code;
      if (attempt > 0 || !code || !TRANSIENT_READ_CODES.has(code)) {
        observeCaughtError(error, { source: 'src/services/readRetry.ts', handler: 'retryRead', site: 'readRetry:exhausted' });
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}
