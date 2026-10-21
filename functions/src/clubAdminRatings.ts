import { ENFORCE_APP_CHECK } from './appCheckPolicy';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from './observedFunctions';

export function cleanAdminRatings(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, n]) => id && !/[./]/.test(id) && typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 5));
}
// Explicit temporary release flag. OFF by default; remove the legacy field
// only in the separately approved migration + rules-lockdown release.
export function legacyClubRatingsCompat(): boolean {
  return process.env.TEAMDER_LEGACY_CLUB_RATINGS_COMPAT === 'true';
}
export const getClubAdminRatings = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const uid = request.auth?.uid, groupId = request.data?.groupId;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Login required');
  if (typeof groupId !== 'string' || !groupId || groupId.length > 128 || /[./]/.test(groupId)) throw new HttpsError('invalid-argument', 'Invalid club');
  const club = (await getFirestore().doc(`groups/${groupId}`).get()).data();
  if (!club || (!(club.adminIds ?? []).includes(uid) && (club.hideInternalRating === true || !(club.playerIds ?? []).includes(uid))))
    throw new HttpsError('permission-denied', 'Club ratings are private');
  return { ratings: await readServerAdminRatings(groupId) };
});
export const setClubAdminRating = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Login required');
  const { groupId, playerId, rating } = request.data ?? {};
  if (![groupId, playerId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[./]/.test(v)) ||
    !(rating === null || rating === 0 || (typeof rating === 'number' && Number.isFinite(rating) && rating > 0 && rating <= 5))) throw new HttpsError('invalid-argument', 'Invalid rating');
  const db = getFirestore(), ref = db.doc(`groups/${groupId}`), ratingsRef = ref.collection('private').doc('adminRatings');
  await db.runTransaction(async tx => {
    const [clubSnap, ratingsSnap] = await Promise.all([tx.get(ref), tx.get(ratingsRef)]);
    const club = clubSnap.data();
    if (!club || !(club.adminIds ?? []).includes(uid)) throw new HttpsError('permission-denied', 'Club admin required');
    if (!(club.playerIds ?? []).includes(playerId)) throw new HttpsError('failed-precondition', 'Player is not a member');
    const legacy = legacyClubRatingsCompat();
    const ratings = cleanAdminRatings(legacy ? club.adminRatings : ratingsSnap.exists ? ratingsSnap.data()?.ratings : club.adminRatings);
    if (rating === null || rating === 0) delete ratings[playerId]; else ratings[playerId] = rating;
    if (legacy) {
      // Stage one: old clients still read AND write this canonical field.
      // Do not create private copies or migrate production data in this mode.
      tx.update(ref, { adminRatings: ratings, updatedAt: Date.now() });
    } else {
      tx.set(ratingsRef, { ratings, updatedAt: Date.now() });
      tx.update(ref, { adminRatings: FieldValue.delete(), updatedAt: Date.now() });
    }
  });
  return { ok: true };
});

export async function readServerAdminRatings(groupId: string): Promise<Record<string, number>> {
  if (legacyClubRatingsCompat()) return cleanAdminRatings((await getFirestore().doc(`groups/${groupId}`).get()).data()?.adminRatings);
  const snap = await getFirestore().doc(`groups/${groupId}/private/adminRatings`).get();
  return cleanAdminRatings(snap.data()?.ratings);
}

export async function prunePrivateClubRatings(groupId: string): Promise<void> {
  const db = getFirestore(), clubRef = db.doc(`groups/${groupId}`), ref = clubRef.collection('private').doc('adminRatings');
  await db.runTransaction(async tx => {
    const [club, ratings] = await Promise.all([tx.get(clubRef), tx.get(ref)]);
    if (!club.exists || !ratings.exists) return;
    const members = new Set(club.data()?.playerIds ?? []);
    const old = cleanAdminRatings(ratings.data()?.ratings);
    const next = Object.fromEntries(Object.entries(old).filter(([uid]) => members.has(uid)));
    if (Object.keys(next).length !== Object.keys(old).length) tx.set(ref, { ratings: next, updatedAt: Date.now() });
  });
}
