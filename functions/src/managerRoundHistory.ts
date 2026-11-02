import {createHash} from 'crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {onCall, onDocumentWritten, HttpsError} from './observedFunctions';
import {ENFORCE_APP_CHECK} from './appCheckPolicy';
import {measureRoundChange, type ManagerRoundMeasure, type MeasuredRound} from './managerRoundMeasurement';
import {gameRemovalBlocksWrite} from './gameProcessingGuard';

export const onManagerRoundChanged = onDocumentWritten('games/{gameId}', async event => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const updateTime = after.updateTime;
  if (!updateTime) return;
  const before = event.data?.before;
  const project = (value: MeasuredRound) => JSON.stringify({
    groupId: value.groupId, startsAt: value.startsAt, opensAt: value.registrationOpensAt, createdAt: value.createdAt,
    maxPlayers: value.maxPlayers, players: [...new Set(value.players ?? [])].sort(), waitlist: [...new Set(value.waitlist ?? [])].sort(),
    guests: (value.guests ?? []).filter(g => g && !g.waitlisted).length,
    cancellations: Object.entries(value.cancellations ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    cancelDeadlineHours: value.cancelDeadlineHours, pendingPromotion: value.pendingPromotion?.uid,
  });
  if (before?.exists && project(before.data() as MeasuredRound) === project(after.data() as MeasuredRound)) return;
  const db = getFirestore(), ref = db.collection('managerRoundMetrics').doc(after.id);
  const receipt = ref.collection('events').doc(createHash('sha256').update(event.id).digest('hex'));
  await db.runTransaction(async tx => {
    if (await gameRemovalBlocksWrite(tx, db, event.params.gameId)) return;
    if (!(await tx.get(db.doc(`games/${event.params.gameId}`))).exists) return;
    const [done, current] = await Promise.all([tx.get(receipt), tx.get(ref)]);
    if (done.exists) return;
    const row = measureRoundChange(current.exists ? current.data() as ManagerRoundMeasure : undefined,
      before?.exists ? before.data() as MeasuredRound : undefined, after.data() as MeasuredRound,
      after.id, updateTime.toMillis());
    if (!row) return;
    tx.set(ref, row);
    tx.create(receipt, {at: updateTime, expiresAt: new Date(Date.now() + 90 * 86400000)});
  });
});

/** No client permission changes: the new server-owned collection is served
 * only through a callable with a canonical manager gate, checked twice. */
export const getManagerRoundHistory = onCall({enforceAppCheck: ENFORCE_APP_CHECK}, async request => {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token?.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Login required');
  const {groupId, gameIds} = request.data ?? {};
  const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128 && !/[./]/.test(id);
  if (!validId(groupId) || !Array.isArray(gameIds) || gameIds.length > 200 || !gameIds.every(validId))
    throw new HttpsError('invalid-argument', 'Invalid club or round scope');
  const db = getFirestore(), clubRef = db.collection('groups').doc(groupId);
  const gate = async () => { const club = (await clubRef.get()).data();
    if (!club || !Array.isArray(club.adminIds) || !club.adminIds.includes(uid)) throw new HttpsError('permission-denied', 'Club admin required'); };
  await gate();
  const ids = [...new Set(gameIds as string[])];
  const [snapshots, currentGames] = ids.length ? await Promise.all([
    db.getAll(...ids.map(id => db.collection('managerRoundMetrics').doc(id))),
    db.getAll(...ids.map(id => db.collection('games').doc(id))),
  ]) : [[], []];
  const canonical = new Map(currentGames.map(snap => [snap.id, snap.data()]));
  const rows = snapshots.flatMap(snap => {
    const row = snap.data();
    const game = canonical.get(snap.id);
    return row?.groupId === groupId && row.schema === 1 && game?.groupId === groupId && game.startsAt === row.startsAt
      ? [{...row, gameId: snap.id}] : [];
  });
  await gate();
  return {rows, measuredAt: Date.now()};
});
