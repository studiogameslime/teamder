## Closing a season

Everything in this section is quoted from `HEAD` = `e35394a` (2026-09-18 21:40 +0300). Note
before anything else: the deployed Cloud Functions were built from the source as it stood at
**16:04Z on 2026-09-18**, and three commits to these files landed after that
(`bc6a562` 17:03, `5531a21` 19:02, `8235851` 21:14, all +0300). Where HEAD and production
differ I say so; a reader diffing the running system against this document will otherwise be
misled.

### Three doors into one room

A season can be closed by exactly three pieces of code. All three end in the same function,
`closeSeason` in `functions/src/seasonRollover.ts:307`, and two of the three first pass through
`performSeasonClose` (`functions/src/index.ts:15790`), which wraps the close in a pre-flight
check and a lifecycle write.

| | `closeSeasonIfRoundsTargetMet` | `runSeasonRollovers` | `endSeasonNow` |
|---|---|---|---|
| where | `index.ts:15943` | `index.ts:16055` | `index.ts:16971` |
| fires on | the seal of an evening, from `onGameRosterChanged` (call site `index.ts:5274-5292`) | `cronEvery60Min`, last in the job (`index.ts:13604`) | an admin tapping **סיים עונה עכשיו** ("end season now") |
| cadences it can finish | `rounds` only (`line.kind !== 'rounds'` → return, `:15967`) | all of them | ignores the cadence entirely |
| quiet check | `clubIsQuiet(groupId, {mode:'afterSeal', exceptGameId})` | `clubIsQuiet(doc.id)` (sweep mode) | `clubIsQuiet(groupId)` (sweep mode) |
| on "busy" | logs, returns; the sweep is the backstop | stamps `seasons.dueBlockedSince`, retries next hour | throws `failed-precondition` to the client |
| goes via `performSeasonClose` | yes | yes | **no** — it calls `closeSeason` directly and writes its own lifecycle block |
| extra archive fields | `endedEarly`/`closedBy` only if `targetMovedToClose` is set | same | always `endedEarly:true`, `closedBy`, `closedByName` |
| `completedRounds` | `known.played` = mirror **+1** | `completedRoundsOf(id, roundsAtStart, playedRounds)` | `completedRoundsOf(id, roundsAtStart, playedRounds)` |

The last row is the one that used to differ, and it is worth being exact about, because whatever
it produces is written into a document created with `create()` and never recomputed.

### `completedRounds`: the argument the three paths disagreed about

There are four numbers in this system that all answer "how many מחזורים (evenings) has this
season held", and they are not equal:

```ts
// functions/src/seasonCounters.ts:105
export function completedRoundsFrom(
  sealedEvenings: number,
  roundsAtStart?: number,
  playedRounds?: number,
): number {
  if (typeof playedRounds === 'number' && playedRounds >= 0) return playedRounds;
  const all  = typeof sealedEvenings === 'number' && sealedEvenings > 0 ? sealedEvenings : 0;
  const base = typeof roundsAtStart  === 'number' && roundsAtStart  > 0 ? roundsAtStart  : 0;
  return Math.max(0, all - base);
}
```

`playedRounds` is the **mirror**: seeded when the season opens (`functions/src/seasonSeed.ts:26`)
from `playedEveningsFromGames` — a `didEveningHappen` count over the club's last 200 terminal
games — and incremented by one on every seal. `roundsAtStart` is `clubRecords.eveningsSealed` at
the moment the season opened. The fallback branch, `eveningsSealed − roundsAtStart`, subtracts two
counters from different eras: `eveningsSealed` only began being written on 26.08.2026, and the
club's games go back to June.

On `HhzIwmjMl1i5HSOGHt3p` (מועדון שכחת שושי, the only club that has ever run a season) at the
moment season 1 closed — 2026-09-17 16:12:06Z — the live values were `roundsAtStart: 7`,
`clubRecords.eveningsSealed: 10`, `seasons.playedRounds: 21` (the seal that triggered the close
had just made it 22). So:

| path | expression | value |
|---|---|---|
| seal | `liveSeasons.playedRounds + 1` (`index.ts:5282-5285`) | **22** |
| sweep | `completedRoundsFrom(_, 7, 22)` | **22** |
| `endSeasonNow`, as deployed before 18.09 | `completedRoundsFrom(10, 7, undefined)` | **3** |

