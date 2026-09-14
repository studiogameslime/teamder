"use strict";
// Closing a season: archive, then zero. Never delete, never on a clock.
//
// This is the only destructive path in the app that runs unattended, so the
// shape matters more than the code:
//
//   1. Build the archive in memory from the live documents.
//   2. `create()` it. If it already exists the create fails with
//      ALREADY_EXISTS and we stop — that single call is the whole
//      idempotency story, and it is the same trick the round-commit latch
//      uses. A redelivered event cannot archive a second time, and cannot
//      archive the zeroes it wrote on the first pass.
//   3. ONLY once the archive has landed, zero the live rows.
//
// Ordering is not a preference. If step 3 ran first, or if the archive were
// built by re-reading after a partial wipe, a retry would seal a season of
// zeros over the real one and there would be nothing left to recover from.
//
// The zeroing names its fields. A blanket overwrite of these documents would
// also destroy `bestEvening` (a PERSONAL high-water mark that happens to live
// on a club document), `lastEveningScore`, and `kingGoalsSum`/`kingGoalsCount`
// — the running benchmark the evening score is measured against. Resetting
// that last one would make the first top scorer of the new season a perfect
// 10 by construction and inflate everyone's score by about a quarter of the
// scale, silently.
Object.defineProperty(exports, "__esModule", { value: true });
exports.__seasonFields = void 0;
exports.closeSeason = closeSeason;
/** Club-scoped counters a season owns. Everything not named here survives. */
const PLAYER_SEASON_FIELDS = [
    'goals',
    'assists',
    'rounds',
    'wins',
    'losses',
    'ties',
    'games',
    'cleanSheets',
    'ownGoals',
    'penTaken',
    'penScored',
    'penMissed',
    'penFaced',
    'penSaved',
    'penConceded',
    // Coverage denominators reset with their numerators, or the new season's
    // rates would divide this season's handful of clean sheets by a career.
    'csRounds',
    'asRounds',
];
/** The same, for the club total document. */
const CLUB_SEASON_FIELDS = [
    'rounds',
    'goals',
    'guestGoals',
    'ownGoals',
    'tiedRounds',
    'shootoutRounds',
    'scorelessRounds',
];
/**
 * Close one season.
 *
 * The caller is responsible for having checked that the club is quiet —
 * no open game, nothing unsealed. This function does not re-check, because
 * the decision belongs with the trigger that knows why it is running.
 */
