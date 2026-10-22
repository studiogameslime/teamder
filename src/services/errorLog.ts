import { errorCauseObjects } from '../utils/errorIdentity';
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
import { crumbErr, formatTrail } from '@/services/breadcrumbs';
import { diagnosticAttachment, diagnosticOwner, diagnosticReportScreen } from './diagnosticJournal';
import { readPendingDiagnosticErrors, savePendingDiagnosticErrors, persistDiagnosticJournal } from './diagnosticStorage';
import Constants from 'expo-constants';
import { httpsCallable } from 'firebase/functions';
import { getFirebase } from '../firebase/config';
import { redactDiagnosticContext, redactDiagnosticText } from '../utils/diagnosticRedaction';
import { caughtErrorOrigin, clearCaughtErrorOrigins, installCaughtErrorSink } from '../utils/errorObservation';
import { reportCrashlyticsError } from './crashlyticsService';

export interface ErrorContext {
  /** What the user/app was doing — short stable label, e.g. 'createGame'. */
  screen?: string;
  /** Input params / state at the failure ("tried to create group with x,y,z"). */
  [key: string]: unknown;
}

interface Buffered {
  deliveryId?: string;
  operation: string;
  message: string;
  code?: string;
  stack?: string;
  context: Record<string, unknown>;
  userId?: string;
  screen?: string;
  pending: number; // un-flushed occurrences
  trail: string;
  journal: string;
  version: string;
}

const FLUSH_MS = 12000; // coalesce window
// Hard ceiling on DB writes per unique signature per app session. Coalescing
// already caps a bug to ~1 write / 12s / device; this additionally bounds a
// device stuck in a bad state all day so it can't hammer one `errors/{fp}`
// doc indefinitely. After the cap, compact pending counts remain local for
// the next process/session rather than being silently discarded.
const SESSION_WRITE_CAP = 30;
const buffer = new Map<string, Buffered>();
// Keep unacknowledged writes on disk even while their network request is pending.
const delivering = new Map<string, Buffered>();
let ownerGeneration = 0;
const flushedPerFp = new Map<string, number>(); // writes done this session, by fp
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlush = false;
let reportedObjects = new WeakSet<object>();

const appVersion =
  (Constants.expoConfig?.version as string | undefined) ?? 'unknown';

// Read before the first new error can replace the previous process's outbox.
const recoveredErrors = readPendingDiagnosticErrors();
let restored=false;
let pendingTimer:ReturnType<typeof setTimeout>|undefined;
function persistPending(immediate=false):void {
 if(pendingTimer){if(!immediate)return;clearTimeout(pendingTimer);pendingTimer=undefined;}
 const save=()=>{
  pendingTimer=undefined;
  const rows = [...delivering.values()].map(entry => ({fp: djb2(`${entry.operation}|${normalize(entry.message)}`), entry}));
  for(const [fp,entry] of buffer){if(entry.pending>0)rows.push({fp,entry});}
  void savePendingDiagnosticErrors(rows);
 };
 if(immediate)save();else pendingTimer=setTimeout(save,250);
}
export function clearPendingErrors():void {
 reportedObjects = new WeakSet(); clearCaughtErrorOrigins();
 ownerGeneration+=1;buffer.clear();delivering.clear();flushedPerFp.clear();
 if(flushTimer)clearTimeout(flushTimer);flushTimer=null;
 if(pendingTimer)clearTimeout(pendingTimer);pendingTimer=undefined;
}
export async function restorePendingErrors(viewerId:string):Promise<void> {
 if(restored)return;
 const rows=await recoveredErrors;
 if(currentUid()!==viewerId)return;
 restored=true;
 for(const row of rows){
  if(!row||typeof row!=='object')continue;
  const {fp,entry}=row as {fp?:unknown;entry?:Buffered};
  if(typeof fp!=='string'||!/^[a-z0-9]{1,20}$/.test(fp)||!entry||entry.userId!==viewerId||
    typeof entry.operation!=='string'||typeof entry.message!=='string'||typeof entry.journal!=='string'||entry.journal.length>60000||
    typeof entry.trail!=='string'||entry.trail.length>6000||typeof entry.version!=='string'||entry.version.length>100||
    !entry.context||typeof entry.context!=='object'||Array.isArray(entry.context)||
    !Number.isInteger(entry.pending)||entry.pending<=0||entry.pending>1000000)continue;
  // Preserve newer in-process evidence for the same fingerprint.
  const clean = {
    ...entry,
    operation: redactDiagnosticText(entry.operation).slice(0,100),
    message: redactDiagnosticText(entry.message).slice(0,2000),
    stack: typeof entry.stack === 'string' ? redactDiagnosticText(entry.stack).slice(0,1500) : undefined,
    code: typeof entry.code === 'string' ? redactDiagnosticText(entry.code).slice(0,100) : undefined,
    screen: typeof entry.screen === 'string' ? redactDiagnosticText(entry.screen).slice(0,100) : undefined,
    trail: redactDiagnosticText(entry.trail),
    context: safeContext(entry.context),
  };
  if (typeof entry.deliveryId === 'string' && /^[a-z0-9-]{10,100}$/.test(entry.deliveryId)) delivering.set(entry.deliveryId, clean);
  else if(!buffer.has(fp))buffer.set(fp,clean);else buffer.get(fp)!.pending+=entry.pending;
 }
 persistPending();await flush();
}

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
      code: (e as { code?: unknown }).code == null ? undefined : String((e as { code?: unknown }).code),
      stack: e.stack?.slice(0, 1500),
    };
  }
  if (typeof e === 'string') return { message: e };
  if (e && typeof e === 'object') {
    const value = e as { message?: unknown; code?: unknown; stack?: unknown };
    if (typeof value.message === 'string') return {
      message: value.message,
      code: value.code == null ? undefined : String(value.code),
      stack: typeof value.stack === 'string' ? value.stack.slice(0, 1500) : undefined,
    };
  }
  try {
    return { message: (JSON.stringify(e) ?? String(e)).slice(0, 500) };
  } catch {
    return { message: String(e) };
  }
}

