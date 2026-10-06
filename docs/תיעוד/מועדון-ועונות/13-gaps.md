## The parts nothing else owns

Eleven sections describe what a season *does* with its numbers. This one describes where those
numbers come from, who is allowed to change them after the fact, and what happens to a season when
the evening underneath it is deleted, confirmed late, or corrected. All line numbers are `HEAD`
(`e35394a`). Production figures were read live on 2026-09-19 from `soccer-app-52b6b`, and the
scale numbers are: **195 `groups`**, **93 `communityPlayerStats` rows across 12 clubs**, **717
`communityPairStats`**, **95 games**, **1 `seasonSummary`**, **1 `seasonCards`**.

### First, the deployment state of record — because three sections have it wrong

Several findings in this document turn on "fixed at HEAD but not deployed". That is true of the
**client** and false of the **backend**, and the distinction decides whether two P1s are armed in
production or already defused.

```
$ git log -6 --date=iso-local            (TZ=UTC)
e35394a 2026-09-18 18:40:48 +0000  The last six labels that still called a משחקון a משחק
e89b926 2026-09-18 18:19:49 +0000  1.1.10 — and the date range that was never actually fixed
8235851 2026-09-18 18:14:22 +0000  Round 4: the blast radius…
5531a21 2026-09-18 16:02:12 +0000  Seasons: the rest of the audit…
bc6a562 2026-09-18 14:03:26 +0000  Seasons: the numbers people actually read
ae2c042 2026-09-18 13:53:12 +0000  Seasons: the six defects that made the feature unusable

$ git diff --stat 8235851 HEAD -- functions/
(no output)

$ gcloud functions describe <fn> --format='value(updateTime)'
cronEvery60Min        2026-09-18T18:16:57Z      enableClubSeasons    2026-09-18T18:16:55Z
onGameRosterChanged   2026-09-18T18:16:55Z      reopenLastSeason     2026-09-18T18:16:55Z
onNotificationCreated 2026-09-18T18:16:54Z      endSeasonNow         2026-09-18T18:16:53Z
commitRoundStats      2026-09-18T18:16:54Z      updateSeasonTarget   2026-09-18T18:16:53Z
```

`functions/` has not changed since `8235851`, and every seasons function was redeployed 2½ minutes
after it. **The seasons backend running in production is HEAD's `functions/src`**, compiled by
`firebase.json`'s `tsc` predeploy (which is also why ROUND4 §17 — the stale committed
`functions/lib/` — is a repository-hygiene problem and not a production one). The two functions
still showing an older `updateTime` are `disableClubSeasons` (16:04:36Z) and `addRetroGoal`
(13:55:33Z), neither of which changed in the later commits; Firebase skips unchanged functions.

The same is verifiable one layer up. The deployed Firestore ruleset — release `cloud.firestore`,
ruleset `70cde240-0d57-4070-a311-9b1df55a1598`, `updateTime 2026-09-18T18:14:42Z` — is 111,810
bytes and `diff`s **identical** to `firestore.rules` at HEAD, including the participant clause's
`games > 0 || rounds > 0`. (The Rules API's 403 is a missing quota project, not a permission
denial: add `-H "x-goog-user-project: soccer-app-52b6b"`.)

Three consequences, all of which correct statements elsewhere in this document:

* The `resuming &&` guard on the close's wind-back skip (`seasonRollover.ts:973`, landed in
  `8235851`) **is deployed**. The next close of `s2` will therefore wind the 21 real pair rows
  back correctly despite their stale `seasonWoundBack: 's2'` stamps. The *data* is still anomalous;
  the *defect* (`pair-wipe-skipped-on-next-close-after-reopen`, ROUND4 §9) is closed in production.
* Guest-pair deletion during the wipe (`seasonRollover.ts:944-948`, landed in `5531a21`) **is
  deployed**. The 293 guest documents survive only because no close has run since.
* The reopen's stale-stamp sweep (`seasonRollover.ts:1175-1190`, landed in `ae2c042`) **is
  deployed**, and would have cleared those stamps had the reopen happened after 18:16Z rather than
  at 10:37Z.

