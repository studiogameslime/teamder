import * as https from 'firebase-functions/v2/https';
import * as firestore from 'firebase-functions/v2/firestore';
import * as scheduler from 'firebase-functions/v2/scheduler';
import * as tasks from 'firebase-functions/v2/tasks';
import { withServerErrorReporting } from './serverErrorLog';

// Preserve Firebase's overloads, deployment metadata and handler options.
// Only the user callback is wrapped; no authentication/permissions are altered.
function observed<T extends (...args: any[]) => any>(name: string, factory: T): T {
  return ((...args: any[]) => {
    const last = args.length - 1;
    const definition = new Error().stack?.split('\n')[2]?.match(/([^/\\\s()]+:\d+):\d+\)?$/)?.[1];
    args[last] = withServerErrorReporting(definition ? `${name}:${definition}` : name, args[last]);
    return factory(...args);
  }) as T;
}
export const onCall: typeof https.onCall = observed('onCall', https.onCall);
export const onRequest: typeof https.onRequest = observed('onRequest', https.onRequest);
export const onDocumentCreated: typeof firestore.onDocumentCreated = observed('onDocumentCreated', firestore.onDocumentCreated);
export const onDocumentUpdated: typeof firestore.onDocumentUpdated = observed('onDocumentUpdated', firestore.onDocumentUpdated);
export const onDocumentWritten: typeof firestore.onDocumentWritten = observed('onDocumentWritten', firestore.onDocumentWritten);
export const onDocumentDeletedWithAuthContext: typeof firestore.onDocumentDeletedWithAuthContext = observed('onDocumentDeletedWithAuthContext', firestore.onDocumentDeletedWithAuthContext);
export const onSchedule: typeof scheduler.onSchedule = observed('onSchedule', scheduler.onSchedule);
export const onTaskDispatched: typeof tasks.onTaskDispatched = observed('onTaskDispatched', tasks.onTaskDispatched);
export { HttpsError } from 'firebase-functions/v2/https';
export type { CallableRequest } from 'firebase-functions/v2/https';