// Network failures remain visible, tagged as transient instead of discarded.
// Existing coalescing and per-signature delivery limits constrain repeated noise.
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  'unavailable',
  'deadline-exceeded',
  'cancelled',
  'functions/unavailable',
  'functions/deadline-exceeded',
  'functions/cancelled',
  'auth/network-request-failed',
  'auth/timeout',
]);

// Keep signed-out denials distinguishable from a permission regression in an
// authenticated session. Delivery still requires an authenticated session.
const DENIED_CODES: ReadonlySet<string> = new Set([
  'permission-denied',
  'unauthenticated',
  'functions/permission-denied',
  'functions/unauthenticated',
]);

function isSignedOutDenial(code: string | undefined, uid: string | undefined): boolean {
  return !uid && !!code && DENIED_CODES.has(code);
}

function isTransientEnvError(code?: string, message?: string): boolean {
  if (code && TRANSIENT_CODES.has(code)) return true;
  // Fallback for errors that arrive without a `code` (raw FirebaseError, or a
  // native SDK reporting through a string), matched on the stable sentinels
  // each platform uses for "there is no network".
  const m = (message ?? '').toLowerCase();
  return (
    m.includes('client is offline') ||
    m.includes('network request failed') ||
    // Android's DNS failure, verbatim: 'Unable to resolve host "x": No address
    // associated with hostname'. Logged once on 29.09 as a Joryio push-token
    // bug; the host resolves fine and returns 200 from anywhere with a
    // network. It is a dead zone, every time.
    m.includes('unable to resolve host') ||
    m.includes('no address associated with hostname') ||
    // iOS / NSURLError equivalents.
    m.includes('the internet connection appears to be offline') ||
    m.includes('a server with the specified hostname could not be found') ||
    m.includes('could not connect to the server')
  );
}

function safeContext(ctx?: ErrorContext): Record<string, unknown> {
  return redactDiagnosticContext(ctx);
}

function currentUid(): string | undefined {
  try {
    return getFirebase().auth.currentUser?.uid ?? undefined;
  } catch {
    return undefined;
  }
}

