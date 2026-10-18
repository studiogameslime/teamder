import { createHash } from 'crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function fingerprintCreation(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

/** The authenticated uid is bound server-side; request data cannot pick it. */
export function creationReceiptId(uid: string, attemptId: string): string {
  return fingerprintCreation([uid, 'club', attemptId]);
}
