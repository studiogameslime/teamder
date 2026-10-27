import { observeCaughtError } from '@/utils/errorObservation';
import { recordDiagnostic, diagnosticErrorOperation } from './diagnosticJournal';

const TRANSIENT_READ_CODES = new Set(['functions/internal', 'functions/unavailable', 'functions/deadline-exceeded', 'unavailable', 'deadline-exceeded', 'remoteConfig/failure', 'http/429', 'http/500', 'http/502', 'http/503', 'http/504']);

export function isTransientReadError(error: unknown): boolean {
  const value = error as {code?:string;message?:string;name?:string}|null;
  return !!value?.code && TRANSIENT_READ_CODES.has(value.code) ||
    value?.name === 'AbortError' || /client is offline|network request failed|failed to fetch/i.test(value?.message ?? '');
}

/** Read operations only. A retry must never repeat a write or change owner. */
export async function retryRead<T>(read: () => Promise<T>, assertOwner: () => void, delayMs = 500): Promise<T> {
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
      if (attempt > 0 || !isTransientReadError(error)) {
        observeCaughtError(error, { source: 'src/services/readRetry.ts', handler: 'retryRead', site: 'readRetry:exhausted' });
        throw error;
      }
      recordDiagnostic('act','read_retry',{attempt:attempt+2,operationId:diagnosticErrorOperation(error)?.id});
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

/** Public GET reads only; one retry, eight seconds per attempt. */
export function fetchRead(url: string, init?: RequestInit): Promise<Response> {
  // Callers with an existing deadline own cancellation and must never restart it.
  if (init?.signal) return fetch(url, init);
  return retryRead(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {...init, signal: controller.signal});
      if (TRANSIENT_READ_CODES.has(`http/${response.status}`)) {
        throw Object.assign(new Error('HTTP request failed'), {code:`http/${response.status}`});
      }
      return response;
    } finally { clearTimeout(timer); }
  }, () => {}, 1000);
}