What is *not* deployed is the client: both 1.1.9 store artefacts were built from `4de80d0`
(18-09 05:54Z), and `e89b926` + `e35394a` — the date-range fix and the last label pass — are not
even in a build. Everywhere below, "shipped" means the phone and "deployed" means the server, and
they are eleven commits apart in opposite directions.

### The two functions that write every counter a season archives

`closeSeason` does not compute anything. It copies `communityPlayerStats`, `communityStats` and
`communityPairStats` into a document and subtracts them back out. Everything a season *is* was
written earlier by two functions, and no other section names either of them.

**`commitRoundStats`** — `functions/src/index.ts:13800`, a callable, one invocation per **משחקון**
(mini-game) committed from the advanced live screen. It is the sole writer of fifteen of the
nineteen `PLAYER_SEASON_FIELDS` and of all seven `CLUB_SEASON_FIELDS`:

| target | fields | line |
|---|---|---|
| `communityPlayerStats/{g}__{uid}` | `goals`, `assists`, `ownGoals` | 14141– |
| | `rounds`, `cleanSheets`, **`csRounds`, `asRounds`** | 14337, 14356-14357 |
| | `wins` / `losses` / `ties` | 14440– |
| | `penTaken/penScored/penMissed/penFaced/penSaved/penConceded` | 14200– |
| `communityStats/{g}` | `rounds`, `goals`, `guestGoals`, `ownGoals`, `tiedRounds`, `shootoutRounds`, `scorelessRounds` | 14162-14189 |
| `communityPairStats/{g}__{a}__{b}` | **`assists` only** | 14474 |

`CLUB_SEASON_FIELDS` is that list at 14166-14186, field for field, in order. The archive's `totals`
map is a transcript of one `sb.bump` call.

Note the coverage denominators ride the *same* write as the metric they divide, at zero extra
Firestore operations — which is why they exist at all, and why their absence on an old row is
information rather than an omission:

```ts
// functions/src/index.ts:14337-14358 — one bump per on-field player per mini-game
sb.bump(cpsRef(uid), { groupId, userId: uid, updatedAt: now }, {
  rounds: 1,
  ...(clean ? { cleanSheets: 1 } : {}),
  csRounds: 1,
  asRounds: 1,
});
```

**`rollUpClubPairs`** — `functions/src/index.ts:4695-4788`, and this is the one that surprises.
`commitRoundStats` writes exactly **one** of the ten `PAIR_SEASON_FIELDS`. The other nine —
`sameTeam`, `winsTogether`, `lossesTogether`, `cleanSheetsTogether`, `against`, `winsA`, `winsB`,
`assistsAToB`, `assistsBToA` — are written once **per evening**, after the evening is credited, by
a separate rollup that re-reads the mini-games from a subcollection:

```ts
// index.ts:6466-6496, inside the creditedNow block of onGameRosterChanged
const rhSnap2 = await db.collection('games').doc(gameId).collection('roundHistory').get();
const rounds2: ChemistryRound[] = rhSnap2.docs.map(...);
await rollUpClubPairs({ gameId, groupId: gid, at: after.startsAt, rounds: rounds2 });
```

`rollUpClubPairs` is latched by `communityPairRollups/{groupId}__{gameId}` (`:4710-4716`), chunks
its writes at 450 ops, and computes the pair totals with `pairsFromRounds`
(`functions/src/clubChemistry.ts:95-146`) — collapsing the whole evening in memory first, because
writing pairs per mini-game adds n² operations to a batch already near Firestore's 500 ceiling,
*and the idempotency latch is inside that batch*, so an overflow would lose the round's statistics
permanently. It also stamps `communityStats.chemistrySince` the first time it runs (`:4772-4777`).

Two consequences the other sections observe as symptoms without naming the cause.

