"use strict";
// StatBatch — one Firestore write per DOCUMENT, not one per stat.
//
// Why this exists (audit P1-12).
//
// commitRoundStats used to call `batch.set()` once per stat it credited, and a
// WriteBatch counts every call as an operation even when several land on the
// SAME document. A single player could take five separate ops on one
// gamePlayerStats row (goals, assists, penalties, rounds+cleanSheet, win), and
// the round's pair writes are quadratic on top. The real worst case at
// 11-a-side with a full 16-kick shootout and a handful of assisted goals came
// out ABOVE Firestore's 500-operation ceiling — and because the idempotency
// latch (`committedRounds/{roundId}`) is created inside that same batch, an
// overflow is not a retryable blip: commit() throws, the latch is never
// written, and every retry with the same payload fails identically. The
// evening's stats would be lost for good with no way to re-commit them.
//
// The fix is not to split the batch (that would break the atomicity the latch
// depends on) and not to drop writes. It is to stop paying for the same
// document twice: accumulate every field change in memory keyed by document
// path, then emit exactly one `set(..., {merge:true})` per document. The result
// is identical — `FieldValue.increment` is additive, so folding two increments
// for one field into their sum, and two increments of different fields into one
// payload, produces the same stored document — while the operation count drops
// from "one per stat" to "one per document touched".
//
// It also makes the ceiling COMPUTABLE: `opCount` is the exact number of
// operations the commit will use, so the caller can assert headroom instead of
// estimating it in a comment.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ROUND_BATCH_OPS = exports.StatBatch = void 0;
exports.worstCaseRoundOps = worstCaseRoundOps;
/** Expand `{'stats.goals': X}` into `{stats: {goals: X}}`. */
function nest(flat) {
    const out = {};
    for (const [path, value] of Object.entries(flat)) {
        const parts = path.split('.');
        let node = out;
        for (let i = 0; i < parts.length - 1; i++) {
            const k = parts[i];
            if (typeof node[k] !== 'object' || node[k] === null)
                node[k] = {};
            node = node[k];
        }
        node[parts[parts.length - 1]] = value;
    }
    return out;
}
class StatBatch {
    constructor() {
        /** `create()`s — kept separate because they must stay creates (the
         *  idempotency latch relies on ALREADY_EXISTS), never merged into a set. */
        this.creates = [];
        /** Insertion-ordered so the emitted batch is deterministic (test-friendly). */
        this.order = [];
        this.entries = new Map();
    }
    /** A create that must fail if the document already exists. */
    create(ref, data) {
        this.creates.push({ ref, data });
    }
    /**
     * Fold field changes into this document's pending write.
     *
     * `statics` are plain values (ids, timestamps); repeating them is harmless.
     * `deltas` are numeric increments keyed by dotted path — calling `bump` twice
     * for the same field SUMS them, which is what makes de-duplication safe.
     */
    bump(ref, statics, deltas = {}) {
        const key = ref.path;
        let e = this.entries.get(key);
        if (!e) {
            e = { ref, statics: {}, deltas: {} };
            this.entries.set(key, e);
            this.order.push(key);
        }
        Object.assign(e.statics, statics);
        for (const [field, d] of Object.entries(deltas)) {
            if (!Number.isFinite(d))
                continue;
            e.deltas[field] = (e.deltas[field] ?? 0) + d;
        }
    }
    /** Distinct documents this batch will touch (excluding creates). */
    get docCount() {
        return this.order.length;
    }
    /** EXACT number of Firestore operations `commit()` will issue. */
    get opCount() {
        return this.creates.length + this.order.length;
    }
    /** Document paths, in insertion order — for assertions and debugging. */
    get paths() {
        return [...this.order];
    }
    /**
     * Materialise into a real WriteBatch.
     *
     * `increment` is injected rather than imported so this module stays a pure,
     * unit-testable function of its inputs (the tests pass a stub that records
     * the deltas verbatim).
     */
    build(batch, increment) {
        for (const c of this.creates) {
            batch.create(c.ref, c.data);
        }
        for (const key of this.order) {
            const e = this.entries.get(key);
            const flat = { ...e.statics };
            for (const [field, d] of Object.entries(e.deltas)) {
                flat[field] = increment(d);
            }
            batch.set(e.ref, nest(flat), { merge: true });
        }
        return batch;
    }
}
exports.StatBatch = StatBatch;
/**
 * Hard ceiling for one committed round.
 *
 * Firestore's limit is 500 operations per batch. We refuse well below it: a
 * commit that would overflow is unrecoverable (see the header), so failing the
 * request with a clear message beats discovering the ceiling on the one evening
 * a club fields eleven a side. The gap between this and 500 is the safety
 * margin the audit asked for.
 */
exports.MAX_ROUND_BATCH_OPS = 440;
/**
 * Worst-case operation count for a round, computed rather than estimated.
 *
 * With per-document de-duplication the count is bounded by the number of
 * DISTINCT documents a round can touch:
 *
 *   1                       committedRounds latch (create)
 *   1                       communityStats  (only when the game has a group)
 *   a + b                   users            (one row per real player)
 *   a + b                   communityPlayerStats (only when grouped)
 *   a + b + guests          gamePlayerStats
 *   a*b + C(a,2) + C(b,2)   pairStats — every against pair plus every same-team
 *                           pair. Assist pairs need no extra document: both
 *                           players are on the field, so their pair is already
 *                           one of these.
 *   min(assistPairs, …)     communityPairStats — the only club-scoped pair doc,
 *                           written for assisted goals alone.
 */
function worstCaseRoundOps(input) {
    const a = Math.max(0, input.a);
    const b = Math.max(0, input.b);
    const guests = Math.max(0, input.guests ?? 0);
    const grouped = input.grouped !== false;
    const choose2 = (n) => (n * (n - 1)) / 2;
    const pairDocs = a * b + choose2(a) + choose2(b);
    // An assist pair is a pair of two on-field players, so its pairStats doc is
    // already counted above; only its club-scoped twin is new.
    const communityPairDocs = grouped
        ? Math.min(input.assistPairs ?? 0, pairDocs)
        : 0;
    return (1 + // latch
        (grouped ? 1 : 0) + // communityStats
        (a + b) + // users
        (grouped ? a + b : 0) + // communityPlayerStats
        (a + b + guests) + // gamePlayerStats
        pairDocs +
        communityPairDocs);
}
