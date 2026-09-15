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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.__seasonFields = void 0;
exports.closeSeason = closeSeason;
exports.reopenSeason = reopenSeason;
const admin = __importStar(require("firebase-admin"));
const seasonParticipants_1 = require("./seasonParticipants");
const seasonAwards_1 = require("./seasonAwards");
/** A per-game identity with no account. See the archive note below. */
const isReal = (id) => !!id && !id.startsWith('guest:');
/**
 * Ceiling on archived pairs, so one document cannot grow past Firestore's 1MB
 * limit and make the club permanently unable to close a season.
 *
 * The earlier figure of 4,000 was arithmetic done too fast. An entry is a
 * 45-character key plus two uids plus ten numbers, and Firestore charges for
 * every field name: call it 250-300 bytes, so 4,000 is about 1.1MB on its own
 * — over the limit before the players map is added. 1,200 is roughly 350KB and
 * leaves room for everything else.
 *
 * It is not a tight bound in practice, because only pairs that actually played
 * this season are archived at all: a 50-player club has 1,225 possible pairs
 * and nothing like that many turn out together in one season.
 */
const MAX_ARCHIVED_PAIRS = 1200;
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
    // The season's evening-score mean, as sum and count. The MVP title is the
    // highest AVERAGE this season, so both halves must reset together: keeping
    // the sum across a rollover would carry last season's evenings into this
    // season's average, and keeping only one of the two produces a mean that is
    // not a mean at all.
    'eveningScoreSum',
    'eveningScoreCount',
];
/**
 * The pair counters a season owns.
 *
 * Named in one place because the close and the reopen have to agree exactly:
 * anything the wipe clears and the restore misses is chemistry destroyed with
 * no way back, since the archive is deleted at the end of the reopen.
 */
