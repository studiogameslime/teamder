// seriesService — the weekly fixture's settings, independent of any match.
//
// A `GameSeries` doc is the template the weekly cron builds each occurrence
// from. Nothing here touches individual matches: an occurrence is disposable,
// and deleting one has no effect on the series.
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
  updateDoc,
  where,
} from 'firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import type { GameSeries, GameSeriesSettings, GroupId, UserId } from '@/types';

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

