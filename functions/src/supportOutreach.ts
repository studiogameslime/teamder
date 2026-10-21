import { observeCaughtError } from './serverErrorLog';
import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentWritten } from './observedFunctions';
import { onSchedule } from './observedFunctions';
import { nextOutreachTime, outreachEligible, outreachText, readOutreachConfig } from './supportOutreachPolicy';

const configPath = 'adminConfig/supportOutreach';
const jobs = 'supportOutreach';
const ms = (value: unknown): number => typeof value === 'number' ? value : value && typeof (value as any).toMillis === 'function' ? (value as any).toMillis() : 0;

export async function enrollClubOutreach(clubId: string, createdAt: number): Promise<void> {
  const db = admin.firestore(), group = (await db.doc(`groups/${clubId}`).get()).data();
  if (!group || group.isPersonal === true || typeof group.creatorId !== 'string') return;
  const userId = group.creatorId, user = (await db.doc(`users/${userId}`).get()).data();
  const config = readOutreachConfig((await db.doc(configPath).get()).data());
  if (!user || user.isGuest === true) return;
  let account: admin.auth.UserRecord;
  try { account = await admin.auth().getUser(userId); }
  catch (error) {
    observeCaughtError(error, {"source":"functions/src/supportOutreach.ts","handler":"enrollClubOutreach","site":"supportOutreach:5b9f57f502"}); if ((error as { code?: string }).code === 'auth/user-not-found') return; throw error; }
  const registeredAt = Date.parse(account.metadata?.creationTime ?? '') || ms(user.createdAt);
  if (account.disabled || !outreachEligible(registeredAt, createdAt, config)) return;
  const clubs = await db.collection('groups').where('creatorId', '==', userId).get();
  const first = clubs.docs.filter(doc => doc.data().isPersonal !== true).sort((a, b) => (ms(a.data().createdAt) || a.createTime.toMillis()) - (ms(b.data().createdAt) || b.createTime.toMillis()) || a.id.localeCompare(b.id))[0];
  if (!first || first.id !== clubId) return;
  const ref = db.collection(jobs).doc(userId);
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.exists) return; // one enrollment, across retries and later clubs
    tx.create(ref, { userId, userName: String(user.name || ''), clubId, clubName: String(group.name || ''),
      createdAt, registeredAt, status: 'pending', attempts: 0,
      scheduledAt: nextOutreachTime(createdAt + config.delayHours * 3600_000, config, user.timeZone),
      messageId: `tm-outreach-${userId}` });
  });
}