const PAIR_SEASON_FIELDS = [
    'assists',
    'sameTeam',
    'winsTogether',
    'lossesTogether',
    'cleanSheetsTogether',
    'against',
    'winsA',
    'winsB',
    'assistsAToB',
    'assistsBToA',
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
    const num = (v) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
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
        // A row with nothing in it is not a participant.
        //
        // Nothing deletes a communityPlayerStats row when somebody leaves a club,
        // so after one close every ex-member is sitting there wound back to zeros
        // — and archiving them made each one a key in EVERY future season. That
        // inflated the archive, miscounted the card, and (because the read rule
        // admits anyone in the map) let a long-departed member open seasons they
        // were never part of.
        //
        // `games` as well as `rounds`: somebody who turned up and never got on the
        // pitch still played no mini-games, and was still there.
        if (num(x.rounds) === 0 && num(x.games) === 0)
            continue;
        const row = {};
        for (const f of PLAYER_SEASON_FIELDS) {
            // ABSENT is not zero for the two coverage denominators.
            //
            // They say how many rounds a metric could be measured over, and they
            // arrived later than the metrics they divide. Writing 0 for a season
            // that predates them tells the reader "measured across zero rounds",
            // which is indistinguishable from a real zero and defeats the fallback
            // the reader has for exactly this case — the same mistake that made the
            // club's clean-sheet percentage read ten points low for every veteran.
            if ((f === 'csRounds' || f === 'asRounds') && typeof x[f] !== 'number') {
                continue;
            }
            row[f] = num(x[f]);
        }
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
    // The pair counters are archived IN FULL, not as one number.
    //
    // This used to store `assists` alone. That was not enough for anything that
    // reads the archive afterwards: the deadly-duo title needs how many rounds
    // the two actually played side by side, and the personal season summary is
    // built almost entirely out of these counters — who I played beside most,
    // who I faced most, who I beat most. Zeroed live rows cannot answer any of
    // that, so a season that closed would have taken its own story with it.
    //
    // Size: pairs grow as n(n-1)/2. A 30-player club is 435 entries and roughly
    // 60KB; sixty players is 1,770 and about 240KB, still well inside the 1MB
    // document limit. Written once per season.
    const pairs = {};
    let droppedGuestPairs = 0;
    let droppedEmptyPairs = 0;
    let droppedOverflowPairs = 0;
    for (const d of pairSnap.docs) {
        const x = d.data();
        const a = typeof x.a === 'string' ? x.a : '';
        const b = typeof x.b === 'string' ? x.b : '';
        if (!a || !b)
            continue;
        // Guests do not go into the archive, and this is the difference between a
        // season that can close and one that eventually cannot.
        //
        // The chemistry engine counts guests on purpose — they were on the pitch
        // and the pass was real — but a guest id is minted fresh for every game, so
        // `communityPairStats` accumulates a permanent new pair for every stranger
        // who ever turned out. Copying all of them into ONE document means the
        // archive grows without bound, and the first season that pushes it past
        // Firestore's 1MB limit cannot be written at all: the club could never
        // close another season, ever.
        //
        // Nothing downstream wants them either. The personal summary filters
        // guests out by hand, and the duo title needs both halves past the
        // eligibility gate, which a player with no account can never be.
        if (!isReal(a) || !isReal(b)) {
            droppedGuestPairs += 1;
            continue;
        }
        // A pair that did nothing this season is not part of this season.
        //
        // Nothing deletes a pair document — the close winds it back to zero — so
        // after one season every pair the club has EVER fielded is sitting there
        // at zero, and archiving them all made the document grow with the club's
        // whole history instead of with the season. Same shape as the empty player
        // rows above.
        const playedTogether = num(x.sameTeam) + num(x.against) + num(x.assists) +
            num(x.assistsAToB) + num(x.assistsBToA);
        if (playedTogether === 0) {
            droppedEmptyPairs += 1;
            continue;
        }
        if (Object.keys(pairs).length >= MAX_ARCHIVED_PAIRS) {
            droppedOverflowPairs += 1;
            continue;
        }
        // Sorted key, and the archived a/b sorted WITH it — the direction of
        // `winsA` and `assistsAToB` is meaningless unless the reader knows which
        // player is which, and the live document's own a/b need not be sorted.
        const [lo, hi] = [a, b].sort();
        const flip = lo !== a;
        pairs[`${lo}__${hi}`] = {
            a: lo,
            b: hi,
            sameTeam: num(x.sameTeam),
            against: num(x.against),
            winsTogether: num(x.winsTogether),
            lossesTogether: num(x.lossesTogether),
            cleanSheetsTogether: num(x.cleanSheetsTogether),
            winsA: num(flip ? x.winsB : x.winsA),
            winsB: num(flip ? x.winsA : x.winsB),
            assistsAToB: num(flip ? x.assistsBToA : x.assistsAToB),
            assistsBToA: num(flip ? x.assistsAToB : x.assistsBToA),
            // The legacy, undirected metric. Kept because it counts a WIDER window
            // than the fields above (see the note on rollUpClubPairs) and the club
            // chemistry card still quotes it.
            assists: num(x.assists),
        };
    }
    if (droppedGuestPairs > 0 || droppedEmptyPairs > 0 || droppedOverflowPairs > 0) {
        // Never silent. A dropped pair is a fact about the archive, and the
        // overflow case in particular should never happen for a real club.
        console.log(`[season] archive pairs: kept ${Object.keys(pairs).length}, ` +
            `dropped ${droppedGuestPairs} guest, ${droppedEmptyPairs} empty, ` +
            `${droppedOverflowPairs} over cap`, groupId, seasonId);
    }
    // ── The titles ──────────────────────────────────────────────────────────
    //
    // Decided HERE, from the numbers as they stand, and sealed into the archive
    // with them. The end-season dialog has been telling admins that titles are
    // awarded; until now nothing computed them, and the promise was empty.
    //
    // `completedRounds` is the season's finished-round count and it is the
    // denominator of both gates (turn up for half the season; take enough
    // penalties for a rate to mean anything). It comes from the sealed-evening
    // counter rather than a query, because deleting a game decrements nothing.
    const awardLines = Object.entries(players).map(([uid, row]) => ({
        uid,
        // Evenings attended, which is what the eligibility gate and the loyalty
        // title are measured in — the season's own length is a count of evenings.
        games: num(row.games),
        rounds: num(row.rounds),
        goals: num(row.goals),
        assists: num(row.assists),
        wins: num(row.wins),
        cleanSheets: num(row.cleanSheets),
        // The season's mean evening score. Absent until the accumulator that feeds
        // it has been live for a season, and 0 keeps that player out of the MVP
        // running rather than handing them the title on an empty number.
        mvpAvg: num(row.eveningScoreCount) > 0
            ? num(row.eveningScoreSum) / num(row.eveningScoreCount)
            : 0,
        penTaken: num(row.penTaken),
        penScored: num(row.penScored),
        penFaced: num(row.penFaced),
        penSaved: num(row.penSaved),
    }));
    const awardPairs = Object.values(pairs).map((p) => ({
        a: p.a,
        b: p.b,
        // DIRECTIONAL assists, both ways, not the legacy `assists` counter.
        //
        // Two reasons. The legacy field covers a wider window than the directional
        // ones (see the note on the archive above), so it is not a season number at
        // all. And the club's chemistry card already crowns a "הצמד הקטלני"
        // computed exactly this way — two surfaces wearing the same Hebrew name
        // must not name two different pairs.
        score: p.assistsAToB + p.assistsBToA,
        together: p.sameTeam,
    }));
    // The season's length, derived from the SAME counter the gate compares
    // against — and this is not a nicety, it is the difference between the gate
    // working and not.
    //
    // `args.completedRounds` comes from `clubRecords.eveningsSealed`, which has
    // only been written since 25.08. Per-player `games` has been counted since
    // 22.06. So the numerator carries two extra months the denominator does not,
    // and the two are not comparable at all. Measured on the real club the gate
    // was calibrated against: 13 evenings played, eveningsSealed 3, threshold 2,
    // and 25 of 29 players clear a gate meant to admit 13 — including seven who
    // turned up twice. Exactly the failure the units fix already corrected once,
    // reintroduced through the other side of the division.
    //
    // The most evenings any one player attended is in the same unit and the same
    // era as every number it will be compared with. On that same club it gives
    // 12 → threshold 6 → 13 eligible, which is the calibration the design
    // documents. It can only under-count when nobody attended every evening,
    // and under-counting a gate makes it stricter, not looser.
    const seasonEvenings = Math.max(0, ...awardLines.map((l) => l.games), 
    // A season with no players at all falls back to whatever the caller knew.
    awardLines.length === 0 ? args.completedRounds : 0);
    const awards = (0, seasonAwards_1.computeSeasonAwards)(awardLines, awardPairs, seasonEvenings);
    /** Set when we are resuming a close that died before it finished. */
    let resumedAwards = null;
    let resumedPlayers = null;
    let resumedTotals = null;
    let resumedEvenings = null;
    // ── 1. Archive, exactly once ────────────────────────────────────────────
    const summaryRef = db
        .collection('seasonSummary')
        .doc(`${groupId}__${seasonId}`);
    try {
        await summaryRef.create({
            groupId,
            // Frozen, like the player names. A closed season has to be readable by
            // someone who has since LEFT the club — they played in it — and they
            // cannot read /groups to find out what it was called.
            groupName: args.groupName ?? '',
            seasonId,
            no: args.seasonNo,
            startsAt: args.startsAt,
            endsAt: now,
            closedAt: now,
            // The number the titles were actually decided on, so the hall of fame
            // cannot print "3 מחזורים" over a title won on "12 מחזורים".
            completedRounds: seasonEvenings,
            roundsAtStartOfSeason: args.roundsAtStart ?? 0,
            ...(args.endedEarly ? { endedEarly: true } : {}),
            ...(args.closedBy ? { closedBy: args.closedBy } : {}),
            ...(args.closedByName ? { closedByName: args.closedByName } : {}),
            ...(args.originalTarget ? { originalTarget: args.originalTarget } : {}),
            ...(args.partialData ? { partialData: true } : {}),
            totals,
            players,
            pairs,
            awards,
        });
    }
    catch (err) {
        const code = err.code;
        if (code !== 6 && code !== 'already-exists')
            throw err;
        // The archive already exists. That means one of two very different things,
        // and treating them the same was a permanent data bug.
        //
        // If the first pass FINISHED, the live rows now belong to the season that
        // opened after this one and must not be touched — returning here is the
        // whole idempotency story, and it is why the archive can never be sealed
        // over a table of zeroes.
        //
        // But if the first pass DIED between the archive landing and the zeroing,
        // the old behaviour left the club permanently half-closed: the season was
        // sealed, the titles were never written, the table was never reset, and
        // every retry took this same early exit. The next season then inherited
        // the last one's totals, for good.
        //
        // `zeroedAt` is the marker that tells them apart. It is stamped only after
        // the wipe, so its absence means "resume", and everything after this point
        // is an absolute write that converges on a retry.
        const existing = await summaryRef.get();
        if (existing.get('zeroedAt')) {
            console.log('[season] already closed — skip', groupId, seasonId);
            return { archived: false, players: 0, pairs: 0 };
        }
        console.warn('[season] archive exists but the wipe never finished — resuming', groupId, seasonId);
        // Decided titles come from the ARCHIVE on this path, never recomputed: the
        // live rows may be half-zeroed by the pass that died, and a title decided
        // from those would be a different title from the one already sealed.
        resumedAwards = (existing.get('awards') ?? null);
        // The ROWS come from the archive too, for the same reason the titles do.
        //
        // Without this the resume path had nothing safe to build the card from, so
        // it skipped the card entirely — and if the pass that died never got as
        // far as writing one, the season stayed sealed in the archive and absent
        // from the hall of fame for ever. The archive is protected by create() and
        // holds the frozen names and totals, so a card built from it is the same
        // card the first pass would have written.
        resumedPlayers = (existing.get('players') ?? null);
        resumedTotals = (existing.get('totals') ?? null);
        resumedEvenings = existing.get('completedRounds');
    }
    // ── 1a. A compact card for the list ─────────────────────────────────────
    //
    // The archive is the record and it is BIG: every player's row, every pair's
    // ten counters, for every season. The hall of fame shows a date, three
    // numbers and nine names — and was pulling the whole thing, for every season
    // the club has ever played, to print them. A five-season, sixty-player club
    // is well over a megabyte down a phone connection to render one screen.
    //
    // So the close also writes what that screen actually needs, with the winners
    // already resolved to the names frozen in the archive. Same source, same
    // moment, no second version of the truth: the card is derived from the
    // archive it is written beside, and reopenSeason deletes both.
    //
    // On the RESUME path it is skipped entirely. `players`, `totals` and `awards`
    // above were built from live rows that the pass which died may have already
    // half-wiped, so rewriting the card from them would replace a correct sealed
    // record with a wrong one — the archive is protected by create(), the card
    // was not.
    const cardWinners = [];
    for (const [key, award] of Object.entries(resumedAwards ?? awards)) {
        if (!award || !award.winners.length)
            continue;
        cardWinners.push({
            key,
            names: award.winners.map((w) => w
                .split('__')
                .map((uid) => String((resumedPlayers ?? players)[uid]?.displayName ?? '') ||
                '—')
                .join(' + ')),
            value: award.value,
        });
    }
    // Written on BOTH paths now.
    //
    // It used to be skipped whenever the close was resuming, because the live
    // rows it was built from may have been half-wiped by the pass that died. But
    // if that pass never reached the card, skipping meant the season stayed in
    // the archive and out of the hall of fame permanently — sealed and invisible.
    // The resume now builds it from the ARCHIVE instead, which is the protected
    // record, so the card it writes is the card the first pass would have
    // written. `merge: true` makes re-writing an existing one a no-op in effect.
    {
        const cardPlayers = resumedPlayers ?? players;
        const cardTotals = resumedTotals ?? totals;
        const cardEvenings = typeof resumedEvenings === 'number' ? resumedEvenings : seasonEvenings;
        await db
            .collection('seasonCards')
            .doc(`${groupId}__${seasonId}`)
            .set({
            groupId,
            seasonId,
            no: args.seasonNo,
            startsAt: args.startsAt,
            endsAt: now,
            completedRounds: cardEvenings,
            totals: {
                rounds: cardTotals.rounds ?? 0,
                goals: cardTotals.goals ?? 0,
                assists: cardTotals.assists ?? 0,
            },
            // Only people who actually played — counted on EVENINGS attended,
            // with mini-games as a fallback.
            //
            // This used to count `rounds > 0` alone, which is mini-games. A club
            // that runs the plain live screen never records a single one: that
            // screen is a clock, and mini-games only exist in advanced mode. So
            // every season such a club ever closed reported "0 שחקנים" in its
            // hall of fame, no matter how many people turned up all year.
            // Caught on the QA club, whose evenings were timer-only.
            //
            // `games` is the right signal for "took part", and it is the one the
            // evening-played rules now make reliable: it only counts an evening
            // that actually happened. `rounds` stays in the test as a safety net
            // for a row credited a mini-game without an evening.
            players: (0, seasonParticipants_1.countSeasonParticipants)(cardPlayers),
            ...(args.endedEarly ? { endedEarly: true } : {}),
            ...(args.partialData ? { partialData: true } : {}),
            winners: cardWinners,
        }, { merge: true });
    }
    // ── 1b. The titles onto their winners' profiles ─────────────────────────
    //
    // Written only AFTER the archive has landed, and outside its create() latch
    // on purpose: the archive is the record, and a title is a copy of it placed
    // where a player will actually look. If this half fails the season is still
    // correctly sealed and the titles are still readable from the archive.
    //
    // Each title doc is keyed by club+season+title so a redelivery overwrites
    // rather than duplicates, and it FREEZES the club's name: the title belongs
    // to the player for good, including after they leave the club or the club is
    // renamed, and a live lookup would then render it as a dash.
    const groupName = args.groupName ?? '';
    let titleBatch = db.batch();
    let titleOps = 0;
    const flushTitles = async () => {
        if (titleOps === 0)
            return;
        await titleBatch.commit();
        titleBatch = db.batch();
        titleOps = 0;
    };
    for (const [titleKey, award] of Object.entries(resumedAwards ?? awards)) {
        if (!award)
            continue; // "not awarded" is a result, not a gap.
        for (const winner of award.winners) {
            // The duo title is held by a PAIR, under a joined key. It belongs on
            // both profiles, not on a player who does not exist.
            for (const uid of winner.split('__')) {
                if (!uid || uid.startsWith('guest:'))
                    continue;
                titleBatch.set(db
                    .collection('users')
                    .doc(uid)
                    .collection('seasonTitles')
                    .doc(`${groupId}__${seasonId}__${titleKey}`), {
                    groupId,
                    groupName,
                    seasonId,
                    seasonNo: args.seasonNo,
                    titleKey,
                    value: award.value,
                    at: now,
                }, { merge: true });
                if (++titleOps >= 400)
                    await flushTitles();
            }
        }
    }
    await flushTitles();
    // ── 2. Only now, wind the rows back ─────────────────────────────────────
    //
    // SUBTRACT what was archived; do not write zeroes.
    //
    // The rows were read at the top of this function and the wipe happens here.
    // A mini-game committed in between — `clubIsQuiet` makes it unlikely, not
    // impossible — is not in the archive, and an absolute zero would erase it
    // from the live table too. It would exist nowhere, with nothing to detect it.
    // Subtracting leaves exactly that evening behind as the new season's opening
    // balance, which is where it belongs.
    //
    // Subtraction is not idempotent, so each row carries a stamp naming the
    // season it was wound back for, and the whole thing runs in a transaction
    // per row: a retry — including the resume path above — sees the stamp and
    // skips. Once per player per season, so the cost is a few dozen transactions
    // a year for a club.
    const clampAtZero = (v, minus) => Math.max(0, (typeof v === 'number' && Number.isFinite(v) ? v : 0) - minus);
    for (const d of psSnap.docs) {
        const archivedRow = players[d.data().userId ?? ''];
        if (!archivedRow)
            continue;
        await db.runTransaction(async (tx) => {
            const fresh = await tx.get(d.ref);
            if (!fresh.exists)
                return;
            const data = fresh.data();
            if (data.seasonWoundBack === seasonId)
                return; // already done
            const patch = {
                seasonWoundBack: seasonId,
                // Cleared so a LATER reopen can stamp its own restore.
                //
                // The pair wipe and the club wipe below have always done this; the
                // player rows — the one class that holds goals, assists, rounds, wins
                // and the evening-score mean — did not, and that asymmetry was silent
                // and permanent. Close s1, reopen it, play on, close it again, then
                // reopen once more: reopenSeason's per-row guard sees the stamp its
                // OWN first restore left behind and returns for every player, so club
                // totals and pair chemistry come back while every player's season
                // stays at zero. The archive is deleted on the way out, so the two can
                // never be reconciled again.
                seasonReopened: admin.firestore.FieldValue.delete(),
                updatedAt: now,
            };
            for (const f of PLAYER_SEASON_FIELDS) {
                patch[f] = clampAtZero(data[f], num(archivedRow[f]));
            }
            tx.set(d.ref, patch, { merge: true });
        });
    }
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
        if (ops === 0)
            return;
        await batch.commit();
        batch = db.batch();
        ops = 0;
    };
    // Pair rows are wound back the same way the player rows are, and for the same
    // reason: an evening committed between the read and the wipe would otherwise
    // be erased from both the archive and the live table.
    //
    // A pair with no archived row — a guest pair, or one past the cap — is set to
    // zero rather than skipped: it belongs to no season, and leaving it standing
    // would carry it into the next one.
    for (const d of pairSnap.docs) {
        const x = d.data();
        // Already wound back for this season — skip.
        //
        // The player rows carry this stamp and the pair rows did not, so the two
        // halves of one operation behaved differently on a resume: the player kept
        // the two goals he scored between the crash and the retry, and the pair
        // lost that whole evening's chemistry, because subtracting the archived
        // row a second time clamps at zero. The stamp is read off the snapshot
        // taken at the top of this function, which on a retry already reflects the
        // first pass — no transaction needed, since the quiet check and the
        // create() latch serialise the close.
        if (x.seasonWoundBack === seasonId)
            continue;
        const key = [String(x.a ?? ''), String(x.b ?? '')].sort().join('__');
        const archivedPair = pairs[key];
        batch.set(d.ref, {
            ...Object.fromEntries(PAIR_SEASON_FIELDS.map((f) => [
                f,
                archivedPair ? Math.max(0, num(x[f]) - num(archivedPair[f])) : 0,
            ])),
            seasonWoundBack: seasonId,
            // Cleared so a later reopen can stamp its own restore.
            seasonReopened: admin.firestore.FieldValue.delete(),
            updatedAt: now,
        }, { merge: true });
        if (++ops >= 400)
            await flush();
    }
    await flush();
    const zeroClub = {};
    for (const f of CLUB_SEASON_FIELDS)
        zeroClub[f] = 0;
    await db
        .collection('communityStats')
        .doc(groupId)
        .set({
        ...zeroClub,
        // Cleared so a later reopen can stamp its own restore.
        seasonReopened: admin.firestore.FieldValue.delete(),
        // Re-stamped, or the new season's chemistry card would date itself from
        // the old one. It is only advanced when absent or earlier, so leaving it
        // alone would quietly keep the stale window.
        chemistrySince: now,
        updatedAt: now,
    }, { merge: true });
    // Only now. Everything above is repeatable; this says it does not need to be.
    await summaryRef.set({ zeroedAt: Date.now() }, { merge: true });
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
    // Pinned for the same reason as the other two, and with more at stake: a
    // counter missing from this list is cleared by the close and never restored
    // by the reopen, and the archive that held it is deleted at the end of the
    // reopen. There is no way back from a gap here.
    pair: PAIR_SEASON_FIELDS,
};
/**
 * Undo a season that was closed by mistake.
 *
 * The one thing the close deliberately has no path back from, which is exactly
 * why it needs one: past the seven-day PITR window a wrong close is permanent,
 * and an admin who ends a season a week early has no way to say so.
 *
 * It is the wind-back in reverse, and it is only safe because of how the close
 * was built:
 *
 *   • The archive holds every number as it stood, so the live rows are restored
 *     by ADDING back exactly what was subtracted — a round played since the
 *     close keeps its own contribution instead of being overwritten.
 *   • Each row's `seasonWoundBack` stamp is cleared in the same transaction, so
 *     the row is once again eligible to be wound back when the season is
 *     properly closed later.
 *   • The titles are keyed by club+season+title, so they are deleted exactly.
 *   • The archive is removed LAST. While it exists the operation is repeatable
 *     from the top; once it is gone there is nothing left to repeat.
 *
 * The caller is responsible for restoring the club's `seasons` block — this
 * function owns the numbers, not the lifecycle.
 */