// ── human-friendly labelling ───────────────────────────────────────
// A Hebrew title per operation so the raw Firestore doc (and the admin
// panel) reads clearly — "what the user was trying to do". Unknown ops
// fall back to a generic phrasing that still carries the raw label.
const OP_TITLES: Record<string, string> = {
  // auth
  signInGoogle: 'התחברות עם Google נכשלה',
  signInGoogleScreen: 'התחברות עם Google נכשלה',
  signInApple: 'התחברות עם Apple נכשלה',
  signInAppleScreen: 'התחברות עם Apple נכשלה',
  signOut: 'התנתקות נכשלה',
  deleteAccount: 'מחיקת חשבון נכשלה',
  createUserDoc: 'יצירת כרטיס שחקן נכשלה',
  completeOnboarding: 'סיום ההרשמה נכשל',
  updateProfile: 'עדכון כרטיס שחקן נכשל',
  saveAvailability: 'שמירת זמינות נכשלה',
  // games
  createGame: 'יצירת משחק נכשלה',
  joinGame: 'הצטרפות למשחק נכשלה',
  cancelGame: 'ביטול הרשמה למשחק נכשל',
  leaveGame: 'עזיבת משחק נכשלה',
  approveGameJoin: 'אישור הצטרפות למשחק נכשל',
  rejectGameJoin: 'דחיית הצטרפות למשחק נכשלה',
  confirmSpotOffer: 'אישור הצעת מקום נכשל',
  passSpotOffer: 'העברת הצעת מקום נכשלה',
  reloadGamesList: 'טעינת רשימת המשחקים נכשלה',
  gamesListAction: 'פעולה ברשימת המשחקים נכשלה',
  getMyGames: 'טעינת "המשחקים שלי" נכשלה',
  getOpenGames: 'טעינת משחקים פתוחים נכשלה',
  getCommunityGames: 'טעינת משחקי המועדון נכשלה',
  addGuest: 'הוספת אורח למשחק נכשלה',
  inviteToGame: 'הזמנה למשחק נכשלה',
  // community
  createGroup: 'יצירת מועדון נכשלה',
  joinGroup: 'הצטרפות למועדון נכשלה',
  leaveGroup: 'עזיבת מועדון נכשלה',
  removeMember: 'הסרת חבר מהמועדון נכשלה',
  approveMember: 'אישור חבר במועדון נכשל',
  rejectMember: 'דחיית חבר במועדון נכשלה',
  inviteFriendsToGroup: 'הזמנת חברים למועדון נכשלה',
  updateGroupMetadata: 'עדכון פרטי המועדון נכשל',
  // ratings / friends / notifications
  ratePlayer: 'דירוג שחקן נכשל',
  registerDeviceToken: 'רישום להתראות נכשל',
  requestAndRegisterPushToken: 'בקשת הרשאת התראות נכשלה',
  saveNotificationPreferences: 'שמירת העדפות התראות נכשלה',
  // silent failures (expectation violated, nothing threw)
  gameVanishedAfterJoin: 'משחק נעלם אחרי שהמשתמש נרשם אליו',
  joinNotReflectedInMatch: 'ההרשמה למשחק לא הופיעה במסך',
  communityJoinNotReflected: 'ההצטרפות למועדון לא הופיעה',
  joinDidNotAddUser: 'הרשמה למשחק לא הוסיפה את המשתמש',
  cancelDidNotRemoveUser: 'ביטול הרשמה לא הסיר את המשתמש',
  joinGroupDidNotApply: 'הצטרפות למועדון לא נשמרה',
  leaveGroupDidNotRemoveUser: 'עזיבת מועדון לא הסירה את המשתמש',
  removeMemberDidNotApply: 'הסרת חבר לא נשמרה',
  createGameCreatorNotRegistered: 'יוצר המשחק לא נרשם אוטומטית',
  // crashes / global
  uncaught: 'קריסה לא צפויה באפליקציה',
  uncaughtRender: 'שגיאת תצוגה — מסך קרס',
  unhandledRejection: 'שגיאה אסינכרונית לא מטופלת',
};

type ErrorCategory = 'silent' | 'crash' | 'action';

function categoryFor(operation: string, silent: boolean): ErrorCategory {
  if (silent) return 'silent';
  if (
    operation === 'uncaught' ||
    operation === 'uncaughtRender' ||
    operation === 'unhandledRejection'
  ) {
    return 'crash';
  }
  return 'action';
}

