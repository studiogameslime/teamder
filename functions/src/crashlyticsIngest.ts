import { createHash } from 'node:crypto';
import { getFirestore, Timestamp, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { redactDiagnosticText } from './diagnosticRedaction';

type ObjectMap = Record<string, any>;
export type CrashEvent = {
  receiptId: string; fingerprint: string; appId: string; issueId: string;
  eventId: string; occurredAt: number; receivedAt: number; title: string;
  message: string; stack: string; platform: string; version: string;
  userId: string; model: string; osVersion: string; url: string; isTest: boolean;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const text = (value: unknown, max = 500) => typeof value === 'string' ? redactDiagnosticText(value).slice(0, max) : '';

/** Accept only the provider's event stream, this project and this package.
 * Nonfatal JS reports already enter Pulse through recordClientError. */
export function parseCrashEntry(entry: ObjectMap, project: string): CrashEvent | null {
  if (entry.logName !== `projects/${project}/logs/firebasecrashlytics.googleapis.com%2Fevents`) return null;
  const p = entry.jsonPayload;
  if (!p || p.bundleOrPackage !== 'com.studiogameslime.soccerapp' || !['FATAL', 'ANR'].includes(p.issue?.errorType)) return null;
  const match = typeof p.name === 'string' ? p.name.match(/^projects\/([^/]+)\/apps\/([^/]+)\/events\/([^/]+)$/) : null;
  if (!match || ![project, '559368532219'].includes(match[1]) || !p.eventId || !p.issue?.id || match[3] !== p.eventId) throw new Error('Invalid Crashlytics event identity');
  if (!['ANDROID', 'IOS'].includes(p.platform)) return null;
  const occurredAt = Date.parse(p.eventTime), receivedAt = Date.parse(p.receivedTime);
  if (!Number.isFinite(occurredAt) || !Number.isFinite(receivedAt)) throw new Error('Invalid Crashlytics event time');
  const appId = match[2], issueId = String(p.issue.id), eventId = String(p.eventId);
  const message = text(p.issueSubtitle || p.issue.subtitle || p.exceptions?.[0]?.exceptionMessage || p.issue.errorType, 2000);
  const frames = [...(Array.isArray(p.exceptions) ? p.exceptions : []), ...(Array.isArray(p.threads) ? p.threads.filter((t: ObjectMap) => t.crashed || t.blamed) : [])]
    .flatMap((e: ObjectMap) => Array.isArray(e.frames) ? e.frames : []).slice(0, 60);
  const stack = frames.map((f: ObjectMap) => `${text(f.symbol, 180)} (${text(f.file, 120)}:${text(String(f.line ?? ''), 12)})`).join('\n').slice(0, 10000);
  const isTest = message.includes('Crash Test');
  const url = `https://console.firebase.google.com/project/${encodeURIComponent(project)}/crashlytics/app/${p.platform === 'IOS' ? 'ios' : 'android'}:com.studiogameslime.soccerapp/issues/${encodeURIComponent(issueId)}`;
  return {
    receiptId: hash(`${appId}|${eventId}`), fingerprint: hash(`crashlytics|${appId}|${issueId}`).slice(0, 32),
    appId, issueId, eventId, occurredAt, receivedAt, message, stack, isTest, url,
    title: isTest ? 'בדיקת קריסה יזומה' : p.issue.errorType === 'ANR' ? 'האפליקציה הפסיקה להגיב' : 'האפליקציה קרסה',
    platform: p.platform.toLowerCase(), version: [text(p.version?.displayVersion, 40), text(p.version?.buildVersion, 40)].filter(Boolean).join(' / '),
    userId: typeof p.user?.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(p.user.id) ? p.user.id : '',
    model: text(p.device?.model, 100), osVersion: text(p.operatingSystem?.displayVersion || p.operatingSystem?.version, 100),
  };
}

/** One durable receipt per provider event; aggregate in the existing work inbox.
 * A delayed old event must never overwrite the current device/user metadata. */
export async function importCrash(event: CrashEvent, db: Firestore = getFirestore(), now = Date.now()): Promise<boolean> {
  const receipt = db.collection('crashlyticsEvents').doc(event.receiptId);
  const issue = db.collection('errors').doc(event.fingerprint);
  return db.runTransaction(async tx => {
    const [seen, snapshot] = await Promise.all([tx.get(receipt), tx.get(issue)]);
    if (seen.exists) return false;
    const old = snapshot.data() ?? {};
    const previousAt = old.lastSeen?.toMillis?.() ?? Number(old.lastSeen ?? 0);
    const current = !snapshot.exists || event.occurredAt >= previousAt;
    const reopen = old.status === 'resolved' && event.occurredAt > previousAt;
    const notify = !snapshot.exists || (current && (reopen || now - Number(old.lastCrashAlertAt ?? 0) >= 60_000));
    const firstAt = old.firstSeen?.toMillis?.() ?? Number(old.firstSeen ?? event.occurredAt);
    tx.set(issue, {
      source: 'crashlytics', category: 'crash', operation: 'nativeCrash', fingerprint: event.fingerprint,
      count: FieldValue.increment(1), firstSeen: Timestamp.fromMillis(Math.min(firstAt, event.occurredAt)),
      ...(!snapshot.exists ? { status: 'new' } : {}),
      ...(reopen ? { status: 'new', claudeStatus: '', unresolved: false, reviewReason: 'התקבלה קריסה חדשה אחרי שהתקלה נסגרה.' } : {}),
      ...(notify ? { lastCrashAlertAt: now } : {}),
      ...(current ? {
        title: event.title, lastMessage: `${event.message}\n${event.url}`, lastStack: event.stack,
        lastSeen: Timestamp.fromMillis(event.occurredAt), lastUserId: event.userId,
        platform: event.platform, osVersion: event.osVersion, appVersion: event.version,
        lastContext: { source: 'crashlytics', appId: event.appId, issueId: event.issueId, eventId: event.eventId,
          model: event.model, reportUrl: event.url, receivedAt: event.receivedAt, isTest: event.isTest },
      } : {}),
    }, { merge: true });
    tx.create(receipt, {
      fingerprint: event.fingerprint, eventId: event.eventId, appId: event.appId,
      occurredAt: event.occurredAt, receivedAt: event.receivedAt, importedAt: now,
      title: event.title, message: event.message.slice(0, 160), version: event.version,
      alertState: notify ? 'pending' : 'coalesced', delivered: [], invalid: [],
      expiresAt: Timestamp.fromMillis(now + 90 * 86400000),
    });
    return true;
  });
}

/** Retriable outbox. Successful token deliveries are checkpointed separately
 * from ingestion. Transport acceptance is not proof of display on a handset. */
export async function deliverCrashAlerts(db: Firestore = getFirestore()): Promise<{ sent: number; pending: number }> {
  const pending = await db.collection('crashlyticsEvents').where('alertState', '==', 'pending').limit(100).get();
  if (pending.empty) return { sent: 0, pending: 0 };
  const [prefs, config] = await Promise.all([db.doc('adminConfig/prefs').get(), db.doc('adminConfig/push').get()]);
  const tokens = [...new Set((config.data()?.tokens ?? []).filter((t: unknown): t is string => typeof t === 'string' && t.length > 0))] as string[];
  let sent = 0, waiting = 0;
  for (const doc of pending.docs) {
    const data = doc.data();
    if (prefs.data()?.error === false) { await doc.ref.update({ alertState: 'muted' }); continue; }
    const delivered = new Set<string>(data.delivered ?? []), invalid = new Set<string>(data.invalid ?? []);
    const targets = tokens.filter(t => !delivered.has(hash(t)) && !invalid.has(hash(t)));
    if (!tokens.length || (!targets.length && !delivered.size)) { ++waiting; continue; }
    for (let i = 0; i < targets.length; i += 500) {
      const chunk = targets.slice(i, i + 500);
      const result = await getMessaging().sendEachForMulticast({
        tokens: chunk, notification: { title: `💥 ${data.title}`, body: `${data.version || 'גרסה לא ידועה'} · ${data.message}`.slice(0, 250) },
        data: { type: 'error', fp: data.fingerprint },
        android: { priority: 'high', notification: { sound: 'default' } }, apns: { payload: { aps: { sound: 'default' } } },
      });
      result.responses.forEach((response, index) => {
        const id = hash(chunk[index]);
        if (response.success) { delivered.add(id); ++sent; }
        else if (response.error?.code === 'messaging/registration-token-not-registered') invalid.add(id);
      });
      await doc.ref.update({ delivered: [...delivered], invalid: [...invalid], lastAttemptAt: Date.now() });
    }
    const complete = tokens.every(t => delivered.has(hash(t)) || invalid.has(hash(t))) && delivered.size > 0;
    if (complete) await doc.ref.update({ alertState: 'sent', sentAt: Date.now() });
    else ++waiting;
  }
  return { sent, pending: waiting };
}
