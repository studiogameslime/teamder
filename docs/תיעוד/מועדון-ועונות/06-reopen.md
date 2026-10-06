## Undoing a close

### The shape of the operation

Two functions do this. `reopenLastSeason` (`functions/src/index.ts:16848-16968`) is the
callable an admin presses; it owns the *lifecycle* — which season the club is on, its
numbering, its finish line. `reopenSeason` (`functions/src/seasonRollover.ts:1067-1253`) is
the pure-ish half that owns the *numbers* — it puts the stats back and deletes the archive.
The division is stated in the doc-comment at `seasonRollover.ts:1063-1065`:

> The caller is responsible for restoring the club's `seasons` block — this function owns
> the numbers, not the lifecycle.

That split is also the source of one of the defects below, because the two halves are not
atomic with respect to each other.

The client entry point is `SeasonsSettings.tsx:525-589` (`reopenLast`), rendered as an
outline button at `:971-990`, gated on `live && (seasons?.count ?? 0) > 0`. The service
wrapper is `src/services/seasonService.ts:264-267`, a bare callable invocation returning
`{ reopenedNo }`.

### What the button is for

It is not a general time machine and the code says so twice. `index.ts:16836-16845`:

> Deliberately only the LAST one, and only while it is still the club's most recent:
> reopening season 2 of four would leave seasons 3 and 4 sitting on numbers that were
> counted from a table that no longer starts where they think it does. This is a correction
> for "I pressed it a week early", not a time machine.

Three preconditions are enforced, in this order (`index.ts:16873-16890`):

| Check | Code | Failure |
|---|---|---|
| Caller is a club admin | `requireClubAdmin(data.groupId, uid)` | `permission-denied` |
| At least one closed season | `seasons.count >= 1` | `failed-precondition 'no closed season'` |
| Club is quiet | `clubIsQuiet(groupId)` (no open game, nothing unsealed) | `failed-precondition 'openGame' \| 'unsealedGame'` |
| Archive still exists | `seasonSummary/{groupId}__s{count}` | `not-found 'no archive for the last season'` |

The quiet rule exists for the same reason it exists on the close: restoring a table while an
evening is mid-play folds that evening's mini-games (משחקונים) into the season being
reopened, and each mini-game commits separately, so the split is per-round rather than
per-evening.

Note the season the button targets is computed purely from the counter:
`lastNo = seasons.count; lastId = \`s${lastNo}\`` (`index.ts:16882-16883`). Nothing reads
`currentId` to work out what the *successor* was. The successor season is simply overwritten
— it is never archived, never announced, and nothing records that it existed.

### The two lists, side by side

`closeSeason` writes to seven places. `reopenSeason` reads five of them back.

| # | What the close does | Where | What the reopen does | Net |
|---|---|---|---|---|
| 1 | `create()`s `seasonSummary/{g}__{sid}` — every player row, every real pair's ten counters, the totals, the nine decided titles | `seasonRollover.ts:584-643` | `summaryRef.delete()`, last | **destroyed** |
| 2 | `set()`s the compact `seasonCards/{g}__{sid}` for the hall of fame | `:752-818` | `.delete()` | symmetric |
| 3 | `set()`s `users/{uid}/seasonTitles/{g}__{sid}__{key}` for every winner (duo key split on `__`, guests skipped) | `:823-860` | `batch.delete()` on the same deterministic ids, same split, same guest skip | symmetric |
| 4 | Per player row: **subtracts** the 18 `PLAYER_SEASON_FIELDS`, stamps `seasonWoundBack`, deletes `seasonReopened` | `:878-906` | **adds** the archived row back, stamps `seasonReopened`, deletes `seasonWoundBack` | symmetric *for archived rows only* |
| 5 | Per real pair: subtracts the 10 `PAIR_SEASON_FIELDS`, stamps `seasonWoundBack`, deletes `seasonReopened`. Pairs with no archive row are **zeroed**. Guest pairs are **deleted outright** | `:924-1002` | adds back only pairs present in `archive.pairs`; then a sweep clears `seasonWoundBack == seasonId` from every other pair row | **partial** |
| 6 | Club doc `communityStats/{g}`: zeroes the 7 `CLUB_SEASON_FIELDS`, deletes `seasonReopened`, **re-stamps `chemistrySince = now`** | `:1004-1022` | adds the archived totals back, stamps `seasonReopened`. `chemistrySince` untouched | **partial** |
| 7 | Lifecycle (`performSeasonClose`, `index.ts:15884-15925`): `currentNo+1`, new `currentId`, `startedAt=now`, `roundsAtStart=eveningsSealed`, `playedRounds=0`, `reopenedAt=0`, re-based `cadence`, `targetHistory=[]`, deletes `targetMovedToClose`/`dueBlockedSince`, `count+1` | | `index.ts:16896-16966` restores all of it from the archive | mostly symmetric — see `playedRounds` and `cadence` below |
| 8 | `announceSeasonClosed` (`index.ts:15324-15372`) creates one `notifications` doc per participant, deep-linked to the sealed season | | nothing | **left dangling** |
| 9 | Nothing — but every game played in the discarded successor keeps its `seasonId` stamp | `onGameRosterChanged` | nothing | **left dangling** |

