import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, onDocumentUpdated, type CallableRequest } from './observedFunctions';
import { ENFORCE_APP_CHECK } from './appCheckPolicy';
import { ExpectedCallableError as HttpsError } from './expectedCallableError';
import { personalActivityPlayerIds } from './personalActivityWindows';

type Data = Record<string, any>;
export interface ActivityRange { from: number; to: number }
export interface PersonalActivitySample {
  id: string; startAtMs: number; endAtMs: number;
  distanceM?: number; steps?: number; calories?: number; heartRateBpm?: number;
}
export interface PersonalActivityUpload {
  expectedUid: string; gameId: string; sessionId: string; revision: number;
  source: 'wear-health-services'; offsetMs: number; clockUncertaintyMs: number;
  samples: PersonalActivitySample[];
}
export interface ActivitySegment extends ActivityRange {
  eligibleFrom: number; eligibleTo: number; playerIds: string[]; timerRunning: boolean;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const list = (v: unknown): Data[] => Array.isArray(v) ? v : [];
const fail = (message: string): never => { throw new HttpsError('invalid-argument', message); };
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return fail('Invalid identifier');
  return value;
}
function owner(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Full account required');
  if (request.data?.expectedUid !== uid) throw new HttpsError('failed-precondition', 'Account changed');
  return uid;
}
function assertActiveActivityOwner(profile: { exists: boolean; data(): Data | undefined }): void {
  if (!profile.exists) throw new HttpsError('failed-precondition', 'Account profile unavailable');
  const data = profile.data();
  if (!data || data.deletedAt !== undefined && data.deletedAt !== null) {
    throw new HttpsError('failed-precondition', 'Account deleted');
  }
  if (data.isGuest === true) throw new HttpsError('permission-denied', 'Full account required');
}

/** Account anonymization is committed before Auth deletion. Reading that profile
 * inside every upload transaction prevents an old token recreating health data.
 * Retried cleanup is safe and includes all nested sessions/chunks. */
export const onPersonalActivityOwnerDeleted = onDocumentUpdated({ document: 'users/{uid}', retry: true }, async event => {
  const after = event.data?.after.data();
  if (!after || after.deletedAt === undefined || after.deletedAt === null) return;
  const db = getFirestore();
  const roots = await db.collection('personalActivityPrivate').where('userId', '==', event.params.uid).get();
  for (const root of roots.docs) {
    // recursiveDelete(DocumentReference) can remove the parent even when a child
    // delete fails. Keep the searchable owner root until every descendant is gone.
    await db.recursiveDelete(root.ref.collection('sessions'));
    await root.ref.delete();
  }
});
export function mergeActivityRanges(ranges: ActivityRange[]): ActivityRange[] {
  const sorted = ranges.filter(r => finite(r.from) && finite(r.to) && r.to > r.from)
    .map(r => ({ ...r })).sort((a, b) => a.from - b.from || a.to - b.to);
  const result: ActivityRange[] = [];
  for (const range of sorted) {
    const previous = result[result.length - 1];
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else result.push(range);
  }
  return result;
}
const duration = (ranges: ActivityRange[]) => mergeActivityRanges(ranges).reduce((sum, r) => sum + r.to - r.from, 0);
const contained = (from: number, to: number, ranges: ActivityRange[]) => ranges.some(r => r.from <= from && r.to >= to);
const overlaps = (a: ActivityRange, b: ActivityRange) => a.from < b.to && b.from < a.to;

/** Every transition is independent: duplicate or out-of-order trigger delivery is safe.
 * Commit timestamps define lineup boundaries. Never reconstruct history from a final roster. */
