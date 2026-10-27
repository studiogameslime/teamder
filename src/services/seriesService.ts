import { observeCaughtError } from '../utils/errorObservation';
// seriesService — the weekly fixture's settings, independent of any match.
//
// A `GameSeries` doc is the template the weekly cron builds each occurrence
// from. The creation helper links the first game atomically to its series;
// other settings operations do not rewrite occurrences, and deleting a game
// has no effect on the series.
//
// Deliberately NO Firestore converter. The converters in firebase/firestore.ts
// rebuild objects field by field on READ, so a field added to the type but not
// to the reader silently vanishes — a trap this codebase has been bitten by
// before. A settings blob that grows over time is exactly the wrong shape for
// that, so this reads plain docs and validates only what it needs.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import type { GameSeries, GameSeriesSettings, GroupId, UserId } from '@/types';
import { mockGamesV2 } from '@/data/mockData';
import { assertCreationOwner } from '@/services/creationOwner';

// The pure half lives in utils so it can be unit-tested without Firebase.
export { settingsFromGame } from '@/utils/seriesSchedule';

const COL = 'gameSeries';

// Mock store so the emulator/demo can exercise the flow without Firebase.
const mockSeries: GameSeries[] = [];

function toSeries(id: string, data: Record<string, unknown>): GameSeries {
  return {
    id,
    groupId: String(data.groupId ?? ''),
    active: data.active !== false,
    createdBy: String(data.createdBy ?? ''),
    createdAt: Number(data.createdAt ?? 0),
    updatedAt: Number(data.updatedAt ?? 0),
    lastOccurrenceAt: Number(data.lastOccurrenceAt ?? 0),
    settings: (data.settings ?? {}) as GameSeriesSettings,
  };
}