export async function sendClubOutreach(userId: string, now = Date.now()): Promise<string> {
  const db = admin.firestore(), ref = db.collection(jobs).doc(userId);
  let accountUnavailable = false, registeredAt = 0;
  try { const account = await admin.auth().getUser(userId); accountUnavailable = account.disabled; registeredAt = Date.parse(account.metadata?.creationTime ?? '') || 0; }
  catch (error) {
    observeCaughtError(error, {"source":"functions/src/supportOutreach.ts","handler":"sendClubOutreach","site":"supportOutreach:855a1aeadb"}); if ((error as { code?: string }).code === 'auth/user-not-found') accountUnavailable = true; else throw error; }
  const convId = [userId, 'teamder'].sort().join('__'), conv = db.doc(`dmConversations/${convId}`);
  return db.runTransaction(async tx => {
    const [jobSnap, configSnap, userSnap, convSnap] = await tx.getAll(ref, db.doc(configPath), db.doc(`users/${userId}`), conv);
    const job = jobSnap.data(), config = readOutreachConfig(configSnap.data());
    if (!job || job.status !== 'pending' || !config.enabled) return 'paused';
    const user = userSnap.data();
    const groupSnap = await tx.get(db.doc(`groups/${job.clubId}`)), group = groupSnap.data();
    let reason = accountUnavailable || !user || user.isGuest === true ? 'user_unavailable' : !group ? 'club_deleted' : !Array.isArray(group.adminIds) || !group.adminIds.includes(userId) ? 'no_longer_admin' : !outreachEligible(registeredAt || job.registeredAt || ms(user.createdAt), job.createdAt, config) ? 'not_new_user' : '';
    if ((convSnap.data()?.supportLastHumanAt ?? 0) >= job.createdAt) reason = 'human_support_exists';
    if (reason) { tx.update(ref, { status: 'skipped', reason, updatedAt: now, scheduledAt: admin.firestore.FieldValue.delete() }); return reason; }
    const at = nextOutreachTime(Math.max(now, job.createdAt + config.delayHours * 3600_000), config, user?.timeZone);
    if (at > now) { tx.update(ref, { scheduledAt: at }); return 'waiting'; }
    const rounds = await tx.get(db.collection('games').where('groupId', '==', job.clubId).limit(1));
    const recent = await tx.get(conv.collection('messages').orderBy('createdAt', 'desc').limit(100));
    if (recent.docs.some(doc => doc.data().senderId === 'teamder' && doc.data().supportOrigin !== 'club_onboarding' && ms(doc.data().createdAt) >= job.createdAt)) {
      tx.update(ref, { status: 'skipped', reason: 'human_support_exists', updatedAt: now, scheduledAt: admin.firestore.FieldValue.delete() }); return 'human_support_exists';
    }
    const messageRef = conv.collection('messages').doc(job.messageId), existing = await tx.get(messageRef);
    if (!existing.exists) {
      const text = outreachText(config, user?.name, group?.name, group?.playerIds?.length ?? 1, !rounds.empty);
      tx.set(conv, { participants: [userId, 'teamder'].sort(), updatedAt: now }, { merge: true });
      tx.create(messageRef, { senderId: 'teamder', senderName: 'Teamder', senderPhotoUrl: 'https://teamderfc.web.app/logo.png', text, createdAt: now, supportOrigin: 'club_onboarding' });
    }
    tx.update(ref, { status: 'sent', userName: String(user?.name || ''), clubName: String(group?.name || ''), sentAt: now, updatedAt: now, scheduledAt: admin.firestore.FieldValue.delete() });
    return 'sent';
  });
}

export async function runClubOutreach(now = Date.now()): Promise<void> {
  const db = admin.firestore(), config = readOutreachConfig((await db.doc(configPath).get()).data());
  if (!config.enabled) return;
  const due = await db.collection(jobs).where('scheduledAt', '<=', now).orderBy('scheduledAt').limit(100).get();
  for (const job of due.docs) {
    try { await sendClubOutreach(job.id, now); }
    catch (error) {
    observeCaughtError(error, {"source":"functions/src/supportOutreach.ts","handler":"runClubOutreach","site":"supportOutreach:e9333bb5ae"});
      console.error('[supportOutreach] send failed', { userId: job.id }, error);
      await db.runTransaction(async tx => {
        const snap = await tx.get(job.ref), data = snap.data();
        if (data?.status !== 'pending') return;
        const attempts = (data.attempts ?? 0) + 1;
        tx.update(job.ref, { attempts, reason: 'send_failed', updatedAt: now,
          ...(attempts >= 5 ? { status: 'failed', scheduledAt: admin.firestore.FieldValue.delete() } : { scheduledAt: now + Math.min(60, 5 * 2 ** attempts) * 60_000 }) });
      });
    }
  }
}

export async function rescheduleClubOutreach(): Promise<void> {
  const db = admin.firestore(); let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db.collection(jobs).where('status', '==', 'pending').orderBy(admin.firestore.FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const job of page.docs) await db.runTransaction(async tx => {
      const [current, cfg, user] = await tx.getAll(job.ref, db.doc(configPath), db.doc(`users/${job.id}`));
      const data = current.data(), config = readOutreachConfig(cfg.data());
      if (data?.status === 'pending') tx.update(job.ref, { scheduledAt: nextOutreachTime(data.createdAt + config.delayHours * 3600_000, config, user.data()?.timeZone) });
    });
    if (page.size < 100) break; cursor = page.docs[page.docs.length - 1];
  }
}

export const onSupportClubCreated = onDocumentCreated('groups/{clubId}', async event => {
  if (event.data) await enrollClubOutreach(event.params.clubId, event.data.createTime.toMillis());
});
export const onSupportOutreachConfigChanged = onDocumentWritten(configPath, async () => { await rescheduleClubOutreach(); });
export const cronSupportOutreach = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Asia/Jerusalem', timeoutSeconds: 300 }, async () => { await runClubOutreach(); });