That third row is finding **endseasonnow-archives-wrong-length** (P0, confirmed twice). The
callable simply omitted the third argument; `seasons.playedRounds` was not even in its local type
literal. Had the admin pressed the button instead of playing the twenty-second evening, the club
would hold a permanent archive saying season 1 lasted three evenings. It is fixed at
`index.ts:17030-17034` and the comment there records the counterfactual. The fix is deployed.

The sealed archive proves the surviving path was correct: `seasonSummary/HhzIwmjMl1i5HSOGHt3p__s1`
carries `completedRounds: 22`.

### `closeSeason`, in order

#### What it reads

```ts
// seasonRollover.ts:310
const [psSnap, csSnap, pairSnap] = await Promise.all([
  db.collection('communityPlayerStats').where('groupId', '==', groupId).get(),
  db.collection('communityStats').doc(groupId).get(),
  db.collection('communityPairStats').where('groupId', '==', groupId).get(),
]);
```

Three reads, then a fourth: one `getAll` per 300 members over `/users`, because
`communityPlayerStats` carries no name and the archive must still render after an account is
deleted (`:336-348`). The pair query is the expensive one — see the guest-pair discussion below.

#### The players map

```ts
// seasonRollover.ts:366
if (num(x.rounds) === 0 && num(x.games) === 0) continue;
```

A row with no mini-games **and** no evenings is not a participant. This matters more than it
looks: nothing ever deletes a `communityPlayerStats` row, and the close winds rows back to zero
rather than deleting them, so after one close every member of the club is sitting at zero. Without
this test every subsequent season's archive would carry every ex-member forever. It also means a
close run over a table that a previous close already emptied archives `players: {}` — which is
exactly what happened on this club four hours later; see the worked example.

Two fields are deliberately allowed to be **absent** rather than zero (`:377-379`): `csRounds` and
`asRounds`, the coverage denominators for clean-sheet and assist rates. They arrived later than the
metrics they divide, and writing `0` would say "measured over zero rounds", which readers cannot
tell from a real zero.

The field list is `PLAYER_SEASON_FIELDS` (`:184-211`) — 19 counters including `eveningScoreSum`
and `eveningScoreCount`, which must reset together or the MVP average stops being an average.
Everything not on that list survives the close: `bestEvening` (a personal high-water mark),
`lastEveningScore`, and `kingGoalsSum`/`kingGoalsCount` (the benchmark the evening score is graded
against). The header comment at `:18-24` explains why a blanket overwrite here would silently
inflate every future evening score by about a quarter of the scale.

#### The totals

`CLUB_SEASON_FIELDS` (`:234-242`) is copied off `communityStats`; `assists` and `cleanSheets` have
no club counter at all, so they are summed from the member rows (`:392-399`) — otherwise they
become underivable the moment the rows are zeroed.

#### The pairs, and the cap

Three filters, in order (`:417-479`):

```ts
if (!isReal(a) || !isReal(b)) { droppedGuestPairs += 1; continue; }        // :436
const playedTogether = num(x.sameTeam) + num(x.against) + num(x.assists)
  + num(x.assistsAToB) + num(x.assistsBToA);
if (playedTogether === 0) { droppedEmptyPairs += 1; continue; }           // :450
if (Object.keys(pairs).length >= MAX_ARCHIVED_PAIRS) { droppedOverflowPairs += 1; continue; }
```

`isReal` is `!id.startsWith('guest:')` (`:31`). `MAX_ARCHIVED_PAIRS` is 1,200 (`:181`), sized so
the archive cannot exceed Firestore's 1 MB document limit and make the club *permanently unable to
close a season* — the failure mode is unrecoverable, because a season summary is written with
`create()`.