**Guests.** `pairsFromRounds` treats a guest as a full participant — its comment says so: *"they
were on the pitch, the pass was real… they simply have no account, which matters for titles, not
for what happened."* `closeSeason` then drops every guest pair (`isReal`, `seasonRollover.ts:31`,
`:436`). So the collection that grows without bound and the collection the archive keeps are
governed by two deliberate and *opposite* decisions, taken in two files, neither of which cites the
other. 293 of the live club's 314 pair documents are the result.

**The assist gap.** Section 09 reports that the archive's directional pair assists sum to 7 against
`totals.assists: 13`, and calls the cause unexplained. It is the two writers' two windows. I read
every `roundHistory` document of all 23 surviving games of `HhzIwmjMl1i5HSOGHt3p` and counted the
goals that carry both a scorer and a different assister and are not own goals:

```
roundHistory documents across the 23 games : 31
committedRounds latch documents            : 35
communityStats.rounds sealed into s1       : 37
assisted goals recoverable from roundHistory: 7   (0 of them involve a guest)
archive pairs, assistsAToB + assistsBToA   : 7    ← exact match
archive pairs, legacy undirected `assists` : 8
archive players[].assists  /  totals.assists: 13 / 13
```

Four mini-games were committed with no `roundHistory` document at all — three on
`WhqMQzLznMgP` (28.06) and one on `5EQKVHge5mtP` (29.06), the club's two oldest evenings, which
predate the subcollection — and two more belong to games that have since been deleted (below). The
pair rollup can only see what `roundHistory` holds, so those mini-games contributed **no chemistry
at all**: no `sameTeam`, no `against`, no directional assist. The legacy `assists` is 8 rather than
7 because `commitRoundStats` writes it at commit time from the payload in hand, so it saw one
mini-game the rollup did not. Three numbers, three windows, one Hebrew word.

**Nothing in the repository reconciles `communityStats.rounds` (37) against the `committedRounds`
latches (35) or `roundHistory` (31).** `totals.rounds: 37` is the number `he.seasonHistoryLine`
prints as "37 משחקונים" on a permanent card.

### `games` is credited without asking which season it is

The nineteenth `PLAYER_SEASON_FIELD`, and the only one every club records, is written somewhere
else again — in `onGameRosterChanged`, on the `didEveningHappen` false→true transition
(`index.ts:5868-5919`):

```ts
const wasHappened = didEveningHappen(before);
const isHappened  = didEveningHappen(after);
if (!wasHappened && isHappened && after.groupId && after.players?.length) {
  for (const uid of after.players) {
    if (arrivals[uid] === 'no_show') continue;
    batch.set(db.collection('communityPlayerStats').doc(`${gid}__${uid}`),
      { groupId: gid, userId: uid, games: increment(1), updatedAt: Date.now() }, { merge: true });
  }
  batch.create(db.doc(`games/${gameId}/finishCredited/once`), { at: Date.now() });
}
```

Three things follow, and the third is not written down anywhere.

1. **The `finishCredited/once` marker is the audit trail for section 08's 22-vs-19.** I probed it on
   all 23 games: **19 exist.** The four without one are `2SMrlCGH` (06.07), `MMtE8J6H` (16.07),
   `FCa5UtSd` (04.08) — the three `happened` evenings that never advanced past
   `liveMatch.phase: 'organizing'` — and `DTNscolR` (17.09), which is `notHappened`. 22 happened
   evenings minus 3 uncredited = the 19 in the archive, exactly.
2. No-shows are excluded here, and the client scan excludes them too
   (`gameService.ts:1206-1210`), so the two do **not** diverge on that axis. The whole of the
   3-evening gap is the missing marker.
3. **There is no season check.** The `mine` test (`index.ts:5092-5106`) gates
   `seasons.playedRounds` and `roundSummaries.seasonEvenings`; it does not gate this. An evening
   whose stamp names an archived season, or an orphan season, still adds `games: +1` to the
   *running* season's live rows. `games/DTNscolRojYDf0ZmT0sF` is stamped `s3` on a club that has
   only ever had `s1` and `s2`, is `playVerified: false`, and has no `finishCredited` marker — so
   it is one admin tap away from crediting seven attendances into season 2's live table while
   season 2's own progress counter (`playedRounds`, currently `0`) refuses to move and no season's
   archive will ever contain the night.

