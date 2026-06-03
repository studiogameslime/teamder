// Centralized client-side error logging → Firestore `errors` collection.
//
// Design goals:
//  • AGGREGATED — one doc per unique error signature (operation + normalized
//    message), with a running `count`, first/last seen, status, and the FULL
//    context of the most recent occurrence (params, userId, screen, platform).
//  • FREE — writes are coalesced in memory and flushed at most once per
//    flush window per signature, so a bug firing thousands of times costs a
//    handful of writes, well inside Firestore's free tier.
//  • NEVER THROWS — logging must not break the operation it reports on, and
//    must never recurse into itself.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getFirebase } from '../firebase/config';

export interface ErrorContext {
  /** What the user/app was doing — short stable label, e.g. 'createGame'. */
  screen?: string;
  /** Input params / state at the failure ("tried to create group with x,y,z"). */
  [key: string]: unknown;
}

interface Buffered {
  operation: string;
  message: string;
  code?: string;
  stack?: string;
  context: Record<string, unknown>;
  userId?: string;
  screen?: string;
  pending: number; // un-flushed occurrences
}

const FLUSH_MS = 12000; // coalesce window
const buffer = new Map<string, Buffered>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlush = false;

const appVersion =
  (Constants.expoConfig?.version as string | undefined) ?? 'unknown';

// ── helpers ────────────────────────────────────────────────────────
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Strip volatile bits (ids, numbers) so the same bug groups into one doc.
function normalize(msg: string): string {
  return msg
    .replace(/[0-9a-f]{6,}/gi, '#')
    .replace(/\d+/g, '#')
    .slice(0, 200);
}

function errInfo(e: unknown): { message: string; code?: string; stack?: string } {
  if (e instanceof Error) {
    return {
      message: e.message || e.name || 'Error',
      code: (e as { code?: string }).code,
      stack: e.stack?.slice(0, 1500),
    };
  }
  if (typeof e === 'string') return { message: e };
  try {
    return { message: JSON.stringify(e).slice(0, 500) };
  } catch {
    return { message: String(e) };
  }
}

function safeContext(ctx?: ErrorContext): Record<string, unknown> {
  if (!ctx) return {};
  try {
    // Drop non-serializable values + cap size.
    const json = JSON.stringify(ctx, (_k, v) =>
      typeof v === 'function' ? undefined : v,
    );
    const capped = json.length > 4000 ? json.slice(0, 4000) + '…' : json;
    return JSON.parse(capped.length === json.length ? json : json.slice(0, 4000)) ?? {};
  } catch {
    return {};
  }
}

function currentUid(): string | undefined {
  try {
    return getFirebase().auth.currentUser?.uid ?? undefined;
  } catch {
    return undefined;
  }
}

// ── public API ─────────────────────────────────────────────────────
/**
 * Record a failed operation. Fire-and-forget — safe to call anywhere,
 * never throws. `operation` is a short stable label; `context` carries the
 * params/state so the dashboard can show exactly what was attempted.
 */
export function logError(
  operation: string,
  error: unknown,
  context?: ErrorContext,
): void {
  try {
    const { message, code, stack } = errInfo(error);
    const fp = djb2(`${operation}|${normalize(message)}`);
    const screen = context?.screen as string | undefined;
    const existing = buffer.get(fp);
    if (existing) {
      existing.pending += 1;
      existing.message = message;
      existing.code = code;
      existing.stack = stack;
      existing.context = safeContext(context);
      existing.userId = currentUid();
      existing.screen = screen;
    } else {
      buffer.set(fp, {
        operation,
        message,
        code,
        stack,
        context: safeContext(context),
        userId: currentUid(),
        screen,
        pending: 1,
      });
    }
    scheduleFlush();
  } catch {
    // logging must never throw
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_MS);
}

/** Wire a render-time error from <ErrorBoundary onError={...}>. */
export function logRenderError(
  error: Error,
  info: { componentStack: string },
): void {
  logError('uncaughtRender', error, {
    componentStack: String(info?.componentStack ?? '').slice(0, 1500),
  });
}

/**
 * Install global catch-alls: uncaught JS errors (crashes) via ErrorUtils,
 * and unhandled promise rejections (best-effort). Call once at startup.
 */
export function installGlobalErrorHandlers(): void {
  try {
    const g = global as unknown as {
      ErrorUtils?: {
        getGlobalHandler?: () => (e: unknown, fatal?: boolean) => void;
        setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void;
      };
      __errorLogInstalled?: boolean;
    };
    if (g.ErrorUtils?.setGlobalHandler && !g.__errorLogInstalled) {
      const prev = g.ErrorUtils.getGlobalHandler?.();
      g.ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
        logError('uncaught', error, { isFatal: !!isFatal });
        // Flush synchronously-ish before a fatal tears the JS context down.
        void flush();
        if (prev) prev(error, isFatal);
      });
      g.__errorLogInstalled = true;
    }
  } catch {
    // never block startup
  }
  // Best-effort unhandled-promise-rejection tracking (RN promise polyfill).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tracking = require('promise/setimmediate/rejection-tracking');
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id: unknown, error: unknown) =>
        logError('unhandledRejection', error),
      onHandled: () => {},
    });
  } catch {
    // polyfill not present / different RN internals — skip
  }
}

export async function flush(): Promise<void> {
  if (inFlush || buffer.size === 0) return;
  inFlush = true;
  let db;
  try {
    db = getFirebase().db; // throws in mock mode → skip silently
  } catch {
    inFlush = false;
    return;
  }
  const entries = [...buffer.entries()].filter(([, e]) => e.pending > 0);
  for (const [fp, e] of entries) {
    const delta = e.pending;
    e.pending = 0;
    const ref = doc(db, 'errors', fp);
    const common = {
      operation: e.operation,
      lastMessage: e.message,
      lastCode: e.code ?? null,
      lastStack: e.stack ?? null,
      lastContext: e.context,
      lastUserId: e.userId ?? null,
      lastScreen: e.screen ?? null,
      platform: Platform.OS,
      osVersion: String(Platform.Version ?? ''),
      appVersion,
      lastSeen: serverTimestamp(),
    };
    try {
      // Increment an existing signature…
      await updateDoc(ref, { ...common, count: increment(delta) });
    } catch {
      // …or create it on first sighting (with create-only fields).
      try {
        await setDoc(
          ref,
          {
            ...common,
            fingerprint: fp,
            count: delta,
            status: 'new',
            firstSeen: serverTimestamp(),
          },
          { merge: true },
        );
      } catch {
        e.pending += delta; // write failed (offline) — retry next flush
      }
    }
  }
  inFlush = false;
}