export function activitySegment(before: Data, after: Data, from: number, to: number): ActivitySegment | null {
  if (!finite(from) || !finite(to) || to <= from) return null;
  const lm = before.liveMatch ?? {};
  const running = lm.timerRunning === true && finite(lm.timerLastStartedAt) && lm.timerLastStartedAt >= 0 &&
    lm.timerLastStartedAt <= to && before.status !== 'finished' && before.status !== 'cancelled' && lm.phase !== 'finished';
  let eligibleFrom = from, eligibleTo = to;
  if (running && finite(lm.timerLastStartedAt)) eligibleFrom = Math.max(from, lm.timerLastStartedAt);
  // Only a newly appended, valid stopping interval can shorten this transition.
  // Some legacy rotation writers stop without appending one: keep commit boundary.
  if (running && after.liveMatch?.timerRunning !== true) {
    const old = new Set(list(lm.activeIntervals).map(iv => `${iv.s}:${iv.e}`));
    const ends = list(after.liveMatch?.activeIntervals).filter(iv => finite(iv.s) && finite(iv.e) && iv.e >= iv.s &&
      iv.e >= from && iv.e <= to && !old.has(`${iv.s}:${iv.e}`)).map(iv => iv.e as number);
    if (ends.length) eligibleTo = Math.max(...ends);
  }
  return { from, to, eligibleFrom, eligibleTo, timerRunning: running,
    playerIds: running ? personalActivityPlayerIds(before) : [] };
}

export const onGamePersonalActivityChanged = onDocumentUpdated({ document: 'games/{gameId}', retry: true }, async event => {
  const change = event.data;
  if (!change) return;
  const segment = activitySegment(change.before.data(), change.after.data(), change.before.updateTime.toMillis(), change.after.updateTime.toMillis());
  if (!segment) return;
  const stamp = change.after.updateTime;
  const id = `${stamp.seconds}_${stamp.nanoseconds}`;
  const db = getFirestore(), root = db.doc(`personalActivityJournal/${event.params.gameId}`);
  await db.runTransaction(async tx => {
    const baseline = await tx.get(root);
    // BEFORE is the actual document version that remained unchanged throughout
    // [from,to). This proves its lineup; it is not a final-roster extrapolation.
    if (!baseline.exists || baseline.data()!.knownFrom > segment.from) tx.set(root, { version: 1, knownFrom: segment.from });
    tx.set(root.collection('segments').doc(id), segment);
  });
});

export function validateActivityUpload(data: Data): PersonalActivityUpload {
  const gameId = identifier(data.gameId), sessionId = identifier(data.sessionId);
  if (!Number.isSafeInteger(data.revision) || data.revision < 1 || data.revision > 5000) return fail('Invalid revision');
  if (data.source !== 'wear-health-services') return fail('Unsupported activity source');
  if (!finite(data.offsetMs) || Math.abs(data.offsetMs) > 86400000 || !finite(data.clockUncertaintyMs) || data.clockUncertaintyMs < 0 || data.clockUncertaintyMs > 30000) return fail('Invalid clock estimate');
  if (!Array.isArray(data.samples) || !data.samples.length || data.samples.length > 300) return fail('A chunk requires 1 to 300 samples');
  const ids = new Set<string>();
  const samples: PersonalActivitySample[] = data.samples.map((sample: Data) => {
    if (!sample || typeof sample !== 'object') return fail('Invalid sample');
    if (typeof sample.id !== 'string' || !/^[A-Za-z0-9_:.-]{1,128}$/.test(sample.id)) return fail('Invalid sample identifier');
    const id = sample.id;
    if (ids.has(id)) return fail('Duplicate sample identifier');
    ids.add(id);
    if (!Number.isSafeInteger(sample.startAtMs) || !Number.isSafeInteger(sample.endAtMs) || sample.startAtMs <= 0 ||
      sample.endAtMs < sample.startAtMs || sample.endAtMs - sample.startAtMs > 300000) return fail('Invalid sample interval');
    const result: PersonalActivitySample = { id, startAtMs: sample.startAtMs, endAtMs: sample.endAtMs };
    let metrics = 0;
    for (const [key, limit] of [['distanceM', 4000], ['steps', 2000], ['calories', 300], ['heartRateBpm', 240]] as const) {
      if (sample[key] === undefined || sample[key] === null) continue;
      const n = sample[key];
      if (!finite(n) || n < (key === 'heartRateBpm' ? 25 : 0) || n > limit || (key === 'steps' && !Number.isSafeInteger(n))) return fail('Invalid metric');
      if (key !== 'heartRateBpm' && sample.endAtMs === sample.startAtMs) return fail('Delta requires positive duration');
      result[key] = n; metrics++;
    }
    if (!metrics) return fail('Sample requires a measured metric');
    return result;
  });
  return { expectedUid: data.expectedUid, gameId, sessionId, revision: data.revision, source: data.source,
    offsetMs: data.offsetMs, clockUncertaintyMs: data.clockUncertaintyMs, samples };
}