async function reopenSeason(args) {
    const { db, groupId, seasonId } = args;
    const summaryRef = db
        .collection('seasonSummary')
        .doc(`${groupId}__${seasonId}`);
    const snap = await summaryRef.get();
    if (!snap.exists)
        return { reopened: false, players: 0, titles: 0 };
    const data = snap.data();
    const players = (data.players ?? {});
    const totals = (data.totals ?? {});
    const awards = (data.awards ?? {});
    const num2 = (v) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
    // 1. Give every player their season back.
    let restored = 0;
    for (const [uid, row] of Object.entries(players)) {
        const ref = db.collection('communityPlayerStats').doc(`${groupId}__${uid}`);
        await db.runTransaction(async (tx) => {
            const fresh = await tx.get(ref);
            const cur = (fresh.exists ? fresh.data() : {});
            // The restore is an ADDITION, and the only thing that makes the whole
            // operation non-repeatable — the archive delete — happens at the very
            // end. So a crash anywhere before it, followed by a retry, would give
            // the club a second copy of the whole season. Same latch the pair rows
            // carry; cleared by the next close.
            if (cur.seasonReopened === seasonId)
                return;
            const patch = {
                groupId,
                userId: uid,
                seasonReopened: seasonId,
                seasonWoundBack: admin.firestore.FieldValue.delete(),
                updatedAt: Date.now(),
            };
            for (const f of PLAYER_SEASON_FIELDS) {
                patch[f] = num2(cur[f]) + num2(row[f]);
            }
            tx.set(ref, patch, { merge: true });
        });
        restored += 1;
    }
    // 1b. And every pair its chemistry.
    //
    // The close zeroes communityPairStats — who played beside whom, who beat
    // whom, who set up whom — and reopening restored the player rows and the club
    // totals and left those at zero. A club that undid a mistaken close lost its
    // entire chemistry history, permanently, with no archive to recover from
    // because the archive is deleted at the end of this very function.
    //
    // Same shape as the player rows: ADD back what was sealed, in a transaction,
    // behind a stamp so a retry cannot double it.
    const archivedPairs = (data.pairs ?? {});
    for (const [key, row] of Object.entries(archivedPairs)) {
        if (typeof row !== 'object' || row === null)
            continue;
        const a = typeof row.a === 'string' ? row.a : '';
        const b = typeof row.b === 'string' ? row.b : '';
        if (!a || !b)
            continue;
        const ref = db.collection('communityPairStats').doc(`${groupId}__${key}`);
        await db.runTransaction(async (tx) => {
            const fresh = await tx.get(ref);
            const cur = (fresh.exists ? fresh.data() : {});
            if (cur.seasonReopened === seasonId)
                return;
            tx.set(ref, {
                groupId,
                a,
                b,
                seasonReopened: seasonId,
                // Cleared, or the next close would think this pair had already been
                // wound back and skip it.
                seasonWoundBack: admin.firestore.FieldValue.delete(),
                updatedAt: Date.now(),
                ...Object.fromEntries(PAIR_SEASON_FIELDS.map((f) => [f, num2(cur[f]) + num2(row[f])])),
            }, { merge: true });
        });
    }
    // 2. And the club its totals — behind the same latch, since this also adds.
    const clubRef = db.collection('communityStats').doc(groupId);
    await db.runTransaction(async (tx) => {
        const fresh = await tx.get(clubRef);
        const cur = (fresh.exists ? fresh.data() : {});
        if (cur.seasonReopened === seasonId)
            return;
        tx.set(clubRef, {
            seasonReopened: seasonId,
            updatedAt: Date.now(),
            ...Object.fromEntries(CLUB_SEASON_FIELDS.map((f) => [f, num2(cur[f]) + num2(totals[f])])),
        }, { merge: true });
    });
    // 3. Take the titles back off the winners' profiles. A title for a season
    //    that no longer exists is worse than no title.
    let titles = 0;
    let batch = db.batch();
    let ops = 0;
    for (const [titleKey, award] of Object.entries(awards)) {
        if (!award || !Array.isArray(award.winners))
            continue;
        for (const winner of award.winners) {
            if (typeof winner !== 'string')
                continue;
            for (const uid of winner.split('__')) {
                if (!uid || !isReal(uid))
                    continue;
                batch.delete(db
                    .collection('users')
                    .doc(uid)
                    .collection('seasonTitles')
                    .doc(`${groupId}__${seasonId}__${titleKey}`));
                titles += 1;
                if (++ops >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    ops = 0;
                }
            }
        }
    }
    if (ops > 0)
        await batch.commit();
    // 4. The list card goes with its archive — one without the other is a
    //    season that shows in the hall of fame and cannot be opened.
    await db.collection('seasonCards').doc(`${groupId}__${seasonId}`).delete();
    // 5. Last, because while it exists this is repeatable.
    await summaryRef.delete();
    return { reopened: true, players: restored, titles };
}
