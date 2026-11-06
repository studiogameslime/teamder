import { LocalUsageEvent, UsageContext, UsageEvent, UsageAction, USAGE_SCHEMA, validUsageEvent, usageWire, usageScreenKey } from '../utils/usageActivity';

export const USAGE_QUEUE_KEY = 'teamder:usage-activity:v1';
const MAX_EVENTS = 500, MAX_AGE = 7 * 86400000;
type Store = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
type Options = { storage: Store; now: () => number; uuid: () => string; identity: () => string | null; platform: string; appVersion: string; send: (uid: string, events: UsageEvent[]) => Promise<{ acknowledged: string[]; rejected?: string[]; retryAfterMs?: number }>; diagnostic: (reason: string) => void; onBatchReady?: () => void };

/** One process owns visits; disk owns acknowledged delivery. No last-user inference. */
export class UsageActivityQueue {
  private visit = ''; private sequence = 0; private uid: string | null = null;
  private claimed = new Map<string, string>(); private pending: LocalUsageEvent[] = [];
  private lost = new Map<string, LocalUsageEvent>();
  private saving = false;
  private forgotten = new Set<string>();
  private chain: Promise<void> = Promise.resolve(); private backgroundAt: number | null = null;
  private active = true; private screenKey = ''; private initialized = false;
  retryAfterMs = 0;
  constructor(private o: Options) {}
  private newVisit() { this.visit = this.o.uuid(); this.sequence = 0; this.screenKey = ''; }
  syncIdentity() {
    const next = this.o.identity();
    if (!this.visit) this.newVisit();
    if (next === this.uid) return;
    if (this.uid === null && next) this.claimed.set(this.visit, next);
    else this.newVisit();
    this.uid = next;
  }
  resetIdentity() { this.newVisit(); this.uid = this.o.identity(); }
  forgetOwner(uid: string): Promise<void> {
    this.forgotten.add(uid);
    const owns = (e: LocalUsageEvent) => (e.ownerUid ?? this.claimed.get(e.visitId)) === uid;
    this.pending = this.pending.filter(e => !owns(e));
    for (const [key, e] of this.lost) if (owns(e)) this.lost.delete(key);
    return this.enqueue(async () => {
      const rows = await this.read();
      await this.o.storage.setItem(USAGE_QUEUE_KEY, JSON.stringify(rows.filter(e => !owns(e))));
    });
  }
  start() { if (this.initialized) return; this.syncIdentity(); this.record('app_opened'); this.initialized = true; }
  beginRegistration(gameId: string, operationId: string): (result: UsageEvent['result']) => void {
    this.syncIdentity();
    const visit = this.visit, uid = this.uid, resultSequence = this.sequence + 2;
    this.record('registration_attempt', { gameId, operationId, resultSequence });
    ++this.sequence; // Reserve a stable slot for the server outcome, including after process death.
    return result => {
      const owner = uid ?? this.claimed.get(visit);
      if (owner && this.forgotten.has(owner)) return;
      const event: LocalUsageEvent = { gameId, operationId, result, action: 'registration_result', visitId: visit, sequence: resultSequence, eventId: `${visit}-${resultSequence}`, ownerUid: uid, occurredAt: this.o.now(), platform: this.o.platform, appVersion: this.o.appVersion, schemaVersion: USAGE_SCHEMA };
      this.append(event);
    };
  }
  appState(state: string) {
    if (state !== 'active') this.active = false;
    if (state === 'background') { if (this.backgroundAt === null) this.backgroundAt = this.o.now(); this.active = false; }
    if (state !== 'active') return;
    this.active = true; this.syncIdentity();
    if (!this.initialized) { this.backgroundAt = null; this.start(); return; }
    const elapsed = this.backgroundAt === null ? 0 : this.o.now() - this.backgroundAt;
    this.backgroundAt = null;
    if (elapsed >= 30 * 60_000) { this.newVisit(); this.record('app_opened'); }
    else if (elapsed >= 30_000) this.record('app_returned');
  }
  screen(context: UsageContext) {
    this.syncIdentity();
    if (this.uid && this.forgotten.has(this.uid)) return;
    const key = context.screen ? usageScreenKey(context) : '';
    if (!this.active || key === this.screenKey) return;
    this.screenKey = key;
    if (key) this.record('screen_view', context);
  }
  record(action: UsageAction, context: UsageContext & { productKey?: string; operationId?: string; resultSequence?: number; result?: UsageEvent['result'] } = {}): void {
    this.syncIdentity();
    if (this.uid && this.forgotten.has(this.uid)) return;
    const event: LocalUsageEvent = { ...context, action, visitId: this.visit, sequence: ++this.sequence, eventId: `${this.visit}-${this.sequence}`, occurredAt: this.o.now(), ownerUid: this.uid, schemaVersion: USAGE_SCHEMA, platform: this.o.platform, appVersion: this.o.appVersion };
    this.append(event);
  }
  private append(event: LocalUsageEvent): void {
    if (!validUsageEvent(event)) { this.o.diagnostic('invalid_event'); return; }
    this.pending.push(event);
    // Bound memory even when local storage keeps failing.
    if (this.pending.length > MAX_EVENTS) {
      const at = this.pending.findIndex(e => e.action === 'screen_view');
      const dropped = this.pending.splice(at < 0 ? 0 : at, 1)[0];
      this.lost.set(`${dropped.ownerUid}:${dropped.visitId}`, { ...dropped, action: 'coverage_gap', occurredAt: this.o.now(), screen: undefined, productKey:undefined, operationId: undefined, result: undefined });
      this.o.diagnostic('memory_gap');
    }
    void this.persist();
  }
  private enqueue(work: () => Promise<void>) {
    this.chain = this.chain.then(work).catch(() => { this.o.diagnostic('delivery_or_storage_failure'); });
    return this.chain;
  }
  private async read(): Promise<LocalUsageEvent[]> {
    const raw = await this.o.storage.getItem(USAGE_QUEUE_KEY);
    let values: unknown = [];
    try { values = raw ? JSON.parse(raw) : []; } catch { this.o.diagnostic('invalid_storage'); }
    if (!Array.isArray(values)) { this.o.diagnostic('invalid_storage'); return []; }
    return values.filter((e): e is LocalUsageEvent => validUsageEvent(e) && ((e as LocalUsageEvent).ownerUid === null || typeof (e as LocalUsageEvent).ownerUid === 'string'))
      .filter(e => e.ownerUid !== null || e.visitId === this.visit || this.claimed.has(e.visitId))
      .map(e => ({ ...usageWire(e), ownerUid: e.ownerUid ?? this.claimed.get(e.visitId) ?? null }))
      .filter(e => !e.ownerUid || !this.forgotten.has(e.ownerUid));
  }
  private async savePending() {
    const saved = await this.read(), lost = new Map(this.lost), written = [...this.pending, ...lost.values()];
    const rows = new Map(saved.map(e => [e.eventId + ':' + e.ownerUid, e]));
    for (const e of written) { const row = { ...e, ownerUid: e.ownerUid ?? this.claimed.get(e.visitId) ?? null }; rows.set(row.eventId + ':' + row.ownerUid, row); }
    let queue = [...rows.values()]; const removed: LocalUsageEvent[] = [];
    queue = queue.filter(e => { if (this.o.now() - e.occurredAt > MAX_AGE) { removed.push(e); return false; } return true; });
    while (queue.length > MAX_EVENTS) { const index = queue.findIndex(e => e.action === 'screen_view'); removed.push(...queue.splice(index < 0 ? 0 : index, 1)); }
    // Preserve explicit gap events for the visits affected, rather than moving loss to the current user.
    for (const e of removed) {
      const gap = queue.find(row => row.visitId === e.visitId && row.ownerUid === e.ownerUid && row.action === 'coverage_gap');
      if (!gap) queue.push({ ...e, occurredAt: this.o.now(), action: 'coverage_gap', screen: undefined, productKey:undefined, operationId: undefined, result: undefined });
    }
    if (queue.length > MAX_EVENTS) queue = queue.slice(-MAX_EVENTS);
    await this.o.storage.setItem(USAGE_QUEUE_KEY, JSON.stringify(queue));
    const ids = new Set(written.map(e => e.eventId)); this.pending = this.pending.filter(e => !ids.has(e.eventId));
    for (const [key, value] of lost) if (this.lost.get(key) === value) this.lost.delete(key);
    return queue.filter(e => e.ownerUid === this.o.identity()).length;
  }
  persist() {
    if (this.saving) return this.chain;
    this.saving = true;
    return this.enqueue(async () => {
      try { if (await this.savePending() >= 20) this.o.onBatchReady?.(); }
      finally { this.saving = false; }
      if (this.pending.length || this.lost.size) void this.persist();
    });
  }
  flush() {
    return this.enqueue(async () => {
      this.syncIdentity(); await this.savePending();
      const uid = this.o.identity(); if (!uid || this.o.now() < this.retryAfterMs) return;
      const queue = await this.read(), batch = queue.filter(e => e.ownerUid === uid).slice(0, 20);
      if (!batch.length || this.o.identity() !== uid) return;
      const reply = await this.o.send(uid, batch.map(usageWire));
      const sent = new Set(batch.map(e => e.eventId));
      const accepted = new Set((reply.acknowledged ?? []).filter(id => sent.has(id)));
      const rejected = new Set((reply.rejected ?? []).filter(id => sent.has(id)));
      this.retryAfterMs = reply.retryAfterMs ? this.o.now() + Math.max(10_000, reply.retryAfterMs) : 0;
      const keep = queue.filter(e => e.ownerUid !== uid || (!accepted.has(e.eventId) && !rejected.has(e.eventId)));
      // Permanent rejection leaves an explicit gap, with an unsent id and its original owner.
      for (const e of batch.filter(e => rejected.has(e.eventId))) if (e.action !== 'coverage_gap') keep.push({ ...e, action: 'coverage_gap', screen: undefined, productKey:undefined, operationId: undefined, result: undefined });
      await this.o.storage.setItem(USAGE_QUEUE_KEY, JSON.stringify(keep));
      if (rejected.size) this.o.diagnostic('rejected_gap');
      if (!this.retryAfterMs && keep.filter(e => e.ownerUid === uid).length >= 20) this.o.onBatchReady?.();
    });
  }
}
