"use strict";
// GENERATED FILE — DO NOT EDIT.
// Backend copy of src/utils/clubChemistry.ts, produced by
// functions/scripts/genClubChemistry.mjs. Edit the client source and re-run the
// generator; tests/logic/clubChemistryParity.test.ts fails if the two drift.
// Club chemistry — the notable PAIRS inside one club.
//
// Pure and import-free, like the other shared cores: it runs on the phone (to
// pick the six winners out of the club's rollup) and inside the Cloud Function
// (to build that rollup at the end of an evening), and the two must agree.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO
//
//   • Score a pair. There is no chemistry rating here and there should not be:
//     wins, assists, clean sheets and games-together measure different things
//     on different scales, and folding them into one number would invent a
//     precision the data cannot support. Six separate, checkable facts instead.
//
//   • Reach across clubs. The global `pairStats` collection already holds most
//     of these counters — and it is exactly the wrong source, because a pair
//     who play together in two clubs would carry one club's record into the
//     other's screen. Everything here is keyed by club.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHEMISTRY_MIN = exports.EMPTY_PAIR = void 0;
exports.pairKey = pairKey;
exports.pairMembers = pairMembers;
exports.pairsFromRounds = pairsFromRounds;
exports.mergePairs = mergePairs;
exports.pickChemistry = pickChemistry;
exports.titlesOf = titlesOf;
exports.EMPTY_PAIR = {
    sameTeam: 0,
    winsTogether: 0,
    lossesTogether: 0,
    cleanSheetsTogether: 0,
    against: 0,
    winsA: 0,
    winsB: 0,
    assistsAToB: 0,
    assistsBToA: 0,
};
/** A pair, always in the same order regardless of who is named first. */
function pairKey(x, y) {
    return x < y ? `${x}__${y}` : `${y}__${x}`;
}
/** The two uids of a key, sorted — `a` is the one `winsA` belongs to. */
function pairMembers(key) {
    const [a, b] = key.split('__');
    return [a, b];
}
function bump(into, key) {
    const cur = into[key] ?? { ...exports.EMPTY_PAIR };
    into[key] = cur;
    return cur;
}
/**
 * Everything one evening adds to the club's pair totals.
 *
 * Accumulated in memory across the whole evening and written ONCE per pair.
 * Writing per mini-game instead would add n² + n(n−1) operations to the batch
 * that commits the round's stats — 231 of them at eleven a side, on top of the
 * ~400 already there, which crosses Firestore's 500-operation ceiling. And the
 * idempotency latch lives in that same batch, so every retry would fail
 * identically and the round's statistics would be lost for good. Collapsing an
 * evening first turns ~450 writes into at most one per pair that played.
 *
 * A guest is a real participant here: they were on the pitch, the pass was
 * real, and the mini-game they won counted. They simply have no account, which
 * matters for titles, not for what happened.
 */
function pairsFromRounds(rounds) {
    const out = {};
    for (const r of rounds) {
        const A = (r.teamA ?? []).filter(Boolean);
        const B = (r.teamB ?? []).filter(Boolean);
        const aWon = r.winnerSide === 'A';
        const bWon = r.winnerSide === 'B';
        // The clean sheet belongs to the side that conceded nothing — read off the
        // score, so a mini-game decided by a shootout keeps its 0:0 and credits
        // both sides. The kicks are not goals anywhere else in the app either.
        const cleanA = r.scoreB === 0;
        const cleanB = r.scoreA === 0;
        for (const [team, won, lost, clean] of [
            [A, aWon, bWon, cleanA],
            [B, bWon, aWon, cleanB],
        ]) {
            for (let i = 0; i < team.length; i++) {
                for (let j = i + 1; j < team.length; j++) {
                    const p = bump(out, pairKey(team[i], team[j]));
                    p.sameTeam += 1;
                    if (won)
                        p.winsTogether += 1;
                    if (lost)
                        p.lossesTogether += 1;
                    if (clean)
                        p.cleanSheetsTogether += 1;
                }
            }
        }
        for (const x of A) {
            for (const y of B) {
                const key = pairKey(x, y);
                const p = bump(out, key);
                p.against += 1;
                // `winsA` is the sorted-FIRST uid's win, so the tally reads the same
                // whichever way round the caller happened to name them.
                const [first] = pairMembers(key);
                if (aWon)
                    p[first === x ? 'winsA' : 'winsB'] += 1;
                else if (bWon)
                    p[first === y ? 'winsA' : 'winsB'] += 1;
                // A tie counts as a meeting and as nobody's win.
            }
        }
        for (const g of r.goals ?? []) {
            if (g.ownGoal)
                continue;
            if (!g.assisterId || !g.scorerId)
                continue;
            if (g.assisterId === g.scorerId)
                continue;
            const key = pairKey(g.assisterId, g.scorerId);
            const p = bump(out, key);
            const [first] = pairMembers(key);
            p[first === g.assisterId ? 'assistsAToB' : 'assistsBToA'] += 1;
        }
    }
    return out;
}
/** Add one evening's totals onto a running set. */
function mergePairs(base, add) {
    const out = { ...base };
    for (const [k, v] of Object.entries(add)) {
        const cur = out[k] ?? { ...exports.EMPTY_PAIR };
        out[k] = {
            sameTeam: cur.sameTeam + v.sameTeam,
            winsTogether: cur.winsTogether + v.winsTogether,
            lossesTogether: cur.lossesTogether + v.lossesTogether,
            cleanSheetsTogether: cur.cleanSheetsTogether + v.cleanSheetsTogether,
            against: cur.against + v.against,
            winsA: cur.winsA + v.winsA,
            winsB: cur.winsB + v.winsB,
            assistsAToB: cur.assistsAToB + v.assistsAToB,
            assistsBToA: cur.assistsBToA + v.assistsBToA,
        };
    }
    return out;
}
/**
 * The floor under each category.
 *
 * Not decoration: a brand-new club would otherwise crown "the winning duo — 1
 * win", which is noise wearing a trophy. Chosen against the real club, where
 * the leaders sit at 14 wins together, 27 games together and 26 meetings —
 * high enough that a single evening cannot produce a winner, low enough that a
 * club a few months in has something to show.
 */