/** Contiguous journal coverage is required, not merely the largest event timestamp.
 * A hole means an event may still be in flight; clients retain their durable chunk. */
export function activityEvidence(segments: ActivitySegment[], uid: string, gameVersion: number, knownFrom?: number) {
  if (!finite(knownFrom)) return { ready: false, knownFrom: null, windows: [] as ActivityRange[] };
  const ordered = segments.filter(s => s.to > knownFrom).map(s => ({ ...s, from: Math.max(s.from, knownFrom) }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const chain = mergeActivityRanges(ordered);
  const ready = gameVersion === knownFrom || (chain.length === 1 && chain[0].from === knownFrom && chain[0].to >= gameVersion);
  const windows = mergeActivityRanges(ordered.filter(s => s.timerRunning && s.playerIds.includes(uid))
    .map(s => ({ from: Math.max(s.from, s.eligibleFrom), to: Math.min(s.to, s.eligibleTo) })));
  return { ready, knownFrom, windows };
}

const METRICS = ['distanceM', 'steps', 'calories'] as const;
type Metric = typeof METRICS[number];
export interface ActivityAccumulation {
  windows: ActivityRange[]; claimedWindows: ActivityRange[]; metricWindows: Record<Metric, ActivityRange[]>;
  totals: Record<Metric, number | null>; lastEnds: Partial<Record<Metric | 'heartRateBpm', number>>;
  heartRateSum: number; heartRateSamples: number; maxHeartRateBpm: number | null;
  acceptedSamples: number; excludedBoundarySamples: number;
}
export const emptyActivityAccumulation = (): ActivityAccumulation => ({ windows: [], claimedWindows: [],
  metricWindows: { distanceM: [], steps: [], calories: [] }, totals: { distanceM: null, steps: null, calories: null },
  lastEnds: {}, heartRateSum: 0, heartRateSamples: 0, maxHeartRateBpm: null, acceptedSamples: 0, excludedBoundarySamples: 0 });

/** Inputs are hardware deltas, never cumulative counter snapshots. A delta crossing
 * a boundary is omitted in full; proportional attribution would invent precision. */
export function accumulateActivity(previous: ActivityAccumulation, input: PersonalActivityUpload, eligible: ActivityRange[]): ActivityAccumulation {
  const result = JSON.parse(JSON.stringify(previous)) as ActivityAccumulation;
  const u = input.clockUncertaintyMs;
  const acceptedClaims: ActivityRange[] = [];
  for (const sample of [...input.samples].sort((a, b) => a.startAtMs - b.startAtMs || a.endAtMs - b.endAtMs)) {
    const from = sample.startAtMs + input.offsetMs, to = sample.endAtMs + input.offsetMs;
    let accepted = false, excluded = false;
    for (const key of METRICS) {
      const value = sample[key];
      if (value === undefined) continue;
      if (result.lastEnds[key] !== undefined && from < result.lastEnds[key]!) return fail('Overlapping or replayed metric samples');
      result.lastEnds[key] = to;
      if (!contained(from - u, to + u, eligible)) { excluded = true; continue; }
      const seconds = (to - from) / 1000;
      if ((key === 'distanceM' && value > seconds * 12) || (key === 'steps' && value > seconds * 5) || (key === 'calories' && value > seconds * 1)) return fail('Metric exceeds interval bound');
      result.totals[key] = (result.totals[key] ?? 0) + value;
      result.metricWindows[key].push({ from, to });
      result.windows.push({ from, to }); accepted = true;
    }
    if (sample.heartRateBpm !== undefined) {
      if (result.lastEnds.heartRateBpm !== undefined && to <= result.lastEnds.heartRateBpm) return fail('Replayed heart-rate sample');
      result.lastEnds.heartRateBpm = to;
      if (eligible.some(r => r.from <= to - u && to + u < r.to)) {
        result.heartRateSum += sample.heartRateBpm; result.heartRateSamples++;
        result.maxHeartRateBpm = Math.max(result.maxHeartRateBpm ?? 0, sample.heartRateBpm); accepted = true;
      } else excluded = true;
    }
    if (accepted) {
      result.acceptedSamples++;
      acceptedClaims.push({ from, to: Math.max(to, from + 0.001) });
    }
    if (excluded) result.excludedBoundarySamples++;
  }
  result.windows = mergeActivityRanges(result.windows);
  // An upload chunk claims one source for its span. A second watch cannot fill
  // the tiny gaps between HR points and double-count the same recording period.
  if (acceptedClaims.length) result.claimedWindows.push({ from: Math.min(...acceptedClaims.map(r => r.from)),
    to: Math.max(...acceptedClaims.map(r => r.to)) });
  result.claimedWindows = mergeActivityRanges(result.claimedWindows);
  for (const key of METRICS) result.metricWindows[key] = mergeActivityRanges(result.metricWindows[key]);
  if (result.windows.length + result.claimedWindows.length + METRICS.reduce((n, k) => n + result.metricWindows[k].length, 0) > 5000) {
    throw new HttpsError('resource-exhausted', 'Activity coverage fragmentation limit reached');
  }
  return result;
}

export function summarizePersonalActivity(gameId: string, sessions: ActivityAccumulation[], evidence: ReturnType<typeof activityEvidence>, now: number) {
  const eligibleMs = duration(evidence.windows), measuredMs = duration(sessions.flatMap(s => s.windows));
  const sumMetric = (key: Metric) => sessions.some(s => s.totals[key] !== null)
    ? sessions.reduce((n, s) => n + (s.totals[key] ?? 0), 0) : null;
  const heartRateSamples = sessions.reduce((n, s) => n + s.heartRateSamples, 0);
  const hasDurationMetric = METRICS.some(key => sessions.some(s => s.totals[key] !== null));
  return { version: 1 as const, gameId, source: 'wear-health-services' as const,
    eligibleMs, measuredMs, coverageRatio: eligibleMs > 0 && hasDurationMetric ? Math.min(1, measuredMs / eligibleMs) : null,
    coverageMs: Object.fromEntries(METRICS.map(key => [key, duration(sessions.flatMap(s => s.metricWindows[key]))])),
    distanceM: sumMetric('distanceM'), steps: sumMetric('steps'), calories: sumMetric('calories'),
    avgHeartRateBpm: heartRateSamples ? sessions.reduce((n, s) => n + s.heartRateSum, 0) / heartRateSamples : null,
    maxHeartRateBpm: heartRateSamples ? Math.max(...sessions.map(s => s.maxHeartRateBpm ?? 0)) : null,
    heartRateSamples, acceptedSamples: sessions.reduce((n, s) => n + s.acceptedSamples, 0),
    excludedBoundarySamples: sessions.reduce((n, s) => n + s.excludedBoundarySamples, 0),
    knownFrom: evidence.knownFrom, updatedAt: now };
}

async function journal(gameId: string, uid: string) {
  const db = getFirestore();
  const [game, rows, baseline] = await Promise.all([db.doc(`games/${gameId}`).get(),
    db.collection(`personalActivityJournal/${gameId}/segments`).limit(5001).get(), db.doc(`personalActivityJournal/${gameId}`).get()]);
  if (!game.exists) throw new HttpsError('not-found', 'Game unavailable');
  if (rows.size > 5000) throw new HttpsError('resource-exhausted', 'Activity history limit reached');
  const data = game.data()!, history = rows.docs.map(d => d.data() as ActivitySegment);
  const audience = [data.createdBy, ...list(data.players), ...list(data.waitlist), ...list(data.pending), ...list(data.participantIds)];
  if (!audience.includes(uid) && !history.some(s => s.playerIds.includes(uid))) throw new HttpsError('permission-denied', 'Activity unavailable');
  const version = game.updateTime!.toMillis();
  // With no delivered events, the current snapshot still proves its own stable
  // version through this read. A concurrent game update invalidates the upload.
  const knownFrom = baseline.data()?.knownFrom ?? version;
  const evidence = activityEvidence(history, uid, version, knownFrom);
  // The current snapshot proves that this lineup remains unchanged up to this read.
  // The upload transaction re-reads the game, so a concurrent substitution retries.
  if (evidence.ready) {
    const open = activitySegment(game.data()!, game.data()!, version, Date.now());
    if (open?.timerRunning && open.playerIds.includes(uid)) evidence.windows = mergeActivityRanges([
      ...evidence.windows, { from: open.eligibleFrom, to: open.eligibleTo }]);
  }
  return { game, version, evidence };
}
const rootPath = (gameId: string, uid: string) => `personalActivityPrivate/${hash(`${gameId}:${uid}`)}`;

export const savePersonalActivity = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const uid = owner(request), input = validateActivityUpload(request.data ?? {});
  const db = getFirestore(), root = db.doc(rootPath(input.gameId, uid));
  const state = await journal(input.gameId, uid);
  if (!state.evidence.ready) return { status: 'processing', retryable: true };
  // A late earlier event can move the baseline backward. Never acknowledge a
  // chunk whose earlier samples have not acquired authoritative history yet.
  if (input.samples.some(s => s.startAtMs + input.offsetMs < state.evidence.knownFrom!)) {
    return { status: 'processing', retryable: true, reason: 'before-journal-baseline' };
  }
  const fingerprint = hash(JSON.stringify(input));
  return db.runTransaction(async tx => {
    const sessionRef = root.collection('sessions').doc(input.sessionId);
    const chunkRef = sessionRef.collection('chunks').doc(String(input.revision));
    const [profile, game, chunk, session, sessions] = await Promise.all([tx.get(db.doc(`users/${uid}`)),
      tx.get(state.game.ref), tx.get(chunkRef), tx.get(sessionRef), tx.get(root.collection('sessions').limit(9))]);
    assertActiveActivityOwner(profile);
    if (game.updateTime?.toMillis() !== state.version) return { status: 'processing', retryable: true };
    if (chunk.exists) {
      if (chunk.data()?.fingerprint !== fingerprint) return fail('Chunk content changed');
      return { status: 'duplicate', retryable: false };
    }
    const previousRevision = Number(session.data()?.revision ?? 0), expectedRevision = previousRevision + 1;
    if (input.revision < expectedRevision) return { status: 'stale', retryable: false, expectedRevision };
    if (input.revision !== expectedRevision) return { status: 'processing', retryable: true, expectedRevision };
    if (!session.exists && sessions.size >= 8) throw new HttpsError('resource-exhausted', 'Session limit reached');
    const previous = (session.data()?.accumulation ?? emptyActivityAccumulation()) as ActivityAccumulation;
    const other = sessions.docs.filter(d => d.id !== input.sessionId).map(d => d.data().accumulation as ActivityAccumulation);
    const incomingRanges = input.samples.map(s => ({ from: s.startAtMs + input.offsetMs,
      to: Math.max(s.endAtMs + input.offsetMs, s.startAtMs + input.offsetMs + 0.001) }));
    if (other.some(s => s.claimedWindows.some(a => incomingRanges.some(b => overlaps(a, b))))) return fail('Overlapping activity sessions');
    const accumulation = accumulateActivity(previous, input, state.evidence.windows);
    const now = Date.now();
    const summary = summarizePersonalActivity(input.gameId, [...other, accumulation], state.evidence, now);
    tx.set(chunkRef, { fingerprint, revision: input.revision, samples: input.samples, offsetMs: input.offsetMs,
      clockUncertaintyMs: input.clockUncertaintyMs, receivedAt: now });
    tx.set(sessionRef, { revision: input.revision, source: input.source, accumulation, updatedAt: now });
    tx.set(root, { userId: uid, gameId: input.gameId, summary, updatedAt: now });
    return { status: 'saved', retryable: false, expectedRevision: expectedRevision + 1, summary };
  });
});

export const getMyPersonalActivity = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const uid = owner(request), gameId = identifier(request.data?.gameId);
  const db = getFirestore(), profileRef = db.doc(`users/${uid}`);
  assertActiveActivityOwner(await profileRef.get());
  const state = await journal(gameId, uid);
  if (!state.evidence.ready) return { status: 'processing', summary: null, reason: 'journal-pending' };
  const sessions = await db.collection(`${rootPath(gameId, uid)}/sessions`).limit(9).get();
  assertActiveActivityOwner(await profileRef.get());
  if (!sessions.size) return { status: 'unavailable', summary: null, reason: 'no-watch-data' };
  if (sessions.size > 8) throw new HttpsError('resource-exhausted', 'Session limit reached');
  return { status: 'available', summary: summarizePersonalActivity(gameId,
    sessions.docs.map(d => d.data().accumulation as ActivityAccumulation), state.evidence, Date.now()) };
});
