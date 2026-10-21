import { errorCauseObjects } from './errorIdentity';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { redactDiagnosticContext, redactDiagnosticText } from './diagnosticRedaction';

type Origin = { source: string; handler: string; site: string };
type Incident = { error: unknown; operation: string; context: Record<string, unknown>; legacy?: boolean };
type Scope = { incidents: Incident[]; objects: WeakMap<object, Incident>; context: Record<string, unknown> };
const scopes = new AsyncLocalStorage<Scope>();

function record(error: unknown, operation: string, context: Record<string, unknown>): Incident | undefined {
  const scope = scopes.getStore();
  if (!scope) return undefined;
  const objects = errorCauseObjects(error);
  const existing = objects.map(object => scope.objects.get(object)).find(Boolean);
  if (existing) {
    for (const object of objects) scope.objects.set(object, existing);
    existing.context = { ...existing.context, ...context };
    if (!operation.startsWith('caught:') && !operation.startsWith('uncaught:')) existing.operation = operation;
    return existing;
  }
  const incident = { error, operation, context: {...scope.context, ...context} };
  scope.incidents.push(incident);
  for (const object of objects) scope.objects.set(object, incident);
  return incident;
}

export function observeCaughtError(error: unknown, origin: Origin): void {
  try {
    if (!record(error, `caught:${origin.site}`, origin)) {
      // Startup/synchronous code outside a function invocation has no lifetime
      // in which to await Firestore. Keep evidence in Cloud Logging as well.
      console.error('[server-outside-handler]', origin, redactDiagnosticText(String(error)));
    }
  } catch { /* Never replace the original exception with a reporting failure. */ }
}

export function observeSettledErrors<T extends readonly PromiseSettledResult<unknown>[]>(results: T, origin: Origin): T {
  for (const result of results) if (result.status === 'rejected') observeCaughtError(result.reason, origin);
  return results;
}

export function observedRejection<T>(handler: (error: any) => T, origin: Origin): (error: unknown) => T {
  return error => { observeCaughtError(error, origin); return handler(error); };
}

export async function reportServerError(args: { operation: string; err: unknown; context?: Record<string, unknown> }): Promise<void> {
  const incident = record(args.err, args.operation, args.context ?? {});
  if (incident) incident.legacy = true;
  else await persistIncident({error: args.err, operation: args.operation, context: args.context ?? {}, legacy: true});
}

async function persistIncident(incident: Incident, count = 1): Promise<void> {
  try {
    const value = incident.error as {message?: unknown; code?: unknown; stack?: unknown} | null;
    const message = redactDiagnosticText(String(value?.message ?? incident.error)).slice(0, 2000);
    const operation = redactDiagnosticText(incident.operation).slice(0, 80);
    const signature = message.replace(/[0-9a-f]{6,}/gi, '#').replace(/\d+/g, '#').slice(0, 200);
    const fingerprint = incident.legacy
      ? `srv_${incident.operation}_${String(incident.context.groupId ?? '')}`.replace(/[^\w]/g, '').slice(0, 80)
      : 'srv_' + createHash('sha256').update(`${operation}|${signature}`).digest('hex').slice(0, 32);
    const db = getFirestore(), ref = db.doc(`errors/${fingerprint}`);
    const common = { operation, fingerprint, title: `שגיאת שרת · ${operation}`, category: 'server',
      lastMessage: message, lastCode: value?.code == null ? null : redactDiagnosticText(String(value.code)).slice(0, 100),
      lastStack: typeof value?.stack === 'string' ? redactDiagnosticText(value.stack).slice(0, 2000) : null,
      lastContext: redactDiagnosticContext(incident.context), lastUserId: typeof incident.context.userId === 'string' ? incident.context.userId : null, lastScreen: null,
      platform: 'server', appVersion: 'functions', lastSeen: FieldValue.serverTimestamp() };
    await db.runTransaction(async tx => {
      const previous = await tx.get(ref);
      tx.set(ref, {...common, count: FieldValue.increment(count), ...(!previous.exists ? {status: 'new', firstSeen: FieldValue.serverTimestamp()} : {})}, {merge: true});
    });
  } catch (error) {
    // The terminal transport failure is observable without recursively writing.
    console.error('[server-error-delivery]', incident.operation, {
      deliveryError: redactDiagnosticText(String(error)),
      originalError: redactDiagnosticText(String(incident.error)).slice(0, 2000),
      context: redactDiagnosticContext(incident.context),
    });
  }
}

/** Await reporting before Firebase completes/freezes an invocation, even on throw. */
export function withServerErrorReporting<T extends (...args: any[]) => any>(name: string, handler: T): T {
  return function(this: unknown, ...args: Parameters<T>) {
    const request = args[0] as {auth?: {uid?: string}; params?: Record<string, unknown>} | undefined;
    const context: Record<string, unknown> = {functionKind: name};
    if (typeof request?.auth?.uid === 'string') context.userId = request.auth.uid;
    for (const key of ['gameId','groupId','roundId','seasonId','notificationId','chatId','messageId']) {
      const value = request?.params?.[key];
      if (typeof value === 'string' && value.length <= 128) context[key] = value;
    }
    return scopes.run({incidents: [], objects: new WeakMap(), context}, async () => {
      try {
        return await handler.apply(this, args);
      } catch (error) {
        record(error, `uncaught:${name}`, {uncaughtAt: name});
        throw error;
      } finally {
        const scope = scopes.getStore()!;
        // Group repeated branch failures into one transaction per signature.
        const grouped = new Map<string, {incident: Incident; count: number}>();
        for (const incident of scope.incidents) {
          let message = '';
          try { message = redactDiagnosticText(String((incident.error as {message?: unknown})?.message ?? incident.error)).replace(/[0-9a-f]{6,}/gi,'#').replace(/\d+/g,'#').slice(0,200); } catch { message = 'unreadable-error'; }
          const key = incident.legacy ? `legacy:${incident.operation}|${incident.context.groupId??''}` : `${incident.operation}|${message}`, previous = grouped.get(key);
          grouped.set(key, {incident, count: (previous?.count ?? 0) + 1});
        }
        for (const {incident,count} of grouped.values()) await persistIncident(incident,count);
      }
    });
  } as T;
}
