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
import { diagnosticAttachment, diagnosticOwner } from './diagnosticJournal';
import { readPendingDiagnosticErrors, savePendingDiagnosticErrors, persistDiagnosticJournal } from './diagnosticStorage';
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
  trail: string;
  journal: string;
  version: string;
}

const FLUSH_MS = 12000; // coalesce window
// Hard ceiling on DB writes per unique signature per app session. Coalescing
// already caps a bug to ~1 write / 12s / device; this additionally bounds a
// device stuck in a bad state all day so it can't hammer one `errors/{fp}`
// doc indefinitely. After the cap, occurrences are dropped (count freezes) —
// 30 writes is plenty to know "this happens a lot" while protecting the DB.
const SESSION_WRITE_CAP = 30;
const buffer = new Map<string, Buffered>();
// Keep unacknowledged writes on disk even while their network request is pending.
const delivering = new Map<string, Buffered>();
let ownerGeneration = 0;
const flushedPerFp = new Map<string, number>(); // writes done this session, by fp
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlush = false;

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
  const rows=new Map<string,Buffered>(delivering);
  for(const [fp,entry] of buffer){if(entry.pending>0)rows.set(fp,{...entry,pending:entry.pending+(delivering.get(fp)?.pending??0)});}
  void savePendingDiagnosticErrors([...rows].map(([fp,entry])=>({fp,entry})));
 };
 if(immediate)save();else pendingTimer=setTimeout(save,250);
}
export function clearPendingErrors():void {
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
  if(!buffer.has(fp))buffer.set(fp,entry);else buffer.get(fp)!.pending+=entry.pending;
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

// ── transient-error filter ─────────────────────────────────────────
// Environmental blips — the device lost connectivity, a request timed out,
// or an auth token momentarily lapsed — are NOT actionable code bugs. They
// used to land in the `errors` dev-inbox as "פעולה נכשלה · <op>" noise (a
// user walking into a dead-zone mid-tap), one doc each, drowning real
// regressions. Skip logging them: the operation already failed gracefully
// (every call site is wrapped), and there is nothing to fix in the app.
// Deliberately NARROW — only unambiguously network/offline/timeout codes.
// `unauthenticated` is intentionally EXCLUDED (it can signal a real
// auth-gating regression, not just a token race), so it still gets logged.
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

// ── signed-out denial filter ───────────────────────────────────────
// EVERY rule in firestore.rules begins with isSignedIn(). So a
// `permission-denied` / `unauthenticated` raised while NO session exists is
// the expected outcome of a read fired by a signed-out session — not a bug,
// and nothing in the app can be fixed for it. withAuthRaceRetry already
// distinguishes the two cases: it retries the cold-start race and rethrows
// early on `if (!user) throw err; // genuinely signed out`, which is the only
// path that reaches here with no uid.
//
// Deliberately conditional on there being NO uid: when a session DOES exist,
// a denial still gets logged, so a real rules regression keeps surfacing.
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
): void {
  try {
    const info = errInfo(error);
    const message = info.message.slice(0,2000), code = info.code, stack = info.stack;
    // Drop transient network/offline/timeout blips — not actionable bugs,
    // just dead-zone noise in the dev inbox (see isTransientEnvError).
    if (isTransientEnvError(code, message)) return;
    const uid = currentUid();
    // A denial with no session at all is an expected outcome, not a bug.
    if (isSignedOutDenial(code, uid)) return;
    // On the report trail too — a failure is a step, and "the tap DID reach
    // something, and that something failed" is a different story from a tap
    // that reached nothing. The operation name only; the message, the stack
    // and the context stay here.
    crumbErr(operation);
    const fp = djb2(`${operation}|${normalize(message)}`);
    // Runaway guard: once this signature has been written SESSION_WRITE_CAP
    // times this session, stop buffering it (protects a single hot doc).
    if ((flushedPerFp.get(fp) ?? 0) >= SESSION_WRITE_CAP) return;
    const screen = context?.screen as string | undefined;
    const existing = buffer.get(fp);
    // Auth may switch just before App's ownership effect runs. Never attach
    // the previous account's actions in that narrow transition window.
    const owner=diagnosticOwner();
    const sameOwner=owner===undefined||owner===uid;
    const trail=sameOwner?formatTrail().slice(-6000):'';
    const journal=sameOwner?diagnosticAttachment():'';
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
    scheduleFlush();
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
  if (cause && isTransientEnvError(undefined, cause)) return;
  logError(operation, new Error(operation), { ...(context ?? {}), silent: true });
}

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
  const generation = ownerGeneration;
  let db;
  try {
    db = getFirebase().db; // throws in mock mode → skip silently
  } catch {
    inFlush = false;
    return;
  }
  const entries = [...buffer.entries()].filter(([, e]) => e.pending > 0);
  for (const [fp, live] of entries) {
    if(generation!==ownerGeneration)break;
    // Freeze the occurrence before awaiting a write; later navigation/errors
    // cannot change the journal paired with this error.
    const e={...live};
    const delta = e.pending;
    live.pending = 0;
    if(e.userId!==currentUid())continue;
    delivering.set(fp,e);
    persistPending(true);
    const ref = doc(db, 'errors', fp);
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
      lastSeen: serverTimestamp(),
    };
    try {
      // Increment an existing signature…
      await updateDoc(ref, { ...common, count: increment(delta) });
      if(generation===ownerGeneration)flushedPerFp.set(fp, (flushedPerFp.get(fp) ?? 0) + 1);
    } catch {
      if(generation!==ownerGeneration||e.userId!==currentUid()){delivering.delete(fp);continue;}
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
        if(generation===ownerGeneration)flushedPerFp.set(fp, (flushedPerFp.get(fp) ?? 0) + 1);
      } catch {
        if(generation===ownerGeneration)live.pending += delta; // retry only in the original account
      }
    }
    delivering.delete(fp);
  }
  inFlush = false;
  persistPending(true);
  if([...buffer.values()].some(e=>e.pending>0))scheduleFlush();
}