Everything in the first column that has no entry in the third is permanent, because step 1
runs last and the archive is the only copy.

### The permanent losses, enumerated

**Guest pair chemistry** (`reopen-never-restores-guest-pair-chemistry`). A guest id is minted
per game, so `communityPairStats` accumulates one document per stranger-pairing for ever. The
close deliberately keeps them out of the archive (`isReal()` at `seasonRollover.ts:31`, drop
at `:436-439`) because copying them in would grow one document without bound until the club
could never close a season again. Then `:943-949` deletes the guest pair documents outright.
The restore loop at `:1129-1156` iterates `archive.pairs` only. So the data is gone from both
sides at once. On the one club that has run seasons this is **293 of 314 pair documents, 93%
of the collection** — I paged the whole collection live to confirm the counts. The module's
own comment at `:1035-1041` states the rule and its consequence: *"a counter missing from
this list is cleared by the close and never restored by the reopen, and the archive that held
it is deleted at the end of the reopen. There is no way back from a gap here."*

**Pairs past the archive cap.** `MAX_ARCHIVED_PAIRS = 1200` (`:181`). Pair 1,201 onwards is
zeroed by the close (`archivedPair` is `null`, so `windBackRow` writes absolute zeros —
`:65-73`) and is not in the archive, so the reopen cannot restore it. For a 50-player club
this is unreachable; for a large one it is silent.

**`chemistrySince`** (`chemistry-since-not-restored`). The close sets it to the close instant
(`:1017`) so the new season's chemistry card does not date itself from the old one. The
reopen never touches it. Live on the club right now:
`communityStats.chemistrySince = 1789679528192` = **2026-09-17T21:12:08Z**, which is the
moment s2 was *closed*; s2 has been running again since 10:37Z the next morning and its own
`startedAt` is 21:05:41Z. The card therefore dates a running season's chemistry from six and
a half minutes after it started.

**Coverage denominators.** `csRounds` and `asRounds` are deliberately *omitted* from the
archive when the live row has no number for them (`:377-379`) — "measured across zero rounds"
and "never measured" are different facts. But `windBackRow` has no matching branch:
`out[f] = Math.max(0, rowNum(undefined) - 0) = 0`. So the close converts absent into `0` on
exactly those rows, and the restore adds the archive's absent-as-zero back, i.e. nothing. The
distinction is destroyed by the close and cannot be recovered by the undo. It affects the
longest-standing members — the ones who predate the fields — and it blanks two efficiency
columns for them permanently.

**`targetHistory` of the discarded successor.** The close seals the *closing* season's
history into the archive (`index.ts:15838-15840`) and resets the block to `[]`. The reopen
restores the archive's copy, or `[]` (`index.ts:16945-16947`). Anything the successor
recorded — every finish-line move made during its life — is destroyed with no archive at all,
because the successor is never archived. On this club the discarded s3's `targetHistory` is
gone; what the block holds today is one entry written **27 seconds after the reopen**
(`at: 1789727874911` = 10:37:54.911Z vs `reopenedAt: 1789727847680` = 10:37:27.680Z) recording
a rounds target moved 2 → 24.

**`seasonId` stamps on games played in the discarded season.** Nothing rewrites them. Live:
one finished game, `DTNscolRojYDf0ZmT0sF` at 2026-09-17T21:19:42Z, carries `seasonId: 's3'`
while the club is on s2 and no season 3 exists. Its *statistics* were folded into the live
table the restore added to; its *evening* belongs to a season id that has been withdrawn.