### `setEveningPlayed` — how an evening joins a season days later

`index.ts:13704-13790`. Admin-only (`adminIds`, not the creator), and the read and write are in one
transaction because two admins can be looking at the same screen and a "no" is unrecoverable.

```ts
const correctingAMistap = state === 'notHappened' && cur.playVerified === false && played;
if (state !== 'unverified' && !correctingAMistap) return { changed: false, state };
tx.update(ref, { playVerified: played, playVerifiedBy: uid, playVerifiedAt: Date.now(), … });
```

The transition is a plain field write with **no status change**, which is precisely why the credit
block above keys on `didEveningHappen` rather than on status. It is also why the season *stamp*
cannot be written by it: the stamp's gate is `before.status !== after.status`
(`index.ts:5802-5810`), so a late-confirmed evening that was never stamped stays unstamped for
ever and is filed under season 1 by every reader. On a club past season 1 that is an evening
credited to the live table and attributed to a sealed archive. ROUND4 §15 covers what the *seal*
then computes from today's totals; the seasons half of it is untested and unnamed.

### The fourth copy of the season-membership rule

`inSeason` (client) and `eveningInSeason` (server) are documented as the rule. There is a third
copy, and it is the only place in the product where `game.seasonId` *refuses* an action:

```ts
// functions/src/index.ts:14924-14937, loadRetroGameContext — shared by addRetroGoal + removeRetroGoal
const gameSeason = typeof game.seasonId === 'string' ? game.seasonId : '';
const seasons = grp.seasons as { enabled?: boolean; currentId?: string; currentNo?: number } | undefined;
if (seasons?.enabled) {
  const belongsTo = gameSeason || (seasons.currentNo === 1 ? seasons.currentId ?? '' : 's1');
  if (belongsTo !== seasons.currentId) {
    throw new HttpsError('failed-precondition',
      'closedSeasonGame: this evening belongs to a season that has already closed');
  }
}
```

Retro goals write straight into `communityPlayerStats.goals/assists`, `communityStats.goals` and
`users.stats` (`index.ts:14985-15015`) with no round attached, so correcting a June goal after a
close would credit it to the running season while the sealed archive stayed wrong — and
`removeRetroGoal` would decrement a counter the close has already set to zero, since Firestore's
`increment` goes negative happily. The guard is right to exist. Three things about it:

* It spells the unstamped→season-1 rule a **fourth** way, by hard-coding the literal `'s1'` rather
  than comparing season numbers. It happens to agree with the other three because ids are always
  `s${no}`, but nothing pins that.
* It is inert when `seasons.enabled` is false, so a club that switched seasons off can still
  retro-credit goals into a table a close zeroed.
* Its admin gate is `game.createdBy === uid || adminIds.includes(uid)` (`:14899`), which is
  **wider** than every seasons callable's `requireClubAdmin` (`index.ts:15710-15721`, `adminIds`
  only). A non-admin who created the game can move the club's season counters.
* `closedSeasonGame` is mapped by `seasonRefusalText` (`seasonService.ts:119`) to
  `he.seasonBlockedClosedGame`, but it is thrown from a **match** screen, not a seasons screen —
  `RetroGoalsSheet.tsx:47` has its own copy of the substring test.

Production: `games/fnBXPo76yOlm` (14.07.2026) carries one `retroGoals` document. That evening is
unstamped, so `belongsTo` is `'s1'` and `currentId` is `'s2'` — **an admin can no longer remove
that retro goal**, and the counter it added was archived into s1 and then wound back out of the
live table. `games/DTNscolRoj`, stamped `s3`, is refused for ever by construction.

One correction this forces on section 07. That section states that for a timer-only club "eight of
the nine titles are decided on fields that are permanently zero, and only `mostLoyal` can ever be
awarded", and calls the Hebrew comment's figure of three wrong. `addRetroGoal` writes `goals` and
`assists` onto `communityPlayerStats` **without** writing `rounds`, so a club that never opens the
advanced screen can still accumulate season goals and assists and can award `topScorer` and
`topAssister`. Three is the right number; one is not.