Guests are the reason the cap exists. A guest identity is minted fresh for every game, so
`communityPairStats` gains a permanent new document for every stranger who ever turns out.
Production, counted by paging the whole collection today: **314 pair documents for a seven-player
club, 293 of them guest pairs (93%), 21 real.** The collection holds 717 documents across the
entire database, so this one club is 44% of it. Finding
**guest-pairs-make-every-close-read-fifteen-times-what-it-archives** (P2) is exactly this: the
close reads 314 documents to archive at most 21, the sweep runs last inside `cronEvery60Min`'s
shared 540-second budget, and at roughly 45 pair documents per player a sixty-player club is about
2,700 reads per close. HEAD mitigates the *growth* by deleting guest pair rows during the wipe
(`:944-949`) — but that code is not yet deployed, and the 293 documents are still there.

The surviving pair is stored under a sorted key, with `a`/`b` and the four directional counters
flipped to match (`seasonPairKey`, `:104-110`). One key, derived one way, used by both the wipe
and the restore: if they disagreed a reopen would give a pair chemistry it never had.

#### The archive write, and the `create()` latch

```ts
// seasonRollover.ts:580
const summaryRef = db.collection('seasonSummary').doc(`${groupId}__${seasonId}`);
try {
  await summaryRef.create({ /* … totals, players, pairs, awards … */ });
} catch (err) {
  const code = (err as { code?: number | string }).code;
  if (code !== 6 && code !== 'already-exists') throw err;
  const existing = await summaryRef.get();
  if (existing.get('zeroedAt')) {                       // :667
    console.log('[season] already closed — skip', groupId, seasonId);
    return { archived: false, players: 0, pairs: 0 };
  }
  resuming = true;                                       // :676
  resumedAwards  = existing.get('awards');
  resumedPlayers = existing.get('players');
  resumedTotals  = existing.get('totals');
  resumedEvenings = existing.get('completedRounds');
}
```

That single `create()` is the whole idempotency story, and the ordering — build in memory, archive,
*then* wipe — is what stops a retry from sealing a season of zeros over the real one.

`zeroedAt` (written last, `:1024`) separates the two meanings of ALREADY_EXISTS. Present: the first
pass finished, the live rows now belong to the next season, stop. Absent: the first pass died
between the archive landing and the wipe, and the club is half-closed — the season sealed, the
titles never written, the table never reset. On the resume path every derived value is read back
off the archive, not recomputed, because the live rows may be half-wiped.

**[defect: resume-subtracts-recomputed-row, P2]** — with one exception, and it is the whole of the
wind-back. `resumedPlayers` is used for the card (`:744`) and `resumedAwards` for the card and the
titles (`:717`, `:832`), but the subtraction at `:879` and `:903` uses `players` — the map
recomputed from the live rows at the top of *this* invocation:

```ts
// seasonRollover.ts:878
for (const d of psSnap.docs) {
  const archivedRow = players[(d.data() as { userId?: string }).userId ?? ''];
  if (!archivedRow) continue;
  …
  Object.assign(patch, windBackRow(data, archivedRow, PLAYER_SEASON_FIELDS));
```

On a resume, an evening played between the crash and the retry is inside `players` but not inside
the sealed archive. Subtracting the recomputed row therefore removes that evening from the live
table while the archive never recorded it: it exists nowhere. This is the precise failure the
module header at `:46-61` says subtraction exists to prevent, on the one path where the two rows
differ.

#### The card

`seasonCards/{groupId}__{seasonId}` (`:755-809`) is a compact projection for the hall of fame —
date, three totals, a participant count and the resolved winner names — because the archive is
large and the list screen would otherwise pull every season in full. Two details:

* `countSeasonParticipants` (`functions/src/seasonParticipants.ts:23`) counts `games > 0 ||
  rounds > 0`. It shipped counting `rounds` alone, which is **משחקונים** (mini-games), which only
  exist in advanced mode — so every season a timer-only club closed reported "0 שחקנים"
  ("0 players") no matter how many people turned up.
* `sealedCardEvenings` (`:155-165`) prefers the archived `completedRounds`, then the caller's, then
  the awards denominator. The card prints this as "N מחזורים". It is written with `merge:true`, so
  a resume converges rather than duplicating.

The field `awardsDenominator` lived on both the archive and the card for one day and was removed in
`8235851`. `awardsDenominatorOf` (`:133-139`) is `max(players.games)`, and `mostLoyal` is the
maximum of the same array, so `winner.value / awardsDenominator` is 1.0 by construction — the
medal tier it fed was platinum for every season of every club, forever. Production proves the
identity: s1's archived `games` are `{19,18,18,18,18,18,17}` and `awards.mostLoyal.value` is 19.
The number survives only as the awards *eligibility gate*'s denominator (`:556-559`), never as a
published share.