**The notification documents** (`undo-leaves-dangling-season-summary-pushes`). `createNotificationOnce`
writes a durable doc per recipient; the reopen deletes none of them. Live, I fetched all seven
by their deterministic ids
(`seasonSummary:{uid}:group:HhzIwmjMl1i5HSOGHt3p:season-s1__b2959`): all seven exist, all seven
have `read: false`, all created 2026-09-17T16:12:14Z. Pressing undo once more — which the
button allows today — deletes `seasonSummary/…__s1` and leaves those seven live, unread,
deep-linking into a season that no longer has an archive. And the client does not say so:
`seasonSummaryService.load` (`src/services/seasonSummaryService.ts:429-456`) tries the archive
first, and when `archived.exists()` is false it falls straight through to the branch that
builds the **running** season's model. The reader taps "עונה 1 הסתיימה" and is shown the
current season under a heading for it.

### The two latches

Neither half of this operation is idempotent — the close subtracts, the reopen adds — so each
row carries a stamp naming the season it was last moved for.

```ts
// close, seasonRollover.ts:886-900 (player rows)
if (resuming && data.seasonWoundBack === seasonId) return;
const patch = {
  seasonWoundBack: seasonId,
  seasonReopened: admin.firestore.FieldValue.delete(),
  ...
};

// reopen, seasonRollover.ts:1101-1107 (player rows)
if (cur.seasonReopened === seasonId) return;
const patch = {
  seasonReopened: seasonId,
  seasonWoundBack: admin.firestore.FieldValue.delete(),
  ...
};
```

`seasonWoundBack` protects against a *close* being applied twice; `seasonReopened` protects
against a *reopen* being applied twice. They are mutually exclusive by construction: whichever
one is written deletes the other. Each is cleared by the opposite operation precisely so a
close→reopen→close→reopen chain can keep working.

The `resuming &&` guard on the close side is load-bearing and recent. A `seasonWoundBack`
stamp is only evidence of "already wound back" when *this invocation* wrote it — i.e. on the
resume path, after the archive already exists and the wipe died halfway. On a first pass the
only thing that can have left a stamp naming the season about to be closed is a *reopen* of
that same season, which handed the numbers back live while the stamp still says they were
taken away. Treating it as evidence there means archiving chemistry and then skipping the wipe
for it — sealing it into the write-once archive and leaving it standing live for the next
season to inherit.

**That is `pair-wipe-skipped-on-next-close-after-reopen`, and it is armed in production right
now.** All 314 pair documents on `HhzIwmjMl1i5HSOGHt3p` carry `seasonWoundBack: "s2"`, with
`updatedAt: 1789679528192`, while s2 is the running season. None carries `seasonReopened`. The
stale-stamp sweep that was written to fix this (`seasonRollover.ts:1157-1198`) runs on *reopen*
only:

```ts
const stamped = await db
  .collection('communityPairStats')
  .where('groupId', '==', groupId)
  .where('seasonWoundBack', '==', seasonId)
  .get();
```

The reopen that armed the state ran at 2026-09-18T10:37:27Z; the sweep deployed at
2026-09-18T18:16:55Z (`gcloud functions describe reopenLastSeason`). Nothing re-runs it over
existing data. The 293 guest rows are no longer the exposure — the close now deletes them
before it reaches the stamp check (`:943-949`) — but the 21 real pair rows will be archived
and then skipped when s2 closes.

The other asymmetry worth naming: the *player* rows only started deleting `seasonReopened`
inside the close in the current HEAD (`:900`). The pair and club writes always did. Before
that, a close→reopen→play→close→reopen cycle left every player's `seasonReopened` stamp from
the *first* reopen in place, so the second reopen's per-row guard returned early for every
player: club totals and pair chemistry came back, every player's season stayed at zero, and
the archive was deleted on the way out. The LEDGER records this one as verified fixed in the
deployed bundle.

There is no latch at all on `communityStats` for the close — it writes absolute zeros
(`zeroClub`, `:1004-1022`) rather than subtracting, so it is naturally idempotent. The reopen
does add, so it carries `seasonReopened` (`:1201-1216`). Live, `communityStats` holds
`seasonReopened: "s2"` and nothing else from the pair collection does — which is itself the
tell that the s2 restore reached the club document and found no archived pairs to restore.

### `playedRounds`, wrong in two directions

