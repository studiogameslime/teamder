import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { acquireSeasonOperation } from './seasonOperation';
import { publishSeason } from './seasonPublication';
import { restoreUnassignedPeriods, unassignedSeasonActivity } from './seasonUnassigned';
import { closeSeason } from './seasonRollover';
import { didEveningHappen, eveningPlayState, playEvidence, isOrganizedEveningAwaitingDecision } from './eveningPlayed';
import { todayIn } from './seasonDates';
import { assertSeasonTargetEditable } from './seasonLock';
import { CORRECTION_WINDOW_MS, MIN_SEASON_ROUNDS, SEASON_POLICY_VERSION,
  makeSeasonTarget, seasonTargetDue, seasonClosureKind, updateCorrectionWindow, validateSeasonTarget,
  type SeasonTarget, type CorrectionWindow, type SeasonHistoryChoice } from './seasonPolicy';

type Data = Record<string, any>;
const del = () => admin.firestore.FieldValue.delete();
export interface SeasonManagerDependencies {
  db: admin.firestore.Firestore;
  now?: () => number;
  announce: (args: { groupId: string; groupName: string; seasonId: string; seasonNo: number }) => Promise<void>;
  report: (args: { operation: string; err: unknown; context?: Record<string, unknown> }) => Promise<void>;
}

/** Owns every season lifecycle mutation. Existing stat accumulators and the
 * archive writer remain the data source; no second statistics pipeline. */
export class SeasonManager {
  private closedThisSweep = 0;
  private maxCloses = Infinity;
  private db: admin.firestore.Firestore;
  private now: () => number;
  constructor(private deps: SeasonManagerDependencies) { this.db = deps.db; this.now = deps.now ?? Date.now; }

