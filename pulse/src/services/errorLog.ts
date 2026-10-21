import { errorCauseObjects } from './errorIdentity';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { installCaughtErrorSink, type ErrorOrigin } from './errorObservation';
import { redactDiagnosticContext, redactDiagnosticText } from './diagnosticRedaction';
import { isPulseSignedIn, onPulseSessionChanged, pulseAdminRequest } from './adminSession';

type Pending = { id: string; operation: string; message: string; code: string | null; stack: string | null; origin: ErrorOrigin; count: number };
const buffer = new Map<string, Pending>();
const retries: Array<[string, Pending]> = [];
let seen = new WeakSet<object>();
let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false, generation = 0;
const base = 'https://firestore.googleapis.com/v1/projects/soccer-app-52b6b/databases/(default)/documents/errors/';
function fingerprint(text: string): string {
  let a = 5381, b = 2166136261;
  for (let i = 0; i < text.length; i++) { a = ((a << 5) + a) ^ text.charCodeAt(i); b = Math.imul(b ^ text.charCodeAt(i), 16777619); }
  return `pulse_${(a >>> 0).toString(36)}_${(b >>> 0).toString(36)}`;
}
function schedule(): void {
  if (!timer && (buffer.size || retries.length) && isPulseSignedIn()) timer = setTimeout(() => { timer = undefined; void flushPulseErrors(); }, 12000);
}
export function logPulseError(error: unknown, origin: ErrorOrigin): void {
  try {
    const objects = errorCauseObjects(error);
    if (objects.some(object => seen.has(object))) return;
    for (const object of objects) seen.add(object);
    const value = error as {message?: unknown; code?: unknown; stack?: unknown} | null;
    const message = redactDiagnosticText(String(value?.message ?? error)).slice(0, 2000);
    const operation = `pulse:${origin.site}`.slice(0, 80);
    const fp = fingerprint(`${operation}|${message.replace(/[0-9a-f]{6,}/gi, '#').replace(/\d+/g, '#').slice(0, 200)}`);
    const previous = buffer.get(fp);
    buffer.set(fp, {id: previous?.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, operation, message,
      code: value?.code == null ? null : redactDiagnosticText(String(value.code)).slice(0, 100),
      stack: typeof value?.stack === 'string' ? redactDiagnosticText(value.stack).slice(0, 1500) : null, origin, count: (previous?.count ?? 0) + 1});
    schedule();
  } catch { /* Reporter boundary: never interfere with a dashboard operation. */ }
}

/** Existing authenticated proxy, conditional PATCH; no new permissions or tokens. */
export async function flushPulseErrors(): Promise<void> {
  if (sending || !isPulseSignedIn()) return;
  sending = true;
  const epoch = generation;
  try {
    // Keep the ambiguous in-flight batch frozen; newer occurrences continue
    // coalescing instead of appending an unbounded retry batch every window.
    if (!retries.length) { retries.push(...buffer); buffer.clear(); }
    while (retries.length) {
      if (epoch !== generation) break;
      const [fp, entry] = retries[0];
      const path = base + fp;
      const result = await pulseAdminRequest({url: path, method: 'GET'});
      if (epoch !== generation) break;
      if (result.status !== 200 && result.status !== 404) throw new Error(`Pulse error read ${result.status}`);
      // The proxy returns successful bodies as base64, including Firestore JSON.
      const { toByteArray } = require('base64-js') as typeof import('base64-js');
      const body = result.encoding === 'base64' ? new TextDecoder().decode(toByteArray(result.body)) : result.body;
      const old = result.status === 200 ? JSON.parse(body) : null;
      const delivered = old?.fields?.deliveryIds?.arrayValue?.values?.map((v: {stringValue: string}) => v.stringValue) ?? [];
      if (delivered.includes(entry.id)) { retries.shift(); continue; }
      const now = new Date().toISOString();
      const strings: Record<string, string | null> = {operation: entry.operation, title: `שגיאת פולס · ${entry.origin.handler}`, category: 'action',
        lastMessage: entry.message, lastCode: entry.code, lastStack: entry.stack, platform: Platform.OS, appVersion: Constants.expoConfig?.version ?? 'unknown'};
      const fields: Record<string, unknown> = Object.fromEntries(Object.entries(strings).map(([k,v]) => [k, v === null ? {nullValue: null} : {stringValue: v}]));
      const context = redactDiagnosticContext(entry.origin);
      fields.lastContext = {mapValue: {fields: Object.fromEntries(Object.entries(context).map(([k,v]) => [k,{stringValue: String(v)}]))}};
      fields.count = {integerValue: String(Number(old?.fields?.count?.integerValue ?? 0) + entry.count)};
      fields.lastSeen = {timestampValue: now};
      fields.deliveryIds = {arrayValue: {values: [...delivered.slice(-99), entry.id].map(id => ({stringValue: id}))}};
      if (!old) {fields.status = {stringValue: 'new'}; fields.firstSeen = {timestampValue: now};}
      const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
      const condition = old ? `currentDocument.updateTime=${encodeURIComponent(old.updateTime)}` : 'currentDocument.exists=false';
      if (epoch !== generation) break;
      const saved = await pulseAdminRequest({url: `${path}?${mask}&${condition}`, method: 'PATCH', body: JSON.stringify({fields})});
      if (epoch !== generation) break;
      if (saved.status < 200 || saved.status >= 300) throw new Error(`Pulse error write ${saved.status}`);
      retries.shift();
    }
  } catch (error) {
    console.warn('[pulse-error-delivery]', redactDiagnosticText(String(error)));
  } finally { sending = false; schedule(); }
}

installCaughtErrorSink(logPulseError);
onPulseSessionChanged(() => {
  generation++; buffer.clear(); retries.length = 0; seen = new WeakSet();
  if (timer) clearTimeout(timer); timer = undefined;
});

// Preserve React Native's crash handling while reporting otherwise unhandled
// failures. Reporter transport errors themselves never enter this handler.
const runtime = globalThis as typeof globalThis & {
  ErrorUtils?: {getGlobalHandler?: () => (error: unknown, fatal?: boolean) => void; setGlobalHandler?: (handler: (error: unknown, fatal?: boolean) => void) => void};
};
if (runtime.ErrorUtils?.setGlobalHandler) {
  const previous = runtime.ErrorUtils.getGlobalHandler?.();
  runtime.ErrorUtils.setGlobalHandler((error, fatal) => {
    logPulseError(error,{source:'pulse',handler:'uncaught',site:'global:uncaught'});
    void flushPulseErrors();
    previous?.(error,fatal);
  });
}
