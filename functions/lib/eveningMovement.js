"use strict";
// Who you actually went past tonight, per metric.
//
// Kept out of index.ts because the rule is subtle and was wrong in production:
// it must be judged on VALUES with a strict crossing on both sides. Judging it
// on leaderboard POSITIONS looks equivalent and is not — equal values are
// ordered by uid, so a player who merely caught up to you flips above you in
// the ranking without ever going past. Eliran finished the 02.09 evening on 18
// goals with איתי דוידי also on 18, and the summary announced that איתי had
// overtaken him.
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeMovement = computeMovement;
/**
 * `passed`   — they were strictly ahead of me before, strictly behind me now.
 * `passedBy` — they were strictly behind me before, strictly ahead of me now.
 *
 * A tie on either end is not a crossing, in either direction: catching up to
 * someone is not overtaking them, and being caught is not being overtaken.
 *
 * `order` fixes the output order (the caller passes the current ranking) so the
 * names read top-down the way the leaderboard does.
 */
function computeMovement(uid, order, valueOf) {
    const me = valueOf(uid);
    const myNow = me.now;
    const myBefore = me.now - me.tonight;
    const passed = [];
    const passedBy = [];
    for (const other of order) {
        if (other === uid)
            continue;
        const o = valueOf(other);
        const oNow = o.now;
        const oBefore = o.now - o.tonight;
        if (oBefore > myBefore && oNow < myNow)
            passed.push(other);
        else if (oBefore < myBefore && oNow > myNow)
            passedBy.push(other);
    }
    return { passed, passedBy };
}