`seasons.playedRounds` is the mirror the club card prints as "N מתוך M מחזורים" ("N out of M
game-nights") and the number the sweep closes on. It has had three implementations inside the
undo path in two days.

```ts
// index.ts:16925-16936, as it stands today
playedRounds: await (async () => {
  const counted = await playedEveningsOfSeason(groupId, lastId, lastNo);
  if (counted >= 0) return counted;
  return typeof archive.get('completedRounds') === 'number'
    ? archNum(archive.get('completedRounds'))
    : Math.max(0, (await sealedEveningsOf(groupId)) - reopenedRoundsAtStart);
})(),
```

1. **`eveningsSealed - roundsAtStart`.** A subtraction of two counters that drift for
   different reasons — `clubRecords.eveningsSealed` only exists from 26.08.2026. A season
   closed at 23 evenings came back holding 1.
2. **`archive.completedRounds`** (commit `4be7f1c`, "A reopened season counts its own games,
   not a number it inherited"). Correct in principle — the archive is the record — and it
   inherits any error the archive holds. A junk season that a seeding bug opened and closed
   inside six and a half minutes had archived `completedRounds: 22`, the club's entire
   lifetime, and reopening it restored 22 onto a season that had held nothing. The club card
   then read "22 מתוך 24" while the statistics screen, which counts stamped games, read 0.
3. **Counted from the games** (today). `playedEveningsOfSeason` (`index.ts:15599-15637`)
   queries the club's terminal games ordered by `startsAt desc, limit 300` and hands them to
   `countSeasonEvenings` (`functions/src/seasonCounters.ts:70-79`), which asks
   `eveningInSeason` for scope and `didEveningHappen` for reality.

The third fix shipped in two halves, and the first half was itself wrong
(`reopen-playedrounds-ignores-unstamped-games`). `4be7f1c` filtered on `seasonId == lastId`
with no notion of season 1. The stamp is only written from the day the feature shipped, so a
club's pre-seasons history carries nothing — and **that history *is* season 1**. Nineteen of
this club's twenty-two evenings are unstamped, so undoing season 1 wrote `playedRounds: 3`,
which is the same defect as implementation 1 arriving from the other side. `ae2c042` added the
third parameter:

```ts
// seasonCounters.ts:53-60
export function eveningInSeason(game, seasonId, seasonNo?): boolean {
  const stamp = typeof game.seasonId === 'string' ? game.seasonId : '';
  return stamp ? stamp === seasonId : seasonNo === 1;
}
```

Run over the live games today (23 terminal games, `didEveningHappen` evaluated field by field):
3 stamped `s1` happened, 19 unstamped happened, 1 stamped `s3` did not (`playVerified: false`).
So undoing today would write `playedRounds: 22` for s1 — matching the archive's
`completedRounds: 22`, the card's 22, and the club screen's "מפגשים שנערכו". The reopen that
actually ran yesterday wrote `playedRounds: 0` for s2, which is also correct: no evening was
ever stamped s2.

Two caveats remain. The count is bounded at 300 documents and is *not* a query on `seasonId`,
so a club with more than 300 terminal games silently under-counts an old season. And the
evenings played inside the **discarded successor** are counted for nobody: their statistics
were just added into the reopened season's live rows, while their games still carry the
successor's stamp, so `playedEveningsOfSeason` skips them. Reopen a season after the successor
has held five evenings and the club's table contains those five evenings' goals while its
progress bar says they never happened.

### Numbering, and the re-issued id

The reopen writes `count: closedSoFar - 1` and `currentNo: lastNo` (`index.ts:16962`,
`:16901`). Since `currentNo` is always `count + 1`, the club's arithmetic stays consistent —
but the *identifier* is not unique over time. The season the reopen discards had an id;
nothing remembers that it was used. When the reopened season is closed again the lifecycle
write allocates `s${seasonNo + 1}` (`index.ts:15884`), which is the same id.

Live worked example. The club closed s1, opened s2, closed s2 six and a half minutes later,
opened s3, then undid — so today: `count: 1, currentNo: 2, currentId: 's2'`, one finished game
stamped `s3`, and `seasonSummary/…__s2` and `seasonCards/…__s2` both 404. When s2 closes
again the next season will be s3 again, and that 17.09 game will be inside the new season 3 on
its first day (`orphan-season-stamp-absorbed-by-the-next-season-of-the-same-id`). The same
re-issue also means the write-once protections reset: `seasonSummary/{g}__s3` can be
`create()`d again because the old one never existed, and `users/{uid}/seasonTitles/{g}__s3__*`
will be overwritten rather than duplicated.

**`undo-chains-backwards-with-no-limit`.** There is no time bound and no already-undone guard.
The only precondition is `count >= 1` and an archive at `s${count}`; both hold again
immediately after a successful reopen, because `count` was decremented and the *previous*
season's archive is intact. Two presses walk back two seasons; five walk back five, each one
deleting an archive, stripping its titles off profiles, and leaving its push notifications
pointing at nothing. The Hebrew confirmation (`he.ts:2234-2238`) does name the season number,
and does say the archive is deleted — "וסיכום העונה והארכיון שלה יימחקו — אי אפשר לשחזר אותם
אחר כך" ("the season summary and its archive will be deleted — they cannot be recovered
afterwards") — but nothing says which press you are on, and nothing refuses a third.

### The 48-hour grace

`REOPEN_GRACE_MS = 48 * 60 * 60 * 1000` (`index.ts:15455`). The reopen stamps
`seasons.reopenedAt = Date.now()` (`:16905`) and two closing paths honour it:

```ts
// hourly sweep, index.ts:16178-16182
const reopenedAt = archNum(seasons.reopenedAt);
if (reopenedAt > 0 && now - reopenedAt < REOPEN_GRACE_MS) {
  console.log('[season] due but just reopened — holding', doc.id);
  continue;
}
// close-on-seal, index.ts:15977-15979 — same two lines
```

The reason is that a season is usually reopened *because it met its target*, so it is due the
instant it comes back; without the grace the sweep would re-close it within the hour and the
button would be inert. The grace is a window for the admin to move the finish line. It is
cleared by the next close (`reopenedAt: 0`, `:15906`) and by enabling seasons on a club that
had them off (`:16502`) — but *not* by `disableClubSeasons`, which writes only
`{ seasons: { enabled: false } }` (`:16622`). A club that reopens, disables and re-enables
within 48 hours hands its brand-new season the tail of somebody else's grace
(`reopenedAt-survives-disable-enable`).

The grace protects against re-closing. It does **not** protect the *cadence*.

**`reopen-extends-a-date-season-by-a-full-length`.** `index.ts:16957-16961` re-bases the
restored cadence through `rebaseCadence` (`:15405-15446`) — the function written for opening
the *next* season:

```ts
cadence: rebaseCadence(
  (archive.get('originalTarget') ?? seasons?.cadence) as never,
  archNum(archive.get('startsAt')),
  Date.now(),
),
```

For `type: 'rounds'` this is a pass-through and is right. For `type: 'date'` it computes
`months`, then sets `endsAt = addMonthsClampedServer(now, months)`, `startsOn = todayIn(now)`,
`endsOn = seasonEndDate(startsOn, months)`. A six-month season closed on its end date and
undone the next morning is given six more months *from today* — twelve months in total — and
its `startsOn` is moved to today while `startedAt` is restored to the original start from the
archive. The season then reports a start six months ago and a calendar window that begins
today. The comment at `:16955-16956` says the re-base exists "so it is not immediately due
again on a date cadence", which is true and is also a much larger intervention than the
48-hour grace it duplicates.

### The window where the club is double-counted

**`club-seasons-block-written-only-after-the-restore-succeeds`.** The order is: run
`reopenSeason` to completion — including `summaryRef.delete()` as its final act
(`seasonRollover.ts:1252`) — and only then `ref.set({ seasons: {...} })` (`index.ts:16896`).
There is no transaction spanning the two, and no compensating write.

If the invocation dies in between (the callable's ceiling is `timeoutSeconds: 300`, and the
work is one transaction per player plus one per pair plus a batched title delete plus a
collection scan), the club is left in a state that cannot be repaired by the same button:

* every player row and the club totals hold the reopened season's numbers **added on top of**
  the successor's, and are stamped `seasonReopened: s{n}`;
* `seasonSummary/…__s{n}` and `seasonCards/…__s{n}` are gone, so nothing can say what was
  added;
* the club block still says `currentId: s{n+1}`, `count: n`;
* a retry throws `not-found 'no archive for the last season'` at `index.ts:16889`, because the
  archive it needs to read is the one just deleted;
* even if the archive were restored by hand, every row's `seasonReopened` guard would return
  early.

The failure is silent, permanent, and doubles the club's whole table. Reversing the two —
lifecycle first, archive delete last — would make the operation resumable, which is the
property the close's own `create()`-then-wipe ordering was built around
(`seasonRollover.ts:1-16`).

### One more thing the re-close does not do

`reclose-after-undo-notifies-nobody`. `announceSeasonClosed` routes through
`createNotificationOnce`, whose doc id is `dedupeKey + '__b' + floor(now / cooldown)` and whose
cooldown for `seasonSummary` is **seven days** (`functions/src/notificationDedup.ts:95`). The
write is a `create()`, and `AlreadyExists` is swallowed. The undo deletes the archive but not
the notification documents, so closing the same season again inside the same seven-day bucket
collides on every id and reaches nobody. The toast still says "עונה N הסתיימה ונשמרה בארכיון"
("season N has ended and was saved to the archive"), which is true, and the admin has no way
to learn that the one push the whole feature builds towards was suppressed.