function titleFor(operation: string, category: ErrorCategory): string {
  const known = OP_TITLES[operation];
  if (known) return known;
  const prefix =
    category === 'silent'
      ? 'פעולה לא עבדה כצפוי'
      : category === 'crash'
        ? 'קריסה'
        : 'פעולה נכשלה';
  return `${prefix} · ${operation}`;
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
  captured?: { uid?: string; trail: string; journal: string },
): void {
  try {
    const objects = errorCauseObjects(error);
    if (objects.some(object => reportedObjects.has(object))) return;
    const info = errInfo(error);
    const message = redactDiagnosticText(info.message).slice(0,2000);
    const code = typeof info.code === 'string' ? redactDiagnosticText(info.code).slice(0,100) : undefined;
    const stack = info.stack ? redactDiagnosticText(info.stack).slice(0,1500) : undefined;
    operation = redactDiagnosticText(operation).slice(0,100);
    // Preserve environment failures with explicit classification.
    const transient = isTransientEnvError(code, message);
    const uid = currentUid();
    // A signed-out denial is retained with its cause, not silently discarded.
    const signedOutDenial = isSignedOutDenial(code, uid);
    context = { ...caughtErrorOrigin(error), ...context, ...(transient ? { transient: true } : {}), ...(signedOutDenial ? { signedOutDenial: true } : {}) };
    // On the report trail too — a failure is a step, and "the tap DID reach
    // something, and that something failed" is a different story from a tap
    // that reached nothing. The operation name only; the message, the stack
    // and the context stay here.
    crumbErr(operation);
    const fp = djb2(`${operation}|${normalize(message)}`);
    // Runaway guard: once this signature has been written SESSION_WRITE_CAP
    // times this session, stop buffering it (protects a single hot doc).
    const currentScreen = context?.screen ?? diagnosticReportScreen();
    const screen = typeof currentScreen === 'string' ? redactDiagnosticText(currentScreen).slice(0,100) : undefined;
    const existing = buffer.get(fp);
    // Auth may switch just before App's ownership effect runs. Never attach
    // the previous account's actions in that narrow transition window.
    const owner=diagnosticOwner();
    const sameOwner=owner===undefined||owner===uid;
    const capturedMatches = captured && captured.uid === uid;
    const trail=sameOwner?redactDiagnosticText(capturedMatches ? captured.trail : formatTrail()).slice(-6000):'';
    const journal=sameOwner?(capturedMatches ? captured.journal : diagnosticAttachment()):'';
    if (existing) {
      existing.pending += 1;
      existing.message = message;
      existing.code = code;
      existing.stack = stack;
      existing.context = safeContext(context);
      existing.userId = uid;
      existing.screen = screen;
      existing.trail=trail;existing.journal=journal;existing.version=appVersion;
    } else {
      buffer.set(fp, {
        operation,
        message,
        code,
        stack,
        context: safeContext(context),
        userId: uid,
        screen,
        pending: 1,
        trail, journal, version:appVersion,
      });
    }
    persistPending();
    if ((flushedPerFp.get(fp) ?? 0) < SESSION_WRITE_CAP) scheduleFlush();
    for (const object of objects) reportedObjects.add(object);
    reportCrashlyticsError({
      operation, message, code, stack,
      source: typeof context.source === 'string' ? context.source : undefined,
      handler: typeof context.handler === 'string' ? context.handler : undefined,
      site: typeof context.site === 'string' ? context.site : undefined,
      isFatal: context.isFatal === true,
    });
  } catch {
    // logging must never throw
  }
}

/**
 * Record a SILENT failure — the user performed an action and the EXPECTED
 * outcome did not happen, yet nothing threw (e.g. a game the user joined that
 * then appears in no list). These are post-condition violations, not crashes.
 *
 * Call ONLY when an expectation is actually violated (compute the check in
 * memory first — it's free — and call this only on the rare miss). Buckets by
 * `operation`; the entry carries `silent: true` so the admin panel can show
 * "didn't work as expected" separately from thrown errors/crashes.
 */
export function logUnexpected(operation: string, context?: ErrorContext): void {
  // ⚠️ The error handed to `logError` carries the OPERATION as its message,
  // so `isTransientEnvError` — which reads the error's code and message — can
  // never match on it. By construction every silent report got through the
  // filter, including the ones whose cause was plainly "no network".
  //
  // Seen on 29.09: `joryioRegisterPushToken` filed as a bug, with the real
  // cause sitting untouched in the context — 'Unable to resolve host
  // "api-eu1.joryio.com"'. The host resolves and answers 200; the phone had no
  // network. So the CONTEXT's own message gets the same test the error's would
  // have, and a silent report whose cause is a dead zone is dropped like any
  // other transient blip.
  //
  // Only `context.message`, deliberately: it is where every caller already
  // puts the underlying failure, and widening it to the whole serialised
  // context would start matching on screen names and ids.
  const cause = typeof context?.message === 'string' ? context.message : '';
  logError(operation, new Error(operation), { ...(context ?? {}), silent: true, ...(cause && isTransientEnvError(undefined, cause) ? { transient: true } : {}) });
}

// Existing explicit logError calls get first choice of the operation/context.
// The fallback runs after the catch, with its source attached. No network work
// is awaited by the application operation, and a rethrown Error is counted once.
installCaughtErrorSink((error, origin) => {
  const generation = ownerGeneration;
  const captured = {uid: currentUid(), trail: formatTrail(), journal: diagnosticAttachment()};
  const screen = diagnosticReportScreen();
  void Promise.resolve().then(() => {
    if (generation === ownerGeneration) logError(`caught:${origin.site}`, error, {...origin, screen}, captured);
  });
});

/**
 * True for failures that are EXPECTED outcomes of a best-effort write, not
 * bugs: a rules denial on a cross-user / non-member write (the server or a
 * different path handles it), or a transient network/offline/timeout hiccup
 * the user simply retries. Use to skip logError on best-effort writes so the
 * admin panel only surfaces genuine failures.
 */
