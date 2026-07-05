// communityEventsService — per-community, per-player timeline events.
//
// Backs three things: the admin-only player timeline (yellow/red/ball/jerseys),
// the "last took" hints in the end-of-evening equipment popup, and the
// active-red-card registration block. Stored in the top-level collection
// `communityPlayerEvents` (one doc per event). Distinct from the global
// `User.discipline` — this log is scoped to a single club and admin-only.

import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { CommunityPlayerEvent, GroupId, UserId } from '@/types';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { activeUntil, cardState, isActiveRedCard } from '@/utils/cardState';
import { logError } from './errorLog';

const COL = 'communityPlayerEvents';
// Real writes use Firestore auto-ids (collision-proof); this mock-only id keeps
// the demo store readable. genId is NEVER used for a real setDoc.
const genId = () => `cpe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Cap a single player's timeline / the community "last took" scan so neither
// grows unbounded with a season of auto-logged ball/jerseys events.
const TIMELINE_LIMIT = 200;

/** Latest ball/jerseys handoff time per player (for the equipment popup). */
export type LastTakenMap = Record<string, { ball?: number; jerseys?: number }>;

/** Count of a player's currently-ACTIVE yellow/red cards (for roster badges). */
export type CardCounts = { yellow: number; red: number };
export type CardCountsMap = Record<string, CardCounts>;

// ── mock store (demo) — seeded so the timeline isn't empty on the emulator ──
const DAY = 24 * 60 * 60 * 1000;
const N = Date.now();
const mockEvents: CommunityPlayerEvent[] = [
  // p5 (אורי) — a rich demo timeline: all 4 types + active/expired/revoked.
  { id: 'seed-p5-1', groupId: 'g1', userId: 'p5', type: 'yellow', at: N - 1 * DAY, expiresAt: null, issuedBy: 'p7', detail: 'ויכוח עם השופט' },
  { id: 'seed-p5-2', groupId: 'g1', userId: 'p5', type: 'red', at: N - 2 * DAY, expiresAt: N + 5 * DAY, issuedBy: 'p7', detail: 'התנהגות לא ספורטיבית' },
  { id: 'seed-p5-3', groupId: 'g1', userId: 'p5', type: 'ball', at: N - 3 * DAY, gameId: 'gv2-live' },
  { id: 'seed-p5-4', groupId: 'g1', userId: 'p5', type: 'yellow', at: N - 6 * DAY, expiresAt: null, issuedBy: 'p7', detail: 'איחר 20 דקות' },
  { id: 'seed-p5-5', groupId: 'g1', userId: 'p5', type: 'jerseys', at: N - 10 * DAY, gameId: 'gv2-live' },
  { id: 'seed-p5-6', groupId: 'g1', userId: 'p5', type: 'red', at: N - 25 * DAY, expiresAt: N - 18 * DAY, issuedBy: 'p7', detail: 'אלימות מילולית' },
  { id: 'seed-p5-7', groupId: 'g1', userId: 'p5', type: 'red', at: N - 40 * DAY, expiresAt: N - 33 * DAY, issuedBy: 'p7', detail: 'ויכוח קולני', revoked: true, revokedBy: 'p7', revokedAt: N - 39 * DAY },
  // p3 (משה) — a yellow so the roster shows a second carded player.
  { id: 'seed-p3-1', groupId: 'g1', userId: 'p3', type: 'yellow', at: N - 4 * DAY, expiresAt: null, issuedBy: 'p7', detail: 'איחר 20 דק׳' },
  { id: 'seed-p3-2', groupId: 'g1', userId: 'p3', type: 'ball', at: N - 3 * DAY, gameId: 'gv2-live' },
];

export const communityEventsService = {
  /**
   * Admin issues a yellow/red card to a member (with an optional note).
   * `validityDays` is the club's current validity for THIS card type (null =
   * no expiry); we snapshot the resulting `expiresAt` onto the event so a later
   * change to the club config never rewrites this card's active/expired state.
   */
  async logCardEvent(
    groupId: GroupId,
    userId: UserId,
    type: 'yellow' | 'red',
    issuedBy: UserId,
    detail?: string,
    validityDays?: number | null,
  ): Promise<void> {
    if (!groupId || !userId) return;
    const now = Date.now();
    const ref = USE_MOCK_DATA ? null : doc(collection(getFirebase().db, COL));
    const ev: CommunityPlayerEvent = {
      id: ref ? ref.id : genId(),
      groupId,
      userId,
      type,
      at: now,
      expiresAt: activeUntil(now, validityDays),
      issuedBy,
      ...(detail && detail.trim() ? { detail: detail.trim() } : {}),
    };
    if (USE_MOCK_DATA) {
      mockEvents.unshift(ev);
      return;
    }
    try {
      await setDoc(ref!, ev);
    } catch (err) {
      logError('logCardEvent', err, { groupId, userId, type });
      throw err;
    }
  },

  /** Auto-recorded when the equipment popup saves — one event per holder. */
  async logEquipmentEvents(
    groupId: GroupId,
    gameId: string,
    ballIds: string[],
    jerseysIds: string[],
  ): Promise<void> {
    if (!groupId) return;
    const now = Date.now();
    const db = USE_MOCK_DATA ? null : getFirebase().db;
    const mk = (
      userId: string,
      type: 'ball' | 'jerseys',
    ): { ev: CommunityPlayerEvent; ref: ReturnType<typeof doc> | null } => {
      const ref = db ? doc(collection(db, COL)) : null;
      return {
        ref,
        ev: {
          id: ref ? ref.id : genId(),
          groupId,
          userId,
          type,
          at: now,
          ...(gameId ? { gameId } : {}),
        },
      };
    };
    const items = [
      ...ballIds.map((u) => mk(u, 'ball')),
      ...jerseysIds.map((u) => mk(u, 'jerseys')),
    ];
    if (!items.length) return;
    if (USE_MOCK_DATA) {
      mockEvents.unshift(...items.map((i) => i.ev));
      return;
    }
    try {
      await Promise.all(items.map((i) => setDoc(i.ref!, i.ev)));
    } catch (err) {
      logError('logEquipmentEvents', err, { groupId, gameId });
    }
  },

  /**
   * Log a single manual equipment change from the "נהל ציוד" sheet — an admin
   * marking a player as holding (received) or clearing the mark (returned) the
   * club's ball / jerseys. Recorded on the player's timeline. `issuedBy` is
   * carried for attribution (ball/jerseys don't require it in rules).
   */
  async logEquipmentChange(
    groupId: GroupId,
    userId: UserId,
    type: 'ball' | 'jerseys',
    issuedBy: UserId,
    returned: boolean,
  ): Promise<void> {
    if (!groupId || !userId) return;
    const now = Date.now();
    const ref = USE_MOCK_DATA ? null : doc(collection(getFirebase().db, COL));
    const ev: CommunityPlayerEvent = {
      id: ref ? ref.id : genId(),
      groupId,
      userId,
      type,
      at: now,
      issuedBy,
      ...(returned ? { returned: true } : {}),
    };
    if (USE_MOCK_DATA) {
      mockEvents.unshift(ev);
      return;
    }
    try {
      await setDoc(ref!, ev);
    } catch (err) {
      logError('logEquipmentChange', err, { groupId, userId, type });
      throw err;
    }
  },

  /** Full timeline for one player in one community, newest first. */
  async getPlayerTimeline(groupId: GroupId, userId: UserId): Promise<CommunityPlayerEvent[]> {
    if (!groupId || !userId) return [];
    if (USE_MOCK_DATA) {
      return mockEvents
        .filter((e) => e.groupId === groupId && e.userId === userId)
        .sort((a, b) => b.at - a.at);
    }
    try {
      const snap = await getDocs(
        query(
          collection(getFirebase().db, COL),
          where('groupId', '==', groupId),
          where('userId', '==', userId),
          orderBy('at', 'desc'),
          limit(TIMELINE_LIMIT),
        ),
      );
      return snap.docs.map((d) => d.data() as CommunityPlayerEvent);
    } catch (err) {
      logError('getPlayerTimeline', err, { groupId, userId });
      return [];
    }
  },

  /** Latest ball/jerseys handoff time per player (one grouped query). */
  async getLastTakenMap(groupId: GroupId): Promise<LastTakenMap> {
    if (!groupId) return {};
    let rows: CommunityPlayerEvent[] = [];
    if (USE_MOCK_DATA) {
      rows = mockEvents.filter(
        (e) => e.groupId === groupId && (e.type === 'ball' || e.type === 'jerseys'),
      );
    } else {
      try {
        const snap = await getDocs(
          query(
            collection(getFirebase().db, COL),
            where('groupId', '==', groupId),
            where('type', 'in', ['ball', 'jerseys']),
            orderBy('at', 'desc'),
            limit(200),
          ),
        );
        rows = snap.docs.map((d) => d.data() as CommunityPlayerEvent);
      } catch (err) {
        logError('getLastTakenMap', err, { groupId });
        return {};
      }
    }
    const out: LastTakenMap = {};
    for (const e of rows) {
      const slot = (out[e.userId] ??= {});
      if (e.type === 'ball' && (slot.ball === undefined || e.at > slot.ball)) slot.ball = e.at;
      if (e.type === 'jerseys' && (slot.jerseys === undefined || e.at > slot.jerseys)) slot.jerseys = e.at;
    }
    return out;
  },

  /**
   * Per-player count of currently-ACTIVE yellow/red cards for a community,
   * for the roster discipline badges. One grouped query (backed by the
   * (groupId, type, at) index); expired/revoked cards are excluded via
   * cardState. Pass the club's per-type validity for the legacy fallback.
   */
  async getActiveCardCounts(
    groupId: GroupId,
    yellowValidityDays: number | null | undefined,
    redValidityDays: number | null | undefined,
  ): Promise<CardCountsMap> {
    if (!groupId) return {};
    let rows: CommunityPlayerEvent[] = [];
    if (USE_MOCK_DATA) {
      rows = mockEvents.filter(
        (e) => e.groupId === groupId && (e.type === 'yellow' || e.type === 'red'),
      );
    } else {
      try {
        const snap = await getDocs(
          query(
            collection(getFirebase().db, COL),
            where('groupId', '==', groupId),
            where('type', 'in', ['yellow', 'red']),
            orderBy('at', 'desc'),
            limit(TIMELINE_LIMIT),
          ),
        );
        rows = snap.docs.map((d) => d.data() as CommunityPlayerEvent);
      } catch (err) {
        logError('getActiveCardCounts', err, { groupId });
        return {};
      }
    }
    const now = Date.now();
    const out: CardCountsMap = {};
    for (const e of rows) {
      const validity = e.type === 'red' ? redValidityDays : yellowValidityDays;
      if (cardState(e, validity, now) !== 'active') continue;
      const slot = (out[e.userId] ??= { yellow: 0, red: 0 });
      if (e.type === 'red') slot.red += 1;
      else slot.yellow += 1;
    }
    return out;
  },

  /** Revoke (cancel) a card — kept on the timeline, marked "בוטל". */
  async revokeCard(id: string, revokedBy: UserId): Promise<void> {
    if (!id) return;
    if (USE_MOCK_DATA) {
      const e = mockEvents.find((x) => x.id === id);
      if (e) {
        e.revoked = true;
        e.revokedBy = revokedBy;
        e.revokedAt = Date.now();
      }
      return;
    }
    try {
      await updateDoc(doc(getFirebase().db, COL, id), {
        revoked: true,
        revokedBy,
        revokedAt: Date.now(),
      });
    } catch (err) {
      logError('revokeCard', err, { id });
      throw err;
    }
  },

  /**
   * Client-side gate: does this member currently hold an active red card?
   * Returns false immediately when the club's cards feature is disabled — the
   * master switch suspends ALL card behaviour (mirrors the server reconcile).
   */
  async hasActiveRedCard(
    groupId: GroupId,
    userId: UserId,
    redValidityDays: number | null | undefined,
    cardsEnabled: boolean,
  ): Promise<boolean> {
    if (!groupId || !userId || !cardsEnabled) return false;
    let rows: CommunityPlayerEvent[] = [];
    if (USE_MOCK_DATA) {
      rows = mockEvents.filter(
        (e) => e.groupId === groupId && e.userId === userId && e.type === 'red',
      );
    } else {
      try {
        const snap = await getDocs(
          query(
            collection(getFirebase().db, COL),
            where('groupId', '==', groupId),
            where('userId', '==', userId),
            where('type', '==', 'red'),
          ),
        );
        rows = snap.docs.map((d) => d.data() as CommunityPlayerEvent);
      } catch (err) {
        logError('hasActiveRedCard', err, { groupId, userId });
        return false;
      }
    }
    const now = Date.now();
    return rows.some((e) => isActiveRedCard(e, redValidityDays, now));
  },
};