  async games(groupId: string): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    const out: admin.firestore.QueryDocumentSnapshot[] = [];
    let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      let q = this.db.collection('games').where('groupId', '==', groupId).orderBy(admin.firestore.FieldPath.documentId()).limit(200);
      if (cursor) q = q.startAfter(cursor);
      const page = await q.get(); out.push(...page.docs);
      if (page.size < 200) return out;
      cursor = page.docs[page.size - 1];
    }
  }

  private belongs(g: Data, s: Data): boolean {
    if (g.seasonId) return g.seasonId === s.currentId;
    if ((s.currentNo ?? 1) === 1 && !s.policyVersion) return !g.startsAt || g.startsAt <= (s.pendingClose?.dueAt ?? this.now());
    return typeof g.startsAt === 'number' && todayIn(undefined, g.startsAt) >= todayIn(undefined, s.startedAt ?? 0) &&
      g.startsAt <= Math.min(this.now(), s.pendingClose?.dueAt ?? Infinity) &&
      !(s.cadence?.type === 'date' && s.cadence.endsOn && (s.playedRounds ?? 0) >= MIN_SEASON_ROUNDS &&
        todayIn(undefined, g.startsAt) > s.cadence.endsOn);
  }

  private needsVerification(g: Data, s: Data): boolean {
    const unresolved = eveningPlayState(g) === 'unverified' || isOrganizedEveningAwaitingDecision(g, this.now());
    const undated = !g.seasonId && !(typeof g.startsAt === 'number' && Number.isFinite(g.startsAt) && g.startsAt > 0);
    return unresolved && (this.belongs(g, s) || undated);
  }

  async blockers(groupId: string, s: Data): Promise<{ active: number; unverified: number; unsealed: number }> {
    let active = 0, unverified = 0, unsealed = 0;
    for (const d of await this.games(groupId)) {
      const g = d.data();
      if (this.needsVerification(g, s)) { unverified++; continue; }
      if (!this.belongs(g, s) || g.status === 'cancelled') continue;
      if (g.status === 'active') { active++; continue; }
      if (eveningPlayState(g) === 'unverified') { unverified++; continue; }
      // Organising only is a genuine workflow. A past organised evening must
      // be resolved by the existing confirmation flow, never guessed away.
      if (isOrganizedEveningAwaitingDecision(g, this.now())) { unverified++; continue; }
      if (['open', 'locked'].includes(g.status) && g.startsAt <= this.now() && playEvidence(g)) { active++; continue; }
      if (didEveningHappen(g) && (g.endedBy === 'admin' || g.endedBy === 'auto')) {
        const summary = await this.db.collection('roundSummaries').doc(d.id).get();
        if (!summary.exists) unsealed++;
      }
    }
    return { active, unverified, unsealed };
  }

  private checkRequest(data: Data, s: Data) {
    if (data.policyVersion !== SEASON_POLICY_VERSION) throw new HttpsError('failed-precondition', 'season-policy:updateRequired');
    const expected = data.expected;
    if (expected && (expected.currentId !== (s.currentId ?? '') || expected.revision !== (s.revision ?? 0) ||
      expected.playedRounds !== (s.playedRounds ?? 0) || expected.enabled !== (s.enabled === true))) {
      throw new HttpsError('failed-precondition', 'season-operation:stale');
    }
  }

  private async admin(groupId: unknown, uid: string) {
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    if (typeof groupId !== 'string' || !groupId) throw new HttpsError('invalid-argument', 'groupId required');
    const ref = this.db.collection('groups').doc(groupId), snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'club not found');
    const g = snap.data()!;
    if (!Array.isArray(g.adminIds) || !g.adminIds.includes(uid)) throw new HttpsError('permission-denied', 'admin only');
    return { ref, g, s: (g.seasons ?? {}) as Data };
  }

  async preview(groupId: string, uid: string) {
    const { s } = await this.admin(groupId, uid);
    const pool = await unassignedSeasonActivity(this.db, groupId, s, await this.games(groupId), this.now());
    return { played: pool.played, startsAt: pool.startsAt, unverified: pool.unverified,
      expected: { currentId: s.currentId ?? '', revision: s.revision ?? 0, playedRounds: s.playedRounds ?? 0, enabled: s.enabled === true } };
  }

  async listUnverified(groupId: string, uid: string) {
    const { s } = await this.admin(groupId, uid);
    const all = await this.games(groupId);
    const poolIds = s.enabled ? null : new Set((await unassignedSeasonActivity(this.db, groupId, s, all, this.now())).games.map(d => d.id));
    const items = all.filter(d => {
      const g = d.data();
      if (eveningPlayState(g) !== 'unverified' && !isOrganizedEveningAwaitingDecision(g, this.now())) return false;
      if (s.enabled) return this.needsVerification(g, s);
      return poolIds!.has(d.id);
    });
    return { items: items.map(d => ({ id: d.id, title: String(d.get('title') ?? ''), startsAt: Number(d.get('startsAt')) || 0 }))
      .sort((a, b) => a.startsAt - b.startsAt) };
  }

  /** Atomic start, also synchronises an expired correction window before
   * deciding. Merely entering the live screen is never a start event. */
  async startEvening(gameId: string, uid: string) {
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    const ref = this.db.collection('games').doc(gameId), before = await ref.get();
    if (!before.exists) throw new HttpsError('not-found', 'game not found');
    const gid = before.get('groupId');
    const beforeClub = gid ? await this.db.collection('groups').doc(gid).get() : null;
    if (![...(before.get('adminIds') ?? []), ...(beforeClub?.get('adminIds') ?? []), before.get('createdBy'), before.get('organizerId')].includes(uid)) {
      throw new HttpsError('permission-denied', 'admin only');
    }
    if (gid) await this.refresh(gid);
    await this.db.runTransaction(async tx => {
      const snap = await tx.get(ref), g = snap.data()!;
      const clubRef = gid ? this.db.collection('groups').doc(gid) : null;
      const club = clubRef ? await tx.get(clubRef) : null;
      if (![...(g.adminIds ?? []), ...(club?.get('adminIds') ?? []), g.createdBy, g.organizerId].includes(uid)) throw new HttpsError('permission-denied', 'admin only');
      if (['finished', 'cancelled'].includes(g.status)) return;
      const s = club?.get('seasons');
      const alreadyStarted = (g.status === 'active' || typeof g.seasonStartedAt === 'number') &&
        (!s?.pendingClose || (g.seasonStartedAt ?? g.startsAt) <= s.pendingClose.dueAt);
      if (s?.operation || (s?.pendingClose && !alreadyStarted)) throw new HttpsError('failed-precondition', 'SEASON_CLOSING');
      if (s?.enabled && typeof g.startsAt === 'number' && todayIn(undefined, g.startsAt) < todayIn(undefined, s.startedAt ?? 0)) throw new HttpsError('failed-precondition', 'closedSeasonGame');
      if (s?.enabled && g.seasonId && g.seasonId !== s.currentId) throw new HttpsError('failed-precondition', 'closedSeasonGame');
      const now = this.now();
      const period = s?.enabled ? s.currentId : s?.disabledAt ? `off_${s.count ?? 0}_${s.disabledAt}` : undefined;
      const patch: Data = { status: 'active', updatedAt: now, ...(period ? { seasonId: period } : {}), seasonStartedAt: g.seasonStartedAt ?? now };
      if (g.liveMatch) Object.assign(patch, { 'liveMatch.phase': 'roundRunning', 'liveMatch.startedAt': g.liveMatch.startedAt ?? now });
      else patch.liveMatch = { phase: 'roundRunning', assignments: {}, benchOrder: [], scoreA: 0, scoreB: 0, startedAt: now };
      tx.update(ref, patch);
      if (clubRef) tx.update(clubRef, { updatedAt: now });
    });
    return { ok: true };
  }

  async enable(data: Data, uid: string) {
    const { ref, g, s } = await this.admin(data.groupId, uid); this.checkRequest(data, s);
    if (s.enabled) throw new HttpsError('failed-precondition', 'seasons already on');
    const choice: SeasonHistoryChoice = data.historyChoice;
    if (!['fresh', 'sealNow', 'continue'].includes(choice)) throw new HttpsError('invalid-argument', 'season-policy:historyChoiceRequired');
    const preview = s.operation?.context?.preview ?? await this.preview(ref.id, uid), now = s.operation?.context?.now ?? this.now();
    if (data.historySnapshot && (data.historySnapshot.played !== preview.played || data.historySnapshot.startsAt !== preview.startsAt || data.historySnapshot.unverified !== preview.unverified)) {
      throw new HttpsError('failed-precondition', 'season-operation:stale');
    }
    const pool = await unassignedSeasonActivity(this.db, ref.id, s, await this.games(ref.id), this.now());
    const candidate = pool.games;
    if (candidate.some(d => d.get('status') === 'active' || (['open', 'locked'].includes(d.get('status')) && d.get('startsAt') <= this.now() && !!playEvidence(d.data())))) throw new HttpsError('failed-precondition', 'openGame');
    if (preview.unverified) throw new HttpsError('failed-precondition', 'season-policy:unverified');
    if (choice === 'sealNow' && preview.played < MIN_SEASON_ROUNDS) throw new HttpsError('failed-precondition', `season-close:tooFewRounds:${preview.played}:${MIN_SEASON_ROUNDS}`);
    const startedAt = choice === 'continue' && preview.played ? preview.startsAt : now;
    const type = data.cadenceType === 'rounds' ? 'rounds' : 'date';
    const target = makeSeasonTarget(type, Number(type === 'rounds' ? data.targetRounds : data.months), todayIn(undefined, startedAt));
    const valid = validateSeasonTarget({ target, played: choice === 'continue' ? preview.played : 0,
      includedHistory: choice === 'continue' ? preview.played : 0, now, activation: true });
    if (!valid.ok) throw new HttpsError('failed-precondition', `season-plan:${valid.error}`);
    const operation = await acquireSeasonOperation(this.db, ref, s, 'enableClubSeasons', data); let ok = false;
    try {
      if (!s.operation?.context) {
        const current = await this.preview(ref.id, uid);
        if (current.played !== preview.played || current.startsAt !== preview.startsAt || current.unverified !== preview.unverified) throw new HttpsError('failed-precondition', 'season-operation:stale');
        for (const d of candidate) {
          const v = d.data();
          if (didEveningHappen(v) && ['admin', 'auto'].includes(v.endedBy) && !(await this.db.doc(`roundSummaries/${d.id}`).get()).exists) {
            throw new HttpsError('failed-precondition', 'unsealedGame');
          }
        }
      }
      const poolSourceIds: string[] = s.operation?.context?.poolSourceIds ?? pool.periods.map(d => d.id);
      if (!s.operation?.context) await ref.update({ 'seasons.operation.context': { preview, now, poolSourceIds } });
      const count = s.count ?? 0, oldNo = count + 1;
      const periodId = choice === 'sealNow' || choice === 'continue' ? `s${oldNo}` : `off_${count}_${now}_${s.revision ?? 0}`;
      await operation.markMutating();
      await restoreUnassignedPeriods(this.db, ref.id, poolSourceIds, periodId, now);
      await this.stamp(candidate, periodId);
      if (choice !== 'continue') await closeSeason({ db: this.db, groupId: ref.id, groupName: g.name ?? '',
        seasonId: periodId, seasonNo: choice === 'sealNow' ? oldNo : count,
        startsAt: preview.startsAt, completedRounds: preview.played, nonSeason: choice !== 'sealNow', deferPublication: choice === 'sealNow', now });
      const closed = count + (choice === 'sealNow' ? 1 : 0), no = closed + 1;
      const allTime = (await this.db.collection('clubRecords').doc(ref.id).get()).get('eveningsSealed') ?? 0;
      await ref.set({ seasons: { operation: { phase: false }, enabled: true, policyVersion: SEASON_POLICY_VERSION,
        revision: (s.revision ?? 0) + 1, currentNo: no, currentId: `s${no}`, count: closed, startedAt,
        roundsAtStart: allTime, playedRounds: choice === 'continue' ? preview.played : 0,
        includedHistory: choice === 'continue' ? preview.played : 0, cadence: target,
        nextCadence: { ...target, ...(type === 'rounds' ? { targetRounds: Math.min(200, target.targetRounds!) } : {}) },
        hasArchivedPeriods: s.hasArchivedPeriods === true || choice === 'fresh', targetHistory: [],
        pendingClose: del(), manualClose: del(), dueBlockedSince: del(), targetMovedToClose: del(), reopenedAt: del() } }, { merge: true });
      ok = true;
      if (choice === 'sealNow') await publishSeason(this.db, ref.id, `s${oldNo}`);
      if (choice === 'sealNow') await this.deps.announce({ groupId: ref.id, groupName: g.name ?? '', seasonId: `s${oldNo}`, seasonNo: oldNo });
      return { ok: true, currentNo: no };
    } finally { await operation.finish(ok); }
  }

  private async stamp(games: admin.firestore.QueryDocumentSnapshot[], periodId: string) {
    for (let start = 0; start < games.length; start += 400) {
      const batch = this.db.batch();
      for (const d of games.slice(start, start + 400)) {
        if (['finished', 'cancelled'].includes(d.get('status')) || d.get('startsAt') <= this.now()) batch.update(d.ref, { seasonId: periodId });
      }
      await batch.commit();
    }
  }

  async updateTarget(data: Data, uid: string) {
    const { ref, g, s } = await this.admin(data.groupId, uid); this.checkRequest(data, s);
    assertSeasonTargetEditable(s, this.now());
    if (!s.enabled) throw new HttpsError('failed-precondition', 'seasons are off');
    if (s.manualClose) throw new HttpsError('failed-precondition', 'season-operation:busy');
    const now = this.now(), type = data.cadenceType === 'rounds' ? 'rounds' : 'date';
    const target = makeSeasonTarget(type, Number(type === 'rounds' ? data.targetRounds : data.months), todayIn(undefined, data.scope === 'next' ? now : s.startedAt || now));
    const valid = validateSeasonTarget({ target, played: data.scope === 'next' ? 0 : s.playedRounds ?? 0,
      previousType: data.scope === 'next' ? undefined : s.cadence?.type, includedHistory: data.scope === 'next' ? 0 : s.includedHistory, now });
    if (!valid.ok) throw new HttpsError('failed-precondition', `season-plan:${valid.error}`);
    const user = await this.db.collection('users').doc(uid).get();
    const op = await acquireSeasonOperation(this.db, ref, s, 'updateSeasonTarget', data,
      sea => assertSeasonTargetEditable(sea, this.now())); let ok = false;
    try {
      const patch: Data = { operation: { phase: false }, revision: (s.revision ?? 0) + 1, policyVersion: SEASON_POLICY_VERSION };
      if (data.scope === 'next') patch.nextCadence = target;
      else {
        patch.cadence = target;
        patch.targetHistory = admin.firestore.FieldValue.arrayUnion({ at: now, by: uid, byName: user.get('name') ?? '', from: s.cadence ?? null,
          to: target, playedAtMove: s.playedRounds ?? 0, endsTheSeason: valid.due });
        if (!valid.due) patch.pendingClose = del();
        else if (!s.pendingClose) patch.pendingClose = del(); // temporary operation guard is not a correction window
      }
      await ref.set({ seasons: patch }, { merge: true }); ok = true;
    } finally { await op.finish(ok); }
    await this.refresh(ref.id);
    return { ok: true, cadence: target, endsTheSeason: valid.due };
  }

  async requestClose(data: Data, uid: string, action: 'close' | 'disable') {
    const { ref, g, s } = await this.admin(data.groupId, uid); this.checkRequest(data, s);
    assertSeasonTargetEditable(s, this.now());
    if (!s.enabled) throw new HttpsError('failed-precondition', 'seasons are off');
    const user = await this.db.collection('users').doc(uid).get();
    await this.db.runTransaction(async tx => {
      const fresh = await tx.get(ref), sea = fresh.get('seasons') ?? {};
      this.checkRequest(data, sea);
      assertSeasonTargetEditable(sea, this.now());
      if (sea.operation || sea.manualClose) throw new HttpsError('failed-precondition', 'season-operation:busy');
      tx.update(ref, { 'seasons.revision': (sea.revision ?? 0) + 1,
        'seasons.manualClose': { action, by: uid, byName: user.get('name') ?? '', at: this.now() },
        'seasons.pendingClose': { seasonId: sea.currentId, reason: 'manual', dueAt: this.now(), closeAt: this.now() } });
    });
    await this.refresh(ref.id);
    const latest = (await ref.get()).get('seasons');
    return { ok: true, waiting: !!latest?.manualClose, closedNo: s.currentNo };
  }

  async refresh(groupId: string): Promise<void> {
    const ref = this.db.collection('groups').doc(groupId), snap = await ref.get(), g = snap.data();
    const s = g?.seasons as Data | undefined;
    if (!s?.enabled || !s.currentId) return;
    if (typeof s.playedRounds !== 'number') {
      const played = (await this.games(groupId)).filter(d => this.belongs(d.data(), s) && didEveningHappen(d.data())).length;
      await this.patchIfFresh(ref, snap, { playedRounds: played });
      return this.refresh(groupId);
    }
    if (s.operation) {
      if (s.operation.until <= this.now() && this.operationApplied(s)) {
        await this.releaseAppliedOperation(ref, s.operation.token); return this.refresh(groupId);
      }
      if (s.operation.kind === 'finishSeason' && s.operation.until <= this.now()) await this.finish(groupId);
      return;
    }
    const now = this.now(), played = s.playedRounds ?? 0, manual = s.manualClose;
    const blockers = await this.blockers(groupId, s);
    let p: CorrectionWindow | undefined = s.pendingClose?.seasonId === s.currentId ? s.pendingClose : undefined;
    const due = seasonTargetDue(s.cadence, played, now);
    if (!manual && (!due || played < MIN_SEASON_ROUNDS)) {
      if (s.pendingClose) await this.patchIfFresh(ref, snap, { pendingClose: del() });
      return;
    }
    // Target changes while a round is active are evaluated after the round.
    if (!p && blockers.active > 0 && !manual) return;
    p ??= { seasonId: s.currentId, dueAt: now, closeAt: now + CORRECTION_WINDOW_MS, reason: s.cadence.type };
    const next = updateCorrectionWindow(p, blockers.unverified, now);
    if (JSON.stringify(next) !== JSON.stringify(s.pendingClose)) {
      if (!await this.patchIfFresh(ref, snap, { pendingClose: next })) return;
    }
    if (blockers.active || blockers.unverified || blockers.unsealed || next.pausedAt != null || (!manual && next.closeAt > now)) return;
    await this.finish(groupId);
  }

  private async patchIfFresh(ref: admin.firestore.DocumentReference, snap: admin.firestore.DocumentSnapshot, patch: Data) {
    try { await ref.update(Object.fromEntries(Object.entries(patch).map(([key, value]) => [`seasons.${key}`, value])), { lastUpdateTime: snap.updateTime! }); return true; }
    catch (err) { if ((err as {code?: number}).code === 9) return false; throw err; }
  }

  private async finish(groupId: string) {
    if (this.closedThisSweep >= this.maxCloses) return;
    const ref = this.db.collection('groups').doc(groupId), snap = await ref.get(), g = snap.data()!, s = g.seasons;
    if (!s?.enabled || (s.operation && (s.operation.kind !== 'finishSeason' || s.operation.until > this.now()))) return;
    const p = s.pendingClose as CorrectionWindow | undefined;
    if (!p || p.seasonId !== s.currentId || p.pausedAt != null || p.closeAt > this.now()) return;
    const op = await acquireSeasonOperation(this.db, ref, s, 'finishSeason', { seasonId: s.currentId }); let ok = false;
    try {
      const blockers = await this.blockers(groupId, s);
      if (blockers.active || blockers.unverified || blockers.unsealed) { ok = true; return; }
      const now = this.now(), played = s.playedRounds ?? 0, cancelled = seasonClosureKind(played) === 'cancelled';
      const cancelAt = s.manualClose?.at ?? now;
      const periodId = cancelled ? `off_${s.count ?? 0}_${cancelAt}` : s.currentId;
      await op.markMutating();
      if (cancelled) await this.stamp((await this.games(groupId)).filter(d => this.belongs(d.data(), s)), periodId);
      if (cancelled) await this.db.collection('seasonSummary').doc(`${groupId}__cancelled_${s.currentNo}_${s.startedAt}`).set({
        groupId, kind: 'cancelledAttempt', nonSeason: true, sourceSeasonId: s.currentId,
        startsAt: s.startedAt ?? 0, endsAt: cancelAt, attemptedRounds: played, closedBy: s.manualClose?.by ?? '',
      }, { merge: true });
      else await closeSeason({ db: this.db, groupId, groupName: g.name ?? '', seasonId: periodId,
        seasonNo: s.currentNo, startsAt: s.startedAt ?? 0, completedRounds: played, roundsAtStart: s.roundsAtStart ?? 0,
        nonSeason: cancelled, deferPublication: !cancelled, endedEarly: !!s.manualClose, closedBy: s.manualClose?.by ?? '',
        closedByName: s.manualClose?.byName ?? '', originalTarget: s.cadence, targetHistory: s.targetHistory ?? [], now });
      const count = (s.count ?? 0) + (cancelled ? 0 : 1), no = count + 1;
      const saved: SeasonTarget = s.nextCadence ?? s.cadence;
      const defaults: SeasonTarget = saved.type === 'rounds'
        ? { ...saved, targetRounds: Math.max(5, Math.min(200, Number(saved.targetRounds) || 24)) }
        : { ...saved, months: Math.max(1, Math.min(24, Number(saved.months) || 3)) };
      const target = makeSeasonTarget(defaults.type, defaults.type === 'rounds' ? defaults.targetRounds! : defaults.months!, todayIn(undefined, now));
      const sealed = (await this.db.collection('clubRecords').doc(groupId).get()).get('eveningsSealed') ?? 0;
      await this.db.runTransaction(async tx => {
        const fresh = await tx.get(ref), sea = fresh.get('seasons');
        if (sea?.operation?.token !== op.token || sea.currentId !== s.currentId) throw new HttpsError('failed-precondition', 'season-operation:stale');
        const disabled = cancelled || s.manualClose?.action === 'disable';
        tx.set(ref, { seasons: { operation: { phase: false }, enabled: !disabled,
          ...(disabled ? { disabledAt: cancelled ? cancelAt : now } : {}), policyVersion: SEASON_POLICY_VERSION,
          revision: (sea.revision ?? 0) + 1, currentNo: no, currentId: `s${no}`, count, startedAt: now,
          roundsAtStart: sealed, playedRounds: 0, includedHistory: 0, cadence: target, nextCadence: defaults,
          hasArchivedPeriods: s.hasArchivedPeriods === true, pendingClose: del(), manualClose: del(),
          targetHistory: [], targetMovedToClose: del(), dueBlockedSince: del(), reopenedAt: del() } }, { merge: true });
      });
      ok = true;
      this.closedThisSweep++;
      if (!cancelled) await publishSeason(this.db, groupId, s.currentId);
      if (!cancelled) await this.deps.announce({ groupId, groupName: g.name ?? '', seasonId: s.currentId, seasonNo: s.currentNo });
    } finally { await op.finish(ok); }
  }

  async sweep() {
    this.maxCloses = 5;
    await this.recoverPublications();
    let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      let q = this.db.collection('groups').where('seasons.enabled', '==', true).orderBy(admin.firestore.FieldPath.documentId()).limit(100);
      if (cursor) q = q.startAfter(cursor);
      const page = await q.get();
      for (const d of page.docs) {
        try { await this.refresh(d.id); }
        catch (err) { await this.deps.report({ operation: 'seasonRollover', err, context: { groupId: d.id } }); }
      }
      if (page.size < 100) return;
      cursor = page.docs[page.size - 1];
    }
  }

  private async recoverPublications() {
    let cursor: admin.firestore.QueryDocumentSnapshot | undefined, published = 0;
    for (;;) {
      let q = this.db.collection('seasonSummary').where('notificationPending', '==', true).orderBy(admin.firestore.FieldPath.documentId()).limit(100);
      if (cursor) q = q.startAfter(cursor);
      const page = await q.get();
      for (const d of page.docs) {
        const v = d.data();
        try {
          if (await publishSeason(this.db, v.groupId, v.seasonId)) {
            await this.deps.announce({ groupId: v.groupId, groupName: v.groupName ?? '', seasonId: v.seasonId, seasonNo: v.no });
            if (++published >= 5) return;
          }
        } catch (err) { await this.deps.report({ operation: 'seasonPublication', err, context: { groupId: v.groupId } }); }
      }
      if (page.size < 100) return;
      cursor = page.docs[page.size - 1];
    }
  }

  async resume(groupId: string, uid: string) {
    const { s } = await this.admin(groupId, uid), op = s.operation;
    if (!op) { await this.refresh(groupId); return { ok: true }; }
    if (op.until > this.now()) throw new HttpsError('failed-precondition', 'season-operation:busy');
    const intent = JSON.parse(op.intent ?? '{}');
    if (this.operationApplied(s)) {
      const ref = this.db.collection('groups').doc(groupId);
      await this.releaseAppliedOperation(ref, op.token);
      await this.refresh(groupId); return { ok: true };
    }
    if (op.kind === 'enableClubSeasons') return this.enable(intent, uid);
    if (op.kind === 'updateSeasonTarget') return this.updateTarget(intent, uid);
    if (op.kind === 'finishSeason') { await this.finish(groupId); return { ok: true }; }
    throw new HttpsError('failed-precondition', 'season-operation:stale');
  }

  private operationApplied(s: Data): boolean {
    const op = s.operation, intent = JSON.parse(op?.intent ?? '{}');
    const desired = intent.scope === 'next' ? s.nextCadence : s.cadence;
    return !op?.phase && ((op?.kind === 'enableClubSeasons' && s.enabled) ||
      (op?.kind === 'updateSeasonTarget' && desired?.type === intent.cadenceType &&
        (desired.type === 'rounds' ? desired.targetRounds === intent.targetRounds : desired.months === intent.months)) ||
      (op?.kind === 'finishSeason' && (!s.enabled || s.currentId !== intent.seasonId)));
  }

  private async releaseAppliedOperation(ref: admin.firestore.DocumentReference, token: string) {
    await this.db.runTransaction(async tx => {
      const snap = await tx.get(ref); if (snap.get('seasons.operation.token') !== token) return;
      tx.update(ref, { 'seasons.operation': del(), ...(snap.get('seasons.pendingClose.temporary') ? { 'seasons.pendingClose': del() } : {}) });
    });
  }
}