export function isExpectedDenial(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code ?? '').toLowerCase();
  return (
    code === 'permission-denied' ||
    code === 'unauthenticated' ||
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'cancelled' ||
    code === 'resource-exhausted' ||
    code.includes('app-check')
  );
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
        persistPending(true);
        void persistDiagnosticJournal();
        // Flush synchronously-ish before a fatal tears the JS context down.
        void flush();
        if (prev) prev(error, isFatal);
      });
      g.__errorLogInstalled = true;
    }
  } catch {
    // never block startup
  }
  // Hermes uses its own Promise in RN 0.79; the polyfill tracker cannot see
  // those rejections. Use the runtime hook first, with the same option shape.
  try {
    const options = {
      allRejections: true,
      onUnhandled: (_id: unknown, error: unknown) =>
        logError('unhandledRejection', error),
      onHandled: () => {},
    };
    const hermes = (global as unknown as {
      HermesInternal?: {
        hasPromise?: () => boolean;
        enablePromiseRejectionTracker?: (config: typeof options) => void;
      };
    }).HermesInternal;
    if (hermes?.hasPromise?.() && hermes.enablePromiseRejectionTracker) {
      // RN already installs its LogBox tracker in development. Keep it intact;
      // release Hermes has no built-in tracker and needs ours.
      if (typeof __DEV__ === 'undefined' || !__DEV__) hermes.enablePromiseRejectionTracker(options);
    } else {
      // Same pinned promise instance as React Native's non-Hermes Promise.
      const tracking = require('promise/setimmediate/rejection-tracking');
      tracking.enable(options);
    }
  } catch {
    // polyfill not present / different RN internals — skip
  }
}

export async function flush(): Promise<void> {
  if (inFlush || buffer.size === 0 && delivering.size === 0) return;
  inFlush = true;
  const generation = ownerGeneration;
  let functions;
  try {
    functions = getFirebase().functions; // throws in mock mode → skip silently
    if (!currentUid()) { inFlush=false; scheduleFlush(); return; }
  } catch {
    inFlush = false;
    return;
  }
  for (const [fp, live] of buffer) {
    if (live.pending <= 0) continue;
    if ((flushedPerFp.get(fp) ?? 0) >= SESSION_WRITE_CAP) continue;
    if (!live.userId) live.userId = currentUid();
    if (live.userId !== currentUid()) { buffer.delete(fp); continue; }
    const deliveryId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    delivering.set(deliveryId, {...live, deliveryId});
    buffer.delete(fp);
  }
  persistPending(true);
  for (const [deliveryId, e] of [...delivering]) {
    if(generation!==ownerGeneration)break;
    // Freeze the occurrence before awaiting a write; later navigation/errors
    // cannot change the journal paired with this error.
    // A pre-auth error can be sent once this process has its first session.
    // Ownerless records from a previous process are never restored to a new user.
    const delta = e.pending;
    const fp = djb2(`${e.operation}|${normalize(e.message)}`);
    if(e.userId!==currentUid()){delivering.delete(deliveryId);continue;}
    const silent = e.context?.silent === true;
    const category = categoryFor(e.operation, silent);
    const common = {
      operation: e.operation,
      // Self-describing fields so both the raw doc and the panel read well:
      title: titleFor(e.operation, category), // friendly Hebrew "what happened"
      category, // 'silent' | 'crash' | 'action' — drives the panel badge
      lastMessage: e.message,
      lastCode: e.code ?? null,
      lastStack: e.stack ?? null,
      lastContext: e.context,
      lastTrail: e.trail,
      lastJournal: e.journal,
      lastUserId: e.userId ?? null,
      lastScreen: e.screen ?? null,
      platform: Platform.OS,
      osVersion: String(Platform.Version ?? ''),
      appVersion:e.version,
    };
    try {
      await httpsCallable(functions,'recordClientError')({...common,count:delta,deliveryId});
      if(generation===ownerGeneration)flushedPerFp.set(fp, (flushedPerFp.get(fp) ?? 0) + 1);
      delivering.delete(deliveryId);
    } catch {
      if(generation!==ownerGeneration||e.userId!==currentUid()){delivering.delete(deliveryId);continue;}
      // Never fall back to the insecure direct-write path.
    }
  }
  inFlush = false;
  persistPending(true);
  if(delivering.size || [...buffer].some(([fp,e])=>e.pending>0 && (flushedPerFp.get(fp)??0)<SESSION_WRITE_CAP))scheduleFlush();
}