### Deleting an evening

`onGameRosterChanged`'s deletion branch (`index.ts:5355-5428`) writes a `gameDeletions/{gameId}`
audit row and fans out a cancellation push. It touches **no** counter: not
`clubRecords.eveningsSealed`, not `seasons.playedRounds`, not `communityPlayerStats`, not
`communityStats`, not `communityPairStats`. Section 03 states this in the abstract. It has happened
four times on the one club that runs seasons:

| doc | `deletedAt` (UTC) | `rosterCount` | `source` |
|---|---|---|---|
| `QKMcTm2oa0BpD8z5bNMj` | 2026-08-04 10:58:29 | 7 | manual |
| `HVJ1QfFk3SWN4TyaGMjF` | 2026-09-02 06:35:26 | 6 | manual |
| `oi6Iz1F308lkbHrv56vy` | 2026-09-15 06:53:00 | 0 | manual |
| `Iyj4md7E46cbeYL8v61T` | **2026-09-17 15:13:42** | 6 | manual |

All four by the same admin (`YIZlKWBvvjae3oqgIoAMr9nzQEi1`, Eliran Tzabari). The last one was
deleted **59 minutes before season 1 closed** at 16:12:06Z. Whatever that evening contributed to
`communityStats.rounds`, `communityStats.goals` and every player's row was still there at 16:12 and
was sealed into a write-once archive; the client's games scan lost it the moment the document
went. This is the mechanism behind two numbers section 03 calls coincidental: the counters and the
scan on this club drift *both* ways at once — the counters are blind to twelve evenings before
26.08, and the scan is blind to four deletions.

`promoteOrphanToGroup` is the one other path that destroys seasons inputs. Its artefact purge
(`index.ts:9322-9358`) deletes every `communityPairStats` row, every `eveningStandings` row, every
`roundSummaries` and `communityPairRollups` marker, and **`clubRecords/{groupId}`** — the document
holding `eveningsSealed`, which is the zero mark every `roundsAtStart` is measured from. It does
not touch `seasonSummary`, `seasonCards`, `users/*/seasonTitles` or `groups.seasons`. A personal
group cannot hold a seasons block today (`firestore.rules:334-341`), so the combination is
unreachable; it is one rule change away from a club whose archives outlive the counter they were
measured against.

### The season picker

`src/utils/seasonChoices.ts` — 52 lines, pure, and the only thing that decides which seasons a
person is offered on `SeasonSummaryScreen` and whether `SeasonsCard` draws its history button.

```ts
const MAX_SEASON_CHOICES = 200;
export function seasonChoices(seasons: GroupSeasons): SeasonChoice[] {
  const out = [{ no: seasons.currentNo, id: seasons.currentId, closed: false }];
  const closed = Math.max(0, Math.min(MAX_SEASON_CHOICES, seasons.count ?? 0));
  for (let no = closed; no >= 1; no -= 1) {
    if (no === seasons.currentNo) continue;   // disable/re-enable keeps numbering
    out.push({ no, id: `s${no}`, closed: true });
  }
  return out;
}
```

It derives ids from `count` alone and never reads an archive, so **the picker asserts that
`seasonSummary/{g}__s{n}` exists for every `n ≤ count`**. That assertion is exactly what a reopen
breaks in the other direction: the reopen decrements `count` (`index.ts:16962`), so the discarded
successor disappears from the list with no trace, which is correct — but nothing removes a chip for
an archive that was deleted by hand or never written. `CommunityStatsScreen` handles the miss by
bailing the whole scope back to `{k:'current'}` (`:316`); `SeasonSummaryScreen` handles it by
silently rendering the **running** season under the closed season's heading
(`seasonSummaryService.ts:429-456`). Two screens, two different answers to one missing document.

`lastClosedSeason` (`:48-52`) is `seasonChoices(...).find(c => c.closed)`, with a first-line guard
that returns `null` for a club that has neither `enabled` nor a `count`. It is what gates the
"סיכום עונה N שלי" button.