export const seriesService = {
  /** Must finish before deleting the club, while admin permissions still exist. */
  async stopForGroup(groupId: GroupId): Promise<void> {
    if (USE_MOCK_DATA) {
      mockSeries.filter(s => s.groupId === groupId).forEach(s => { s.active = false; });
      return;
    }
    const { db } = getFirebase();
    const snapshot = await getDocs(query(collection(db, COL), where('groupId', '==', groupId)));
    const active = snapshot.docs.filter(s => s.data().active !== false);
    for (let start = 0; start < active.length; start += 400) {
      const batch = writeBatch(db);
      active.slice(start, start + 400).forEach(s => batch.update(s.ref, { active: false, updatedAt: Date.now() }));
      await batch.commit();
    }
  },
  /** Create and link a first occurrence atomically. Read the existing GAME,
   * never a not-yet-existing series (whose read rules require groupId). */
  async ensureForGame(gameId: string, input: {
    groupId: GroupId; createdBy: UserId; firstOccurrenceAt: number; settings: GameSeriesSettings;
  }): Promise<string> {
    assertCreationOwner(input.createdBy);
    const now = Date.now();
    const payload = { groupId: input.groupId, active: true, createdBy: input.createdBy,
      createdAt: now, updatedAt: now, lastOccurrenceAt: input.firstOccurrenceAt, settings: input.settings };
    if (USE_MOCK_DATA) {
      const game = mockGamesV2.find(item => item.id === gameId);
      if (!game || game.groupId !== input.groupId || game.createdBy !== input.createdBy) throw Error('series game owner mismatch');
      if (game.seriesId) return game.seriesId;
      const id = `series-${gameId}`;
      mockSeries.push({ id, ...payload });
      game.seriesId = id;
      return id;
    }
    const { db } = getFirebase();
    const gameRef = doc(db, 'games', gameId);
    const seriesRef = doc(collection(db, COL));
    const id = await runTransaction(db, async tx => {
      const snapshot = await tx.get(gameRef);
      const game = snapshot.data();
      if (!snapshot.exists() || !game || game.groupId !== input.groupId || game.createdBy !== input.createdBy) {
        throw Error('series game owner mismatch');
      }
      if (typeof game.seriesId === 'string' && game.seriesId) return game.seriesId;
      assertCreationOwner(input.createdBy);
      tx.set(seriesRef, payload);
      tx.update(gameRef, { seriesId: seriesRef.id });
      return seriesRef.id;
    });
    assertCreationOwner(input.createdBy);
    return id;
  },
  /** Create the series a recurring fixture repeats from. */
  async create(input: {
    groupId: GroupId;
    createdBy: UserId;
    /** Kickoff of the FIRST occurrence — the anchor the next week is measured
     *  from. */
    firstOccurrenceAt: number;
    settings: GameSeriesSettings;
  }): Promise<GameSeries> {
    const now = Date.now();
    const payload = {
      groupId: input.groupId,
      active: true,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      lastOccurrenceAt: input.firstOccurrenceAt,
      settings: input.settings,
    };
    if (USE_MOCK_DATA) {
      const s: GameSeries = { id: `series-${now}`, ...payload };
      mockSeries.push(s);
      return s;
    }
    const { db } = getFirebase();
    const ref = await addDoc(collection(db, COL), payload);
    return { id: ref.id, ...payload };
  },

  async get(seriesId: string): Promise<GameSeries | null> {
    if (!seriesId) return null;
    if (USE_MOCK_DATA) return mockSeries.find((s) => s.id === seriesId) ?? null;
    try {
      const { db } = getFirebase();
      const snap = await getDoc(doc(db, COL, seriesId));
      return snap.exists() ? toSeries(snap.id, snap.data()) : null;
    } catch (err) {
    observeCaughtError(err, {"source":"src/services/seriesService.ts","handler":"get","site":"seriesService:dece592b8a"});
      logError('seriesGet', err, { seriesId });
      return null;
    }
  },

  /** Active series of a club — for the club's "מחזורים קבועים" surface. */
  async listForGroup(groupId: GroupId): Promise<GameSeries[]> {
    if (!groupId) return [];
    if (USE_MOCK_DATA) {
      return mockSeries.filter((s) => s.groupId === groupId && s.active);
    }
    try {
      const { db } = getFirebase();
      const snap = await getDocs(
        query(
          collection(db, COL),
          where('groupId', '==', groupId),
          where('active', '==', true),
        ),
      );
      return snap.docs.map((d) => toSeries(d.id, d.data()));
    } catch (err) {
    observeCaughtError(err, {"source":"src/services/seriesService.ts","handler":"listForGroup","site":"seriesService:98336f51ec"});
      logError('seriesList', err, { groupId });
      return [];
    }
  },

  /**
   * Edit the series template. Applies to occurrences created FROM NOW ON —
   * the already-created upcoming match is deliberately left untouched so
   * players who already signed up don't have the pitch or time moved under
   * them (owner's call).
   */
  async updateSettings(
    seriesId: string,
    settings: GameSeriesSettings,
  ): Promise<void> {
    if (!seriesId) return;
    if (USE_MOCK_DATA) {
      const s = mockSeries.find((x) => x.id === seriesId);
      if (s) {
        s.settings = settings;
        s.updatedAt = Date.now();
      }
      return;
    }
    const { db } = getFirebase();
    await updateDoc(doc(db, COL, seriesId), {
      settings,
      updatedAt: Date.now(),
    });
    logEvent(AnalyticsEvent.GameSeriesSettingsApplied, { seriesId });
  },

  /** Stop the weekly fixture. Kept (not deleted) so past occurrences can still
   *  resolve their `seriesId`. */
  async stop(seriesId: string): Promise<void> {
    if (!seriesId) return;
    if (USE_MOCK_DATA) {
      const s = mockSeries.find((x) => x.id === seriesId);
      if (s) s.active = false;
      return;
    }
    const { db } = getFirebase();
    await updateDoc(doc(db, COL, seriesId), {
      active: false,
      updatedAt: Date.now(),
    });
    logEvent(AnalyticsEvent.GameSeriesStopped, { seriesId });
  },

  /** Hard-delete — only used when a series is created and immediately rolled
   *  back (e.g. the game write that should have anchored it failed). */
  async remove(seriesId: string): Promise<void> {
    if (!seriesId) return;
    if (USE_MOCK_DATA) {
      const i = mockSeries.findIndex((x) => x.id === seriesId);
      if (i >= 0) mockSeries.splice(i, 1);
      return;
    }
    const { db } = getFirebase();
    await deleteDoc(doc(db, COL, seriesId));
  },
};

