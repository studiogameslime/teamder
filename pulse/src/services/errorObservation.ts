/** Dependency-free observation bridge. Never changes a catch's return/throw. */
export type ErrorOrigin = { source: string; handler: string; site: string };
type Sink = (error: unknown, origin: ErrorOrigin) => void;
let sink: Sink | undefined;
const waiting: Array<[unknown, ErrorOrigin]> = [];
let origins = new WeakMap<object, ErrorOrigin>();

export function caughtErrorOrigin(error: unknown): ErrorOrigin | undefined {
  return error !== null && (typeof error === 'object' || typeof error === 'function')
    ? origins.get(error as object) : undefined;
}

export function installCaughtErrorSink(next: Sink): void {
  sink = next;
  for (const [error, origin] of waiting.splice(0)) observeCaughtError(error, origin);
}

export function clearCaughtErrorOrigins(): void {
  origins = new WeakMap();
  waiting.length = 0;
}

export function observeCaughtError(error: unknown, origin: ErrorOrigin): void {
  try {
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
      if (!origins.has(error as object)) origins.set(error as object, origin);
    }
    if (sink) sink(error, caughtErrorOrigin(error) ?? origin);
    else {
      if (waiting.length === 100) waiting.shift();
      waiting.push([error, origin]);
    }
  } catch {
    // Reporting infrastructure is a recursion boundary, not an application failure.
  }
}

/** Preserve allSettled results and order while observing rejected branches. */
export function observeSettledErrors<T extends readonly PromiseSettledResult<unknown>[]>(results: T, origin: ErrorOrigin): T {
  for (const result of results) if (result.status === 'rejected') observeCaughtError(result.reason, origin);
  return results;
}

export function observedRejection<T>(handler: (error: any) => T, origin: ErrorOrigin): (error: unknown) => T {
  return error => { observeCaughtError(error, origin); return handler(error); };
}

export function observedListener(handler: ((error: any) => unknown) | undefined, origin: ErrorOrigin): (error: any) => void {
  return error => { observeCaughtError(error, origin); handler?.(error); };
}