#### The titles

`:823-860` writes one document per winner per title at
`users/{uid}/seasonTitles/{groupId}__{seasonId}__{titleKey}`, with `groupName` frozen, batched 400
at a time, outside the `create()` latch on purpose. A pair title's key is split on `__` so both
halves get a copy; `guest:` ids are skipped. `if (!award) continue` — a null award is a result, not
a gap. Production holds 14 such documents for s1: eight titles, of which `mvp` has seven winners
and `deadlyDuo` is null.

#### The wind-back

The invariant, stated at `:46-61` and implemented in `windBackRow` (`:62-74`):

```ts
out[f] = archived ? Math.max(0, rowNum(current?.[f]) - rowNum(archived[f])) : 0;
```

**Subtract what was archived; do not write zeroes.** The rows were read at the top and are wiped at
the bottom; anything committed in between is not in the archive, and an absolute zero would erase
it from the live table too, leaving it nowhere. `archived === null` means "this row belongs to no
season" — a pair past the cap — and *is* zeroed. Subtraction is not idempotent, so each row gets
`seasonWoundBack: seasonId` and `seasonReopened` is deleted so a later reopen can stamp its own
restore. Player rows go one transaction each (`:881`); pair rows go in 400-op batches (`:980`).

The skip guards read `if (resuming && row.seasonWoundBack === seasonId)` (`:886` for players,
`:973` for pairs). The `resuming &&` half was added in `8235851` and is **not deployed**. Without
it, a stamp naming the season being closed was treated as proof that season had already been wound
back — but a *reopen* leaves that stamp on every row the close touched and the restore did not
reach. Finding **stale-pair-woundback-stamp-skips-next-wipe** (P1) is live right now: all 314 pair
documents on this club carry `seasonWoundBack: "s2"` while **s2 is the running season**. Against
the deployed binary, closing s2 archives those 21 real pairs' chemistry *and* leaves it standing
live for s3 to inherit, double-counted, with the archive write-once. Against HEAD it is correct.
The reopen now also sweeps stale stamps (`:1174-1198`), but it ran five and a half hours before
that code deployed.

**[defect: club-totals-zeroed-not-subtracted, P1]** The club document breaks the rule the module is
built on:

```ts
// seasonRollover.ts:1004
const zeroClub: Record<string, number> = {};
for (const f of CLUB_SEASON_FIELDS) zeroClub[f] = 0;
await db.collection('communityStats').doc(groupId).set({ ...zeroClub, … }, { merge: true });
```

Absolute zero, not `windBackRow`. Player rows and pair rows subtract; the seven club counters
(`rounds`, `goals`, `guestGoals`, `ownGoals`, `tiedRounds`, `shootoutRounds`, `scorelessRounds`) do
not. An evening committed between the read at `:310` and this write is preserved on every player
row and destroyed on the club total, so the club's goals stop equalling the sum of its members'
goals with nothing anywhere recording the discrepancy. `chemistrySince` is re-stamped to `now` in
the same write, which is correct — otherwise the new season's chemistry card would date itself from
the old one.

### Season 1 of מועדון שכחת שושי, reconciled against the games

`seasonSummary/HhzIwmjMl1i5HSOGHt3p__s1`, read live:

| field | value | reconciles to |
|---|---|---|
| `startsAt` | `1789547794676` = 2026-09-16 08:36:34Z | the moment **seasons were switched on**, not the club's first game (June). The hall of fame therefore prints "ספט׳ 2026 – ספט׳ 2026" above "22 מחזורים" — finding **season1-startsat-is-the-enable-moment** |
| `endsAt` = `closedAt` | `1789661526768` = 2026-09-17 16:12:06Z | the seal of `TZ7IWEJWVww2itvIKCd8` |
| `zeroedAt` | `1789661533425` | 6.7 s later — the whole close took under seven seconds for 7 players and 314 pair rows |
| `completedRounds` | `22` | 19 unstamped legacy evenings + 3 stamped `s1` (`yA48XsyC`, `nRHEgxVt`, `TZ7IWEJW`); a 23rd finished game, `DTNscolR`, is stamped `s3` and carries `playVerified:false` |
| `roundsAtStartOfSeason` | `7` | `clubRecords.eveningsSealed` on 16.09. Ten `roundSummaries` documents exist for this club; seven were already written when seasons were switched on, and three (`yA48XsyC`, `nRHEgxVt`, `TZ7IWEJW`) were sealed during s1 |
| `originalTarget` | `{type:'rounds', targetRounds:22}` | the cadence at close time; the club's current cadence is 24, moved on 18.09 |
| `totals.rounds` | `37` | **משחקונים**, mini-games — not evenings. The same document says 22 in `completedRounds`. Both numbers are correct and they measure different things |
| `totals.goals` / `guestGoals` | `27` / `4` | |
| `totals.assists` | `13` | = 1+5+1+2+3+0+1, summed from the seven member rows at `:392` |
| `totals.cleanSheets` | `75` | = 12+11+13+8+10+11+10, summed at `:396` |
| `players` | 7 rows | |
| `pairs` | 21 | exactly C(7,2) — every member pair played together at least once; all 293 guest pairs dropped |
| `awards` | 8 of 9 decided | `deadlyDuo: null` |

The seven archived `games` values are `{19, 18, 18, 18, 18, 18, 17}`. Counted directly from the 22
game documents' `players` arrays, actual attendance is `{22, 20, 20, 20, 20, 20, 19}`. The gap is
finding **archive-games-undercounts-every-player** (P1) and it resolves exactly: three evenings —
`2SMrlCGH` (06.07), `MMtE8J6H` (16.07), `FCa5UtSd` (04.08) — never left `liveMatch.phase:
"organizing"`, have `rotation: null`, and credited nobody a `games` increment. `didEveningHappen`
counts them (they are legacy closes with no `endedBy`, so `isLegacyClose` (`functions/src/eveningPlayed.ts:196`, `endedBy` neither `'admin'` nor `'auto'`) calls them 'happened'),
the per-player counter does not. מתן לוי attended all three (22 − 3 = 19); the other five regulars
attended two each (20 − 2 = 18); איציק לוי attended two (19 − 2 = 17). **The archive's own season
length and its own per-player attendance are counted by two different rules that disagree by three
on this club** — which is precisely why `awardsDenominatorOf` exists, and why the eligibility gate
is set from `max(games) = 19` rather than from `completedRounds = 22`.

The pair archive reconciles too: summed over the 21 entries, `sameTeam` 94, `against` 140,
`winsTogether` 46, `lossesTogether` 35, `cleanSheetsTogether` 50, `winsA` 62, `winsB` 52,
directional assists 4 + 3 = 7 against a legacy undirected `assists` of 8. `deadlyDuo` is null
because the best pair score is 2 and the floor is `MIN_DUO_ASSISTS − 1 = 2` with strict `>`
(`seasonAwards.ts:152`, `:159-166`).