exports.CHEMISTRY_MIN = {
    winningDuo: 5,
    regulars: 10,
    deadlyDuo: 3,
    wall: 5,
    rivalry: 10,
    balancedRivalry: 10,
};
function metricOf(kind, p) {
    switch (kind) {
        case 'winningDuo': return p.winsTogether;
        case 'regulars': return p.sameTeam;
        case 'deadlyDuo': return p.assistsAToB + p.assistsBToA;
        case 'wall': return p.cleanSheetsTogether;
        case 'rivalry': return p.against;
        case 'balancedRivalry': return p.against;
    }
}
function topBy(pairs, kind) {
    let best = 0;
    for (const p of Object.values(pairs))
        best = Math.max(best, metricOf(kind, p));
    if (best < exports.CHEMISTRY_MIN[kind])
        return null;
    const keys = Object.keys(pairs)
        .filter((k) => metricOf(kind, pairs[k]) === best)
        .sort();
    return { kind, pairs: keys, value: best, tied: keys.length > 1 };
}
/**
 * The closest head-to-head record among rivalries with a real sample.
 *
 * The sample floor is the entire point. Without it the winner is always some
 * pair who met once and finished 1–0 — a perfect-looking split that means
 * nothing. Ties on closeness are broken by who has met MORE often, which is not
 * an invented tie-break but the same thing the category is measuring: the more
 * evenly matched of two even records is the one tested more times.
 */
function balancedRivalry(pairs) {
    const min = exports.CHEMISTRY_MIN.balancedRivalry;
    const cands = Object.keys(pairs).filter((k) => pairs[k].against >= min);
    if (cands.length === 0)
        return null;
    const gap = (k) => Math.abs(pairs[k].winsA - pairs[k].winsB);
    let bestGap = Infinity;
    let bestAgainst = 0;
    for (const k of cands) {
        const g = gap(k);
        if (g < bestGap || (g === bestGap && pairs[k].against > bestAgainst)) {
            bestGap = g;
            bestAgainst = pairs[k].against;
        }
    }
    const winners = cands
        .filter((k) => gap(k) === bestGap && pairs[k].against === bestAgainst)
        .sort();
    const p = pairs[winners[0]];
    return {
        kind: 'balancedRivalry',
        pairs: winners,
        value: p.against,
        balance: { winsA: p.winsA, winsB: p.winsB, against: p.against },
        tied: winners.length > 1,
    };
}
/** The six cards, in display order. A category with nothing to say is absent
 *  rather than shown empty — the section simply gets shorter. */
function pickChemistry(pairs) {
    const out = [];
    for (const kind of ['winningDuo', 'regulars', 'deadlyDuo', 'wall', 'rivalry']) {
        const pick = topBy(pairs, kind);
        if (!pick)
            continue;
        if (kind === 'rivalry') {
            const p = pairs[pick.pairs[0]];
            pick.balance = { winsA: p.winsA, winsB: p.winsB, against: p.against };
        }
        out.push(pick);
    }
    const balanced = balancedRivalry(pairs);
    if (balanced)
        out.push(balanced);
    return out;
}
/** Which of the six a given pair holds — for the tags on its card. */
function titlesOf(picks, key) {
    return picks.filter((p) => p.pairs.includes(key)).map((p) => p.kind);
}