### Observability: eight events, and the three that do not exist

| event | where | payload |
|---|---|---|
| `SeasonsEnabled` | `SeasonsSettings.tsx:502` | `groupId, cadence, target, sealedHistory` |
| `SeasonsDisabled` | `:479` | `groupId` |
| `SeasonTargetChanged` | `:516` | `groupId, cadence, target` |
| `SeasonReopened` | `:557` | `groupId, seasonNo` |
| `SeasonEndedEarly` | `:612` | `groupId, seasonNo` |
| `SeasonHistoryViewed` | `SeasonHistoryScreen.tsx:319` | `groupId, seasons` |
| `SeasonSummaryViewed` | `SeasonSummaryScreen.tsx:308` | — |
| `SeasonSummaryShared` | `:349` | — |

Every one is client-side and every one is an **admin action or a screen open**. There is no event
for a season closing by the hourly sweep, none for a close-on-seal, none for the summary push. The
two mechanisms that close seasons without a human — the two that also destroy data — emit nothing
to analytics, log to `console.log`, and (per section 11) have never written a row to the `errors`
collection. The only durable record that an automatic close happened is the archive it creates.

### The mock layer, and why QA cannot see the common club

`USE_MOCK_DATA` short-circuits all three seasons services:
`seasonService` returns success without calling anything (`:234-266`), `seasonHistoryService`
returns `mockHistory()` / `mockTable()` (`:151-233`), `seasonSummaryService` returns
`mockSeasonSummary()` (`:549-`).

Every mock player in every one of the three builders has `rounds > 0` — 22, 24, 20, 12 on the
closed season; 41, 44, 38, 30 on the running one — and every mock pair has non-zero `sameTeam` and
directional assists. **The timer-only club is unreachable in mock mode.** That is the club the
product notes call common; it is the club for which `rank-denominator-of-excludes-attendees`,
`share-card-is-all-zeros-for-a-timer-only-club`, `seasonsummary-participant-rounds-only` and
`season-push-body-promises-three-things-a-timer-club-has-none-of` were all written. Mock QA cannot
reproduce any of them.

The mock is also the **only** place two archive fields are ever exercised:
`mockHistory()` sets `partialData: true` (`seasonHistoryService.ts:161`), and no production archive
carries the field at all, so the "נתונים חלקיים" chip has only ever rendered against a fixture.
`mockTable()` deliberately includes one uid that is *not* in the mock roster
(`'u_left_the_club'`, `:224`) to exercise the frozen-name path — a good instinct that the real
fixture (`tests/fixtures/realClub.ts`) does not copy.

### Three small things with no owner

**`src/utils/seasonTitleIcon.ts`** (51 lines) holds `SEASON_TITLE_ICON` and `SEASON_TITLE_TINT`,
total `Record<SeasonTitleKey, …>` maps so a tenth title is a compile error. The tints are declared
usable **only on a disc, never as text colour, where they fail contrast** — a constraint nothing
enforces. It is the fourth total record keyed on `SeasonTitleKey`, after `SCALE`
(`seasonMedalTier.ts:57`), `TITLE` (`he.ts:34`) and `SEASON_TITLE_KEYS` itself.

**`parseSeasonTable` does not read `completedRounds`.** `FinishedSeasonTable`
(`seasonArchive.ts:35-48`) has seven totals, a players array, a duo and a names map — and no
season length, no `no`, no `awards`, no `endsAt`. So the archive has two client readers with two
disjoint field sets: `seasonHistoryService.table` → `parseSeasonTable` for the stats table, and
`seasonHistoryService.list` → `fromCard` over `seasonCards` for everything else. A screen that
wants the length of a closed season must read the **card**, never the archive it is looking at.

**`he.seasonRangeUntil`** ("מתחילת המועדון עד X" — "from the club's beginning until X") is now
reachable only when `startsAt === 0`, which only the `sealNow` activation branch produces
(`index.ts:16478`). No production season has it. ROUND4 §19 is closed; the string is now dead code
for every club that carried its history rather than sealing it.
