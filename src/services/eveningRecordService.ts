import { collection, getDocs, limit, orderBy, query, startAfter, where,
  type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import { col } from '@/firebase/firestore';
import { getFirebase } from '@/firebase/config';
import { eveningPlayState } from '@/utils/eveningPlayed';
import { personalEveningRecords, type PersonalEveningRecord } from '@/utils/eveningHighlights';
import type { UserId } from '@/types';

/** Read-only, club-lifetime records BEFORE this evening. Never scan other users' stats.
 * Existing club-history index and game audience rules; no new rules/index deployment.
 * A bounded/incomplete/offline history suppresses the claim rather than inventing a record.
 */
export async function readPersonalEveningRecords(
  groupId: string, uid: UserId, startsAt: number,
  current: { goals: number; assists: number; wins: number },
): Promise<PersonalEveningRecord[]> {
  const db = getFirebase().db;
  const games: { id: string; participantIds?: string[] }[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
  let complete = false;
  for (let page = 0; page < 20; page += 1) {
    // Same shape as getHistory. Read through all pages, not just the latest 100.
    const constraints = [where('groupId', '==', groupId), where('status', 'in', ['finished', 'cancelled']),
      orderBy('startsAt', 'desc'), limit(100)];
    const snap = await getDocs(query(col.games(), ...constraints, ...(cursor ? [startAfter(cursor)] : [])));
    if (snap.metadata.fromCache) return [];
    for (const d of snap.docs) {
      const g = d.data();
      if (g.startsAt < startsAt && eveningPlayState(g) === 'happened') {
        games.push({ id: g.id, participantIds: g.participantIds });
      }
    }
    if (snap.size < 100) { complete = true; break; }
    cursor = snap.docs[snap.docs.length - 1];
  }
  if (!complete || games.length === 0) return [];
  const history: { goals: number; assists: number; wins: number }[] = [];
  for (let i = 0; i < games.length; i += 8) {
    // A get of an absent row cannot satisfy canReadGame(resource.data.gameId).
    // The existing history query binds gameId and returns an honest empty list.
    const batch = await Promise.all(games.slice(i, i + 8).map((g) =>
      getDocs(query(collection(db, 'gamePlayerStats'), where('gameId', '==', g.id),
        where('userId', '==', uid), limit(2)))));
    for (let j = 0; j < batch.length; j += 1) {
      const snap = batch[j];
      if (snap.metadata.fromCache) return [];
      if (snap.empty) {
        // Missing statistics for a registered player could be lost history.
        // An evening with no registration and no stat row was not their evening.
        if (games[i + j].participantIds?.includes(uid)) return [];
        continue;
      }
      if (snap.size !== 1) return [];
      const d = snap.docs[0].data();
      if (!['goals', 'assists', 'wins', 'rounds'].every((k) =>
        typeof d[k] === 'number' && Number.isFinite(d[k]) && d[k] >= 0)) return [];
      if (d.rounds > 0) history.push({ goals: d.goals, assists: d.assists, wins: d.wins });
    }
  }
  return personalEveningRecords(current, history, true);
}