`mvp` is awarded to **all seven members at exactly 6.0**. Every player's `eveningScoreSum /
eveningScoreCount` is 18/3 or 12/2. 6.0 is the bottom of the evening-score scale and also what the
score returns for a player who took the field for no mini-games. `MVP_SCALE_FLOOR = 6` with a
strict `>` now blocks this (`seasonAwards.ts:156`, `:236`) — but s1's archive is write-once and
seven junk **שחקן העונה** ("player of the season") title documents sit on seven profiles
permanently. Finding **mvp-title-crowns-the-entire-club** (P1).

#### And the close that archived nothing

Four hours after s1 closed, at 21:12:08Z, a second close ran on the same club. Its archive has
since been deleted by a reopen, but the state it left behind is unambiguous and is still on disk:

* All seven `communityPlayerStats` rows read `{games:0, rounds:0, goals:0, …}` and still carry
  `seasonWoundBack: "s1"` — **not** `"s2"`. They were already empty, so the `:366` filter excluded
  every one of them from `players`, so `players` was `{}`, so the wind-back loop's
  `if (!archivedRow) continue` (`:880`) skipped every row and wrote no stamp.
* All 314 pair rows read zero and carry `seasonWoundBack: "s2"` — the wipe reached them (guest
  deletion was not yet deployed, so they were zeroed rather than removed). The production log the
  audit captured for this close reads `kept 0, dropped 293 guest, 21 empty`.
* `communityStats` is all zeros with `seasonReopened: "s2"`.

So the close archived an empty `players` map, an empty `pairs` map, zero totals, and — because
`endSeasonNow` still passed two arguments, giving `completedRounds = 10 − 10 = 0`, and
`computeSeasonAwards` returns all-null for `completedRounds <= 0` (`seasonAwards.ts:199-205`) —
nine null awards. It then wrote a `seasonCards` document reading "0 שחקנים", pushed nobody
(`announceSeasonClosed` at `index.ts:15342-15351` iterates the empty `players` map), and advanced
the club to season 3. `games/DTNscolRojYDf0ZmT0sF`, kicked off seven minutes later, still carries
the orphan stamp `seasonId: "s3"` on a club whose `seasons` block now knows only s2.

This is finding **perform-close-writes-next-season-even-when-nothing-was-archived** (P1) in its
observable form: *nothing in either close path is conditional on the archive containing anything.*

### `clubIsQuiet`

`index.ts:15466-15571`. The one thing a close must not do is split an evening: each mini-game
commits separately, so mini-games 1-3 would land in the old season and 4-6 in the new, while the
player's career total — written in the same batch — keeps the whole. Two checks.

**Check one: is a game in play.** A `games` query filtered by status and bounded on both sides:

```ts
// index.ts:15495
.where('status', 'in', afterSeal ? ['active'] : ['scheduled','open','locked','active'])
.where('startsAt', '<=', now + STARTING_SOON_MS)   // +3h
.where('startsAt', '>=', now - TONIGHT_MS)         // −12h
.limit(2)
```

The upper bound is `now + 3h` because a game can be started before its scheduled kickoff. The lower
bound exists because a game left open days ago is stale and must not hold a club's season hostage
forever. The status list narrows to `['active']` on the `afterSeal` path: the evening the close
would split just ended, so only a genuinely-in-play second game can block, not next week's
recurring clone — and *nearly every real club runs a recurring fixture*, which is why the unbounded
earlier version meant no such club could ever close a season on any path.

**Check two: is an evening finished but not yet sealed.** The three newest `finished` games; for
each, if it has no `roundSummaries/{gameId}` document, block. Closing in that gap makes
`sealRoundSummary` compare tonight against a table with no history, so every stat reads as a
brand-new club record — and the summary is written once, so the wrong story is permanent.

Three floors let a game out of check two (`:15542`, `:15557`, `:15564`): the evening did not happen
per `didEveningHappen`; it is a **legacy close** (`endedBy` is neither `'admin'` nor `'auto'`); or
it started more than `STALE_SEAL_MS` (24 h) ago.

**[defect: quiet-legacy-evening-blocks-club-forever, P1-really-P0]** The legacy floor at `:15557`
is the fix; before it, that clause did not exist. `roundSummaries` began on 26.08.2026, so every
evening finished before that date carries no `endedBy`, is called 'happened' by `isLegacyClose`,
and will never be sealed by anything. "Finished but not yet sealed" was therefore *permanently*
true for them. An auditor ported both functions and ran them over all 91 finished games in
production: **24 of the 30 clubs that have ever finished a game returned
`{ok:false, blocker:'unsealedGame'}` forever.** Those clubs could not enable seasons with "seal
now", could not end a season by button or by sweep, and could not undo a close — while the Hebrew
told the admin to wait for something that was never going to happen. The window only advances when
the club plays a *new* evening, and those games are terminal. This is why exactly one club in a
195-club database has ever run a season. The fix is deployed; the historical distortion of every
adoption number is not undone by it.

One more note on scope: `clubIsQuiet` is a per-club gate on *closing*, not a lock. Nothing prevents
a mini-game from committing during the seven seconds the close takes; that is what the subtraction
semantics exist for, and what the club-totals zero throws away.

### `performSeasonClose`: the rewrite of the `seasons` block

Two things happen around `closeSeason` here.

**Pre-flight** (`index.ts:15823-15834`). Both callers arrive holding a snapshot that can be minutes
old, so the group document is re-read:

```ts
const preSnap = await groupRef.get();
const pre = preSnap.data()?.seasons;
if (pre?.enabled !== true || pre?.currentId !== seasonId) {
  console.log('[season] close abandoned — the club moved under us', …);
  return false;
}
```

**[defect: sweep-closes-a-club-that-turned-seasons-off, P1]** This check *is* the fix for that
finding. The sweep takes one paged snapshot at the top of a run that walks every enabled club; a
club that disabled seasons in between would previously have had its table wiped, its titles
awarded, everyone pushed, and been left with seasons off and an archive no screen can reach —
because the lifecycle write below does not carry `enabled`, so nothing turns them back on. Note the
check is a plain read, not part of a transaction with the close: the window is narrowed from
minutes to milliseconds, not eliminated.

The same read harvests two fields that the lifecycle write is about to destroy: `targetHistory`
(reset to `[]` for the next season, so the archive is the only place it can survive — this club
went 22 → 2 → 24 and only the last survives anywhere) and `targetMovedToClose`, which, if present,
marks the archive `endedEarly` with the admin who moved the finish line onto the club's current
position.

**The lifecycle write** (`:15887-15924`), in a transaction re-checking `currentId`:

```ts
tx.set(groupRef, { seasons: {
  currentNo: nextNo, currentId: `s${nextNo}`,
  startedAt: now,
  roundsAtStart: nextRoundsAtStart,     // await sealedEveningsOf(groupId) — the ABSOLUTE count
  playedRounds: 0,
  reopenedAt: 0,
  cadence: nextCadence,                 // rebaseCadence(cadence, args.startedAt, now)
  targetHistory: [],
  targetMovedToClose: FieldValue.delete(),
  dueBlockedSince: FieldValue.delete(),
  count: closedSoFar + 1,
} }, { merge: true });
```

`rebaseCadence` (`:15405-15447`) is a no-op for a `rounds` cadence and, for a `date` cadence,
recomputes `months`, `endsAt`, `startsOn` and `endsOn` from `now`. All four are returned
explicitly because the block is written with `merge:true` into a nested map: an omitted field keeps
whatever the previous cadence left there. `endsOn` was the field this function once failed to
return, and since the sweep asks `endsOn` first, the new season inherited the date the old one died
on, was due the hour it opened, and closed again — every hour, forever, archiving an empty season
each time.

`count` is read from the document inside the transaction rather than from the caller's snapshot,
because `count` is what the undo button uses to decide which season to reopen
(`reopenLastSeason`, `index.ts:16882-16883`: `lastId = 's' + count`). `closeSeason`'s
`archived:false` latch guards the archive and nothing else, so before this transaction existed a
seal-close and a sweep racing on one club both fell through and the loser rewrote the lifecycle of
the season the winner had just *opened*: `startedAt` moved to now, `playedRounds` back to 0,
`targetHistory` erased, `count` incremented past anything ever played. The transaction closes the
race; `return advanced` then tells the caller whether it won.

`endSeasonNow` does not use any of this. It writes the equivalent block itself at
`index.ts:17050-17070` — same fields, same deletes, same `rebaseCadence` — outside any transaction
and with no pre-flight identity check, on the reasoning that an admin pressing a button is
synchronous. It is the only close path that can run while the season has not met its target, and
the only one that always stamps `endedEarly`.

Finally, `announceSeasonClosed` is called only `if (result.archived)` on both `performSeasonClose`
(`:15928`) and `endSeasonNow` (`:17071`) — so a resumed close, which returns `archived: true`, will
re-announce, while a redelivery, which returns `false`, will not.

**[defect: partialdata-never-set-on-a-rollover-close, P2]** `partialData` marks an archive whose
metrics predate the counters that feed them (assists collected only from 21.06, clean sheets from
17.08). It is passed by exactly one caller — `enableClubSeasons`' "seal now" branch,
`index.ts:16483`. Neither `performSeasonClose` nor `endSeasonNow` passes it, so a season 1 that is
*carried on* and then rolls over is sealed with no flag at all, and the hall of fame presents its
partial numbers as complete. s1 of this club is precisely that case: its archive has no
`partialData` field, and its clean-sheet total of 75 covers only the portion of the season after
17.08.