async function closeSeason(args) {
    const { db, groupId, seasonId, now } = args;
    const [psSnap, csSnap, pairSnap] = await Promise.all([
        db.collection('communityPlayerStats').where('groupId', '==', groupId).get(),
        db.collection('communityStats').doc(groupId).get(),
        db.collection('communityPairStats').where('groupId', '==', groupId).get(),
    ]);
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const uids = [];
    for (const d of psSnap.docs) {
        const uid = d.data().userId;
        if (typeof uid === 'string' && uid)
            uids.push(uid);
    }
    // Names are FETCHED here, not read off the stat row.
    //
    // `communityPlayerStats` carries no name — the table resolves one per row
    // from /users at render time. Freezing `x.displayName` therefore froze an
    // empty string for every player, which a dry run against the real club
    // caught: 29 of 29 rows blank. That would have defeated the whole point of
    // freezing, which is that a sealed table still reads after somebody deletes
    // their account (the deletion anonymises /users to "משתמש שהוסר", and a
    // missing document renders as a dash).
    //
    // One read per player, once per season. getAll batches them.
    const nameByUid = new Map();
    if (uids.length) {
        const refs = uids.map((u) => db.collection('users').doc(u));
        for (let i = 0; i < refs.length; i += 300) {
            const docs = await db.getAll(...refs.slice(i, i + 300));
            for (const d of docs) {
                const n = d.data();
                const name = n?.name ?? n?.displayName;
                if (typeof name === 'string' && name)
                    nameByUid.set(d.id, name);
            }
        }
    }
    const players = {};
    for (const d of psSnap.docs) {
        const x = d.data();
        const uid = typeof x.userId === 'string' ? x.userId : '';
        if (!uid)
            continue;
        const row = {};
        for (const f of PLAYER_SEASON_FIELDS)
            row[f] = num(x[f]);
        row.displayName = nameByUid.get(uid) ?? '';
        players[uid] = row;
    }
    const cs = (csSnap.exists ? csSnap.data() : {});
    const totals = {};
    for (const f of CLUB_SEASON_FIELDS)
        totals[f] = num(cs[f]);
    // Neither of these has a club counter; the screen sums them from the member
    // rows. Store them explicitly or they become underivable once the rows are
    // zeroed.
    totals.assists = Object.values(players).reduce((a, p) => a + num(p.assists), 0);
    totals.cleanSheets = Object.values(players).reduce((a, p) => a + num(p.cleanSheets), 0);
    const pairs = {};
    for (const d of pairSnap.docs) {
        const x = d.data();
        if (!x.a || !x.b)
            continue;
        const key = [x.a, x.b].sort().join('__');
        pairs[key] = num(x.assists);
    }
    // ── 1. Archive, exactly once ────────────────────────────────────────────
    const summaryRef = db
        .collection('seasonSummary')
        .doc(`${groupId}__${seasonId}`);
    try {
        await summaryRef.create({
            groupId,
            seasonId,
            no: args.seasonNo,
            startsAt: args.startsAt,
            endsAt: now,
            closedAt: now,
            completedRounds: args.completedRounds,
            ...(args.endedEarly ? { endedEarly: true } : {}),
            ...(args.closedBy ? { closedBy: args.closedBy } : {}),
            ...(args.closedByName ? { closedByName: args.closedByName } : {}),
            ...(args.originalTarget ? { originalTarget: args.originalTarget } : {}),
            ...(args.partialData ? { partialData: true } : {}),
            totals,
            players,
            pairs,
        });
    }
    catch (err) {
        const code = err.code;
        if (code === 6 || code === 'already-exists') {
            // Already closed. Crucially we do NOT go on to zero: the live rows now
            // belong to the season that opened after this one.
            console.log('[season] already archived — skip', groupId, seasonId);
            return { archived: false, players: 0, pairs: 0 };
        }
        throw err;
    }
    // ── 2. Only now, zero ───────────────────────────────────────────────────
    // Absolute writes, so a retry converges instead of drifting. Chunked well
    // under the 500-operation ceiling.
    const zeroPlayer = {};
    for (const f of PLAYER_SEASON_FIELDS)
        zeroPlayer[f] = 0;
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
        if (ops === 0)
            return;
        await batch.commit();
        batch = db.batch();
        ops = 0;
    };
    for (const d of psSnap.docs) {
        batch.set(d.ref, { ...zeroPlayer, updatedAt: now }, { merge: true });
        if (++ops >= 400)
            await flush();
    }
    for (const d of pairSnap.docs) {
        batch.set(d.ref, {
            assists: 0,
            sameTeam: 0,
            winsTogether: 0,
            lossesTogether: 0,
            cleanSheetsTogether: 0,
            against: 0,
            winsA: 0,
            winsB: 0,
            assistsAToB: 0,
            assistsBToA: 0,
            updatedAt: now,
        }, { merge: true });
        if (++ops >= 400)
            await flush();
    }
    await flush();
    const zeroClub = {};
    for (const f of CLUB_SEASON_FIELDS)
        zeroClub[f] = 0;
    await db.collection('communityStats').doc(groupId).set({
        ...zeroClub,
        // Re-stamped, or the new season's chemistry card would date itself from
        // the old one. It is only advanced when absent or earlier, so leaving it
        // alone would quietly keep the stale window.
        chemistrySince: now,
        updatedAt: now,
    }, { merge: true });
    return {
        archived: true,
        players: psSnap.size,
        pairs: pairSnap.size,
    };
}
/** Exported for the test that pins the reset list against silent growth. */
exports.__seasonFields = {
    player: PLAYER_SEASON_FIELDS,
    club: CLUB_SEASON_FIELDS,
};
