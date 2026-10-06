## The data model

Every line number in this section is against commit `e35394a` (2026-09-18 21:40 +0300), which is
`HEAD` of branch `perf/firestore-read-costs`. Production numbers were read live from project
`soccer-app-52b6b` on 2026-09-19.

### Scale, first, because it changes how you read everything else

| Collection | Documents in production |
|---|---|
| `groups` | 194 |
| `groups` with a `seasons` block at all | **2** |
| `groups` with `seasons.enabled == true` | **1** (`HhzIwmjMl1i5HSOGHt3p`, מועדון שכחת שושי, "Shoshi's Forgetting Club") |
| `seasonSummary` | **1** (`HhzIwmjMl1i5HSOGHt3p__s1`) |
| `seasonCards` | **1** (same season) |
| `roundSummaries` for that club | 10, against 23 finished games |
| `communityPairStats` for that club | 314, of which 293 are guest pairs |

There is exactly one archived season in the entire database. Every "worked example" below is that
season, because there is no other. The feature has never run anywhere else, which is why so many
defects survived to production: the code paths that only fire on season 2, 3 and 4 have literally
never executed on real data.

### `groups/{groupId}.seasons` — the only mutable lifecycle record

This sub-map is the whole state machine. It is the only seasons data a client may read cheaply, and
it is the only seasons data the client may not write: the rules lock the field, and every mutation
goes through one of five callables (`enableClubSeasons`, `disableClubSeasons`, `updateSeasonTarget`,
`endSeasonNow`, `reopenLastSeason`) or two server paths (`performSeasonClose` at
`functions/src/index.ts:15884-15925`, and the per-seal increment at `functions/src/index.ts:5219-5232`).

The declared type is `GroupSeasons`, `src/types/index.ts:959-1000`:

```ts
export interface GroupSeasons {
  enabled: boolean;
  currentNo: number;
  currentId: string;
  startedAt: number;
  roundsAtStart?: number;
  playedRounds?: number;
  cadence: {
    type: SeasonCadenceType;   // 'date' | 'rounds'
    months?: number;
    endsAt?: number;
    startsOn?: string;         // 'YYYY-MM-DD', club calendar
    endsOn?: string;           // 'YYYY-MM-DD', LAST valid day
    targetRounds?: number;     // TOTAL finished evenings, not a remainder
  };
  targetHistory?: SeasonTargetChange[];
  count: number;
}
```

The live production document:

```json
{
  "enabled": true,
  "currentNo": 2,
  "currentId": "s2",
  "startedAt": 1789679141952,          // 2026-09-17 21:05:41Z
  "roundsAtStart": 10,
  "playedRounds": 0,
  "reopenedAt": 1789727847680,         // 2026-09-18 10:37:27Z
  "count": 1,
  "cadence": { "type": "rounds", "targetRounds": 24,
               "months": null, "endsAt": null, "endsOn": null, "startsOn": null },
  "targetHistory": [ { "at": 1789727874911, "by": "YIZlKWBvvjae3oqgIoAMr9nzQEi1",
                       "byName": "Eliran Tzabari",
                       "from": { "type": "rounds", "targetRounds": 2,  … },
                       "to":   { "type": "rounds", "targetRounds": 24, … } } ]
}
```

Field by field:

| Field | Type | Written by | Read by | Absent means | Absent ≠ 0? |
|---|---|---|---|---|---|
| `enabled` | bool | all five callables | everything; the sweep's query is `where('seasons.enabled','==',true)` (`index.ts:16078`) | feature off | n/a |
| `currentNo` | int, 1-based | enable / close / reopen | id derivation, `eveningInSeason` fallback | treated as 1 by the reader | no |
| `currentId` | string `s{N}` | same | the stamp written onto games; the scope filter; the archive doc id | **the client reader returns `undefined` for the whole block** (`firestore.ts:671`) | n/a |
| `startedAt` | epoch ms | close (`now`), enable (`now`), reopen (archive's `startsAt`) | hall-of-fame date range, `rebaseCadence` | 0 | no |
| `roundsAtStart` | int | `seasonSeed()` = `clubRecords.eveningsSealed` at open | `completedRoundsFrom` fallback; `roundSummaries.seasonEvenings` | 0 | no |
| `playedRounds` | int | seeded at open, then `FieldValue.increment(1)` per seal | the card, the sweep, `endSeasonNow`, the running personal summary | falls back to `eveningsSealed − roundsAtStart` | **yes** — `completedRoundsFrom` (`seasonCounters.ts:110`) tests `typeof playedRounds === 'number'`, so 0 is honoured and absent is not |
| `cadence.type` | `'date' \| 'rounds'` | enable / retarget / `rebaseCadence` | `seasonFinishLine` | **client reader defaults to `'date'`** (`firestore.ts:695`) | no |
| `cadence.months` | int | enable (length) / retarget (remaining) | `rebaseCadence` | no length recorded | no |
| `cadence.endsAt` | epoch ms | legacy date seasons | `seasonFinishLine` kind `'epoch'` | prefer `endsOn` | yes (null vs absent both falsy) |
| `cadence.startsOn` / `endsOn` | `YYYY-MM-DD` | date cadence | `seasonFinishLine` kind `'date'`, DST-safe | no calendar boundary | yes |
| `cadence.targetRounds` | int | enable / retarget | `seasonFinishLine` kind `'rounds'` | `{kind:'none'}` → **a season that can never end** | yes |
| `targetHistory` | array | `updateSeasonTarget` via `arrayUnion`; reset to `[]` by every open | nothing on any screen | never moved | `[]` and absent are indistinguishable |
| `count` | int | `+1` on close, `−1` on reopen | which season the undo button targets; whether enable seeds history | 0 | no |

Three further fields are written by the server and **do not exist in the TypeScript type, are not
named by the client deserializer, and therefore do not exist on any client**:

* `reopenedAt: number` — stamped by `reopenLastSeason` (`index.ts:16905`), zeroed by every other
  opener. Grants a 48-hour immunity from re-closing (`REOPEN_GRACE_MS`, checked at `index.ts:15979`
  and `index.ts:16179`). The live club carries `reopenedAt = 2026-09-18 10:37Z` right now.
* `targetMovedToClose: {at,by,byName}` — set by `updateSeasonTarget` when the new target is already
  behind the club (`index.ts:16815`), read by `performSeasonClose` to stamp `endedEarly`.
* `dueBlockedSince: number` — set when a season came due and could not be closed
  (`index.ts:16206`), deleted when it finally is.
* `seasonStampRetry` is the same class of problem one collection over (see games, below).

`src/firebase/firestore.ts:667-714` rebuilds the block field by field, so **a field the reader does
not name does not exist on the client, whatever Firestore holds.** This is a recurring failure mode
in this codebase, and `targetHistory` was its most recent victim: the server wrote it on every
change, the type documented it as "kept and shown… never quietly", and the reader dropped it. The
reader was fixed; nothing renders it even now (ledger `target-history-never-shown-to-anyone`).

`SeasonTargetChange` (`src/types/index.ts:1005-1013`) is also already behind its writer. The writer
at `index.ts:16802-16812` adds two more fields per entry:

```ts
targetHistory: admin.firestore.FieldValue.arrayUnion({
  at: now, by: uid, byName,
  from: seasons.cadence ?? null,
  to: next,
  playedAtMove: played,     // not in the type
  endsTheSeason,            // not in the type
}),
```

and no entry carries a `seasonId`. That omission is what allows ledger finding
`reopen-inherits-the-successor-seasons-target-history`: an array element cannot say which season it
belongs to, so a reopen that restores the wrong array cannot be detected.

### `games/{gameId}.seasonId` — the membership stamp

One optional string field on the game document. Written once by `onGameRosterChanged`
(`functions/src/index.ts:5802-5836`) on the `→ active` or `→ finished` transition, guarded by
`!after.seasonId` so it is effectively write-once. A failed group read writes
`seasonStampRetry: true` (`index.ts:5842`) so the next write to the game tries again.

The rule that reads it exists in two copies that are deliberately identical —
`src/utils/seasonScope.ts:28` (client) and `functions/src/seasonCounters.ts:53` (server):

```ts
export function eveningInSeason(game, seasonId, seasonNo): boolean {
  const stamp = typeof game.seasonId === 'string' ? game.seasonId : '';
  return stamp ? stamp === seasonId : seasonNo === 1;
}
```

**Absence is load-bearing and means "season 1".** That is the whole of "your history becomes season
1". It is also, structurally, a one-shot promise: it can only ever be told once per club, and it is
wrong for any club that disables and re-enables the feature.

Every finished game of the only club that runs seasons:

| Evenings | `seasonId` |
|---|---|
| 19 evenings, 2026-06-28 → 2026-09-15 | *absent* → resolved to season 1 |
| 3 evenings, 2026-09-16 → 2026-09-17 | `"s1"` |
| 1 evening, 2026-09-17 21:23 (`DTNscolR…`) | `"s3"` |
| any | `"s2"` — **none** |

The last row is a dead stamp. Season 3 was opened when season 2 closed at 21:12Z, the game was
stamped `s3` eleven minutes later, and then season 2 was reopened on 2026-09-18, which decrements
`count` and deletes s2's archive — so `s3` now names a season that does not exist and will not exist
again until the club closes s2. `eveningInSeason(game,'s2',2)` is false (stamp present, mismatched),
so that evening belongs to **no** season on either side of the wire: it is in no archive, in no live
scope, and `seasons.playedRounds` is 0 despite it having been played inside s2's window. The stamp
is write-once, finished games are client-read-only, and the trigger only fires on a status
transition a finished game has no more of — so there is no repair path. Ledger:
`undo-close-orphans-the-season-stamps`, `orphan-season-stamp-absorbed-by-the-next-season-of-the-same-id`.

`seasonId` appears **nowhere in `firestore.rules`** (verified by grep: the only two hits are comment
lines 2097 and 2111, both about other collections). A club member may therefore create a game
pre-stamped with any season id, and the server's write-once check then refuses to correct it
(ledger `games-seasonid-unpinned`, emulator-proven with four successful writes).

### The three live tables a close winds back

These are the club's running counters. They are not seasons documents — they predate the feature —
but a season close subtracts its archive out of them and a reopen adds it back, so their exact field
sets are part of the seasons contract. The lists are pinned in one place,
`functions/src/seasonRollover.ts:184-244`:

```ts
const PLAYER_SEASON_FIELDS = [
  'goals','assists','rounds','wins','losses','ties','games','cleanSheets','ownGoals',
  'penTaken','penScored','penMissed','penFaced','penSaved','penConceded',
  'csRounds','asRounds',             // coverage denominators
  'eveningScoreSum','eveningScoreCount',
] as const;
const PAIR_SEASON_FIELDS = [
  'assists','sameTeam','winsTogether','lossesTogether','cleanSheetsTogether',
  'against','winsA','winsB','assistsAToB','assistsBToA',
] as const;
const CLUB_SEASON_FIELDS = [
  'rounds','goals','guestGoals','ownGoals','tiedRounds','shootoutRounds','scorelessRounds',
] as const;
```

Anything **not** on these lists survives a close: `bestEvening`, `lastEveningScore`,
`kingGoalsSum`/`kingGoalsCount` on player rows, `chemistrySince` and the `king*` accumulators on the
club row. The module comment at the top of `seasonRollover.ts` explains why — resetting
`kingGoalsSum` would make the first top scorer of every new season a perfect 10 by construction.

**`communityPlayerStats/{groupId}__{uid}`.** Doc id is the composite; `groupId` and `userId` are also
fields, because a `list` does not bind the path wildcard (`firestore.rules:2070`). It carries **no
display name** — that is why `closeSeason` issues a separate `getAll` over `/users`
(`seasonRollover.ts:317-333`) to freeze names into the archive. Three season stamps live here:

* `seasonWoundBack: string` — written by the close, cleared by the reopen. Makes the subtraction
  idempotent.
* `seasonReopened: string` — written by the reopen, deleted by the close. Makes the addition
  idempotent.
* Both are read-only signals; neither is in any client type.

The real row for מתן לוי (`1IdtNEjbEXfiRSqvLrJVn99NsfI2`) today, trimmed:

```json
{ "groupId": "HhzIwmjMl1i5HSOGHt3p", "userId": "1IdtNEjbEXfiRSqvLrJVn99NsfI2",
  "goals": 0, "assists": 0, "rounds": 0, "wins": 0, "losses": 0, "ties": 0, "games": 0,
  "cleanSheets": 0, "csRounds": 0, "asRounds": 0,
  "eveningScoreSum": 0, "eveningScoreCount": 0,
  "bestEvening": { "goals": 0, "assists": 0, "involvement": 0, "cleanSheets": 2, "wins": 2 },
  "lastEveningScore": 6,
  "seasonWoundBack": "s1",
  "updatedAt": 1789661526768 }
```

Every season-owned counter is zero. That is correct behaviour — the season was archived — and it is
also the single fact behind the owner's original complaint: the club screen scans games and says 22
evenings, and every screen that reads this row says 0 (ROUND4 §2, ledger
`evenings-22-on-one-screen-0-on-the-next`). Note the stamp still reads `s1` even though s2 has since
been closed and reopened; the s2 close skipped this row because a row with `rounds == 0 && games == 0`
is not archived as a participant (`seasonRollover.ts:345`).

**`communityPairStats/{groupId}__{a}__{b}`.** Live `a`/`b` are *not* sorted; the archive key is
`seasonPairKey()` (`seasonRollover.ts:104-110`) which sorts them and returns a `flip` flag so the
directional counters (`winsA`, `assistsAToB`) can be re-oriented. A live row today:

```json
{ "groupId": "HhzIwmjMl1i5HSOGHt3p",
  "a": "CEkRfDs20xSuiW6xmPKlMcx3NoV2", "b": "JoLFRxFr0tTaYfVAXBPwkvT0et62",
  "sameTeam": 0, "against": 0, "winsTogether": 0, "lossesTogether": 0,
  "cleanSheetsTogether": 0, "winsA": 0, "winsB": 0,
  "assists": 0, "assistsAToB": 0, "assistsBToA": 0,
  "seasonWoundBack": "s2", "updatedAt": 1789679528192 }
```

`seasonWoundBack: "s2"` while **s2 is the running season**. All 314 pair rows read this. The stamp
is the close's idempotency latch, so the next close of s2 will archive this pair's chemistry *and*
skip winding it back — sealing it into a write-once archive while leaving it standing live for s3 to
inherit, double-counted. The clearing sweep at `seasonRollover.ts:1174-1200` exists in `HEAD` but
ran after this reopen. Ledger: `stale-pair-woundback-stamp-skips-next-wipe`, ROUND4 §9. This is armed
in production today.

`assists` versus `assistsAToB`/`assistsBToA` is a real ambiguity, not a duplication: the legacy
undirected `assists` counts a **wider window** than the directional pair, so the two disagree. The
archive keeps both; the awards use directional only (`seasonRollover.ts:527`), the club chemistry
card uses legacy, and `seasonArchive.topDuo` (client) uses directional. On s1 they are 7 and 8.

**`communityStats/{groupId}`.** One doc per club, id = groupId, with `groupId` also as a field for the
same wildcard reason. Season-owned: the seven `CLUB_SEASON_FIELDS`. Not season-owned:
`kingGoalsSum/Count`, `kingAssistsSum/Count`, `chemistrySince`. The close **sets the seven to
absolute 0** (`seasonRollover.ts:1004-1021`) while the player and pair rows are *subtracted* — an
inconsistency the module's own header calls out as forbidden ("SUBTRACT, do not write zeroes") and
then violates fifty lines from the bottom. Ledger `club-totals-zeroed-not-subtracted`. Live:

```json
{ "groupId": "HhzIwmjMl1i5HSOGHt3p", "rounds": 0, "goals": 0, "guestGoals": 0, "ownGoals": 0,
  "tiedRounds": 0, "shootoutRounds": 0, "scorelessRounds": 0,
  "kingGoalsSum": 6, "kingGoalsCount": 5, "kingAssistsSum": 4, "kingAssistsCount": 3,
  "chemistrySince": 1789679528192, "seasonReopened": "s2", "updatedAt": 1789727846661 }
```

### `clubRecords/{groupId}` — `eveningsSealed`, and why nobody can read it

```
match /clubRecords/{groupId} { allow read, write: if false; }     // firestore.rules:1813
```

Server-only in **both** directions, by design: it is the baseline the evening summary measures
records against, and a second readable copy would become a drifting source of truth for "the best
evening ever". The consequence for seasons is concrete: the counter a rounds target is measured
against is unreadable by the app, which is the entire reason `groups.seasons.playedRounds` exists as
a client-readable mirror (`index.ts:5210-5232`).

```json
{ "groupId": "HhzIwmjMl1i5HSOGHt3p",
  "eveningsSealed": 10,
  "since": 1787739600000,                    // 2026-08-26 10:20Z
  "lastEveningAt": …, "updatedAt": 1789655711795,
  "goals": {"value":2,"userIds":[…]}, "assists": …, "wins": …, "cleanSheets": …, "involvement": …,
  "firstEverSeen": ["every_team_won","multiple_personal_records"] }
```

`eveningsSealed` is `FieldValue.increment(1)` per sealed evening (`index.ts:5194`), atomic
specifically because an absolute write lost evenings when three sealed within a minute. But **it
began on 2026-08-26**. The club has played 23 evenings and the counter says 10. Any arithmetic that
subtracts `roundsAtStart` from it — `completedRoundsFrom`'s fallback
(`functions/src/seasonCounters.ts:111-117`), `roundSummaries.seasonEvenings`
(`index.ts:5157`) — is answering for the era of the counter, not for the club. On this club that
fallback yields `10 − 7 = 3` for a season the card says held 22. That is the arithmetic that
`endSeasonNow` used to perform (two arguments instead of three) and would have sealed into a
write-once archive.

### `seasonSummary/{groupId}__{seasonId}` — the archive

Written exactly once, with `create()` (`seasonRollover.ts:584`), which is the feature's entire
idempotency story. Deleted only by `reopenSeason`. Two read statements in the rules
(`firestore.rules:2121-2164`): members list it by field; a **participant** — a uid that is a key in
the `players` map with `games > 0 || rounds > 0` — may `get` it for ever, even after leaving the
club.

Top-level shape:

| Field | Type | Present when | Read by |
|---|---|---|---|
| `groupId`, `seasonId`, `no` | string/int | always | everything |
| `groupName` | string | always (frozen) | personal summary, for readers who can no longer read `/groups` |
| `startsAt` | epoch | always | hall of fame date range; `reopenLastSeason` restores `seasons.startedAt` from it |
| `endsAt`, `closedAt` | epoch | always, both `= now` | display |
| `completedRounds` | int | always | the season's **length**. `reopenLastSeason` fallback; `seasonSummaryService.fromArchive` (`:382`) |
| `roundsAtStartOfSeason` | int | always | **server only** — `reopenLastSeason:16893` restores the offset |
| `zeroedAt` | epoch | only after the wipe finished | **server only** — distinguishes "already closed" from "resume a half-finished close" (`seasonRollover.ts:667`) |
| `endedEarly` | `true` | omitted unless set | `seasonHistoryService:89`, badge on the card |
| `partialData` | `true` | omitted unless set | `SeasonHistoryScreen:286`, the "נתונים חלקיים" (partial data) chip |
| `closedBy`, `closedByName` | string | manual close only | **nothing** — write-only, costs one extra `/users` read per close |
| `originalTarget` | cadence map | when the caller passed one | `reopenLastSeason:16955` re-bases the cadence from it |
| `targetHistory` | array | omitted when empty | **nothing** |
| `totals` | map | always | club table |
| `players` | map uid → row | always | everything |
| `pairs` | map `lo__hi` → row | always | duo title, personal summary peers |
| `awards` | map of 9 keys → `{winners:string[], value:number} \| null` | always | card, titles, personal summary |

The production document, trimmed:

```json
{ "groupId": "HhzIwmjMl1i5HSOGHt3p", "groupName": "מועדון שכחת שושי",
  "seasonId": "s1", "no": 1,
  "startsAt": 1789547794676,      // 2026-09-16 08:36:34Z
  "endsAt":   1789661526768,      // 2026-09-17 16:12:06Z
  "closedAt": 1789661526768,
  "zeroedAt": 1789661533425,
  "completedRounds": 22,
  "roundsAtStartOfSeason": 7,
  "originalTarget": { "type": "rounds", "targetRounds": 22 },
  "totals": { "rounds": 37, "goals": 27, "assists": 13, "cleanSheets": 75,
              "guestGoals": 4, "ownGoals": 0, "tiedRounds": 9,
              "shootoutRounds": 6, "scorelessRounds": 16 },
  "awards": { "topScorer": {"winners":["alsobLSA…"],"value":10},
              "topAssister": {"winners":["K5rSGB4J…"],"value":5},
              "mvp": {"winners":[ … all seven uids … ],"value":6},
              "topWinner": {"winners":["B5KpYO4I…"],"value":13},
              "mostLoyal": {"winners":["1IdtNEjb…"],"value":19},
              "cleanSheetKing": {"winners":["alsobLSA…"],"value":13},
              "penaltyKing": {"winners":["alsobLSA…"],"value":1},
              "penaltyKeeper": {"winners":["alsobLSA…"],"value":1},
              "deadlyDuo": null } }
```

Read that document against the club's own history and three things are visibly wrong:

1. **`startsAt` is the moment the admin switched the feature on**, not the season's first evening.
   The season contains 22 evenings from 2026-06-28; the archive says it began on 2026-09-16 and ended
   on 2026-09-17. `endsAt − startsAt` is 31.6 hours. The hall of fame renders this as
   "ספט׳ 2026 – ספט׳ 2026" ("Sep 2026 – Sep 2026") above "22 מחזורים" (22 evenings). Ledger
   `season1-startsat-is-the-enable-moment`, `season1-range-prints-a-31-hour-lie`. Worse, the
   client's `VOID_SPAN` guard treats a sub-48h season as a bookkeeping artefact; only
   `players !== 0` stops this club's entire hall of fame collapsing into a grey dashed line.
2. **`completedRounds` (22) and the awards disagree.** The awards were decided against a
   *different* denominator — `awardsDenominatorOf(players.games)` = `max(games)` = 19
   (`seasonRollover.ts:133-139, 556`). `minPenaltyAttempts(19) = 2` but `minPenaltyAttempts(22) = 3`
   (`src/utils/seasonAwards.ts:126`). הלן צברי took exactly 2 penalties and scored both; Nofar took 3
   and scored 2. At 19 the title is הלן's on a rate of 1.0; at 22 הלן is not eligible and the title is
   Nofar's. The archive as it stands publishes the 22 and the 19-derived winner side by side, for
   ever, because `create()` makes it write-once and nothing recomputes. Ledger
   `awards-denominator-derivation-untested`, `repaired-completedrounds-silently-contradicts-the-sealed-titles`.
   The `updateTime` of this document (2026-09-18 11:41Z) is a day after its `createTime`
   (2026-09-17 16:12Z) — the length was hand-repaired; the awards were not.
3. **`partialData` is absent** on a season that is unambiguously partial: 19 of its 22 evenings
   predate the feature, assists were only collected from 21.06 and clean sheets from 17.08. The flag
   is written only on the `sealNow` activation branch (`index.ts:16483`), never on a rollover close
   and never on `endSeasonNow`. Three independent agents found this. Ledger
   `partialdata-only-on-the-sealnow-path`.

Also note `mvp.winners` has **seven of seven** members at `value: 6`. `eveningScoreCore` floors the
scale at 6.0 and also returns 6.0 as its "no data" sentinel; every archived row has
`eveningScoreSum / eveningScoreCount` exactly 6.0 (12/2 and 18/3). `leaders()` uses a floor of 0, so
the whole club won שחקן העונה ("player of the season"). This is verifiable from a third source:
a collection-group query over `users/*/seasonTitles` returns seven `…__s1__mvp` documents.

#### The `players` map row — and the one place absence is preserved

```json
"1IdtNEjbEXfiRSqvLrJVn99NsfI2": {
  "displayName": "מתן לוי",
  "games": 19, "rounds": 26, "goals": 2, "assists": 1,
  "wins": 11, "ties": 6, "losses": 9,
  "cleanSheets": 12, "ownGoals": 0,
  "penTaken": 1, "penScored": 0, "penMissed": 1, "penFaced": 1, "penSaved": 1, "penConceded": 0,
  "csRounds": 15, "asRounds": 24,
  "eveningScoreSum": 18, "eveningScoreCount": 3
}
```

`games` counts **evenings** (מחזורים); `rounds` counts **mini-games** (משחקונים). Both are in the
same row with adjacent names and the code conflates them constantly. All seven rows here have
`games` of 17–19 and `rounds` of 21–27. For a club on the plain timer — the common case — `rounds`
would be 0 for every player of every season, which is why 23 of production's 87 stat rows have
`games > 0` and no `rounds` at all.

Two fields, and only two, deliberately preserve the difference between absent and zero
(`seasonRollover.ts:351-356`):

```ts
for (const f of PLAYER_SEASON_FIELDS) {
  // ABSENT is not zero for the two coverage denominators.
  if ((f === 'csRounds' || f === 'asRounds') && typeof x[f] !== 'number') continue;
  row[f] = num(x[f]);
}
```

and the reader mirrors it (`src/utils/seasonArchive.ts:102-103`):

```ts
...(typeof x.csRounds === 'number' ? { csRounds: x.csRounds } : {}),
...(typeof x.asRounds === 'number' ? { asRounds: x.asRounds } : {}),
```

The reason is arithmetic, not taste. `csRounds` and `asRounds` are *coverage denominators*: how many
mini-games the clean-sheet and assist metrics were actually being recorded in. They arrived later
than the metrics they divide. A stored `0` asserts "measured across zero rounds", which is a
different statement from "we do not know how many rounds this was measured across" — and the
efficiency tab's fallback (divide by `rounds` instead) only fires on the second. Writing 0 made every
long-standing player's clean-sheet percentage read about ten points low. Every *other* field in the
archive defaults to 0 on read (`num()` at `seasonArchive.ts:9`), which is the ledger finding
`older-archive-degrades-into-plausible-zeros`: an archive written by an older build yields confident
wrong numbers rather than blanks, with no version field anywhere to detect it.

#### The `pairs` map

Keyed `"<lo>__<hi>"` by sorted uid, so `a`/`b` and every directional counter are re-oriented on the
way in. Guests (`id.startsWith('guest:')`) are dropped, and so is any pair whose counters sum to
zero; the cap is `MAX_ARCHIVED_PAIRS = 1200` (`seasonRollover.ts:181`), chosen to keep the document
under Firestore's 1 MB limit. On the real close the log read *"kept 0, dropped 293 guest, 21 empty"*
— the close read 314 pair documents and archived **21**, and the 293 guest documents it read are
never deleted by anything except the wipe added in `HEAD`.

```json
"CEkRfDs20xSuiW6xmPKlMcx3NoV2__JoLFRxFr0tTaYfVAXBPwkvT0et62": {
  "a": "CEkRfDs…", "b": "JoLFRxFr…",
  "sameTeam": 6, "against": 6,
  "winsTogether": 1, "lossesTogether": 2, "cleanSheetsTogether": 4,
  "winsA": 4, "winsB": 2,
  "assists": 0, "assistsAToB": 0, "assistsBToA": 0 }
```

Across all 21 archived pairs the directional assists sum to **7** and the legacy `assists` to **8**,
against `totals.assists = 13`. So the pair counters account for barely half the season's assists,
and the largest directional pair total is 2 — below `MIN_DUO_ASSISTS = 3`
(`src/utils/seasonAwards.ts:137`), which is why `awards.deadlyDuo` is `null`. The archive *reader*'s
`topDuo` (`seasonArchive.ts:128-155`) has **no** floor, so the stats screen happily names a duo on 2
assists that the season refused to crown, with ties broken by Firestore map-iteration order. Ledger
`archive-duo-reader-has-no-floor`, `assist-peers-account-for-half-the-season-assists`.

One more property of this document worth naming: **the `players` map has no order.** `Object.entries`
over a Firestore map returns whatever the wire gave it, and two consecutive reads of this immutable
document really did come back differently. `parseSeasonTable` now pins
`players.sort((a,b) => a.uid.localeCompare(b.uid))` (`seasonArchive.ts:114`) — added in a commit that
is **not** in either shipped 1.1.9 binary (ROUND4 §1).

### `seasonCards/{groupId}__{seasonId}` — the list row

Same close, same numbers, one hundredth the size, written with `merge: true` so a resume is a no-op
(`seasonRollover.ts:752-809`). The hall of fame reads only this; the archive is pulled lazily when a
season is opened. Read rule mirrors `seasonSummary`'s member clause but has **no** participant
clause — a departed player can open the archive and not the list.

```json
{ "groupId": "HhzIwmjMl1i5HSOGHt3p", "seasonId": "s1", "no": 1,
  "startsAt": 1789547794676, "endsAt": 1789661526768,
  "completedRounds": 22,
  "totals": { "rounds": 37, "goals": 27, "assists": 13 },
  "players": 7,
  "winners": [ {"key":"topScorer","names":["הלן צברי"],"value":10},
               {"key":"mvp","names":["מתן לוי","Lioz Madar","Linoy Levi","איציק לוי",
                                     "Nofar Tzabari","Eliran Tzabari","הלן צברי"],"value":6},
               {"key":"mostLoyal","names":["מתן לוי"],"value":19}, … ] }
```

`players: 7` comes from `countSeasonParticipants`, which counts rows with `games > 0` and falls back
to `rounds > 0`. `totals.rounds: 37` is **mini-games**, sitting one field away from
`completedRounds: 22` which is **evenings**; the Hebrew copy renders the first as "37 משחקים"
(games) and the second as "22 מחזורים" (evenings), forty points apart on the same card. `winners`
carries names, not uids, and they are frozen — which is correct for a record and is also why a
rename breaks the title-streak logic that joins on them.

The card does **not** carry `awardsDenominator`. It did for one day; because the field is
`max(players.games)` and `mostLoyal` is the maximum of the same array, `value / denominator` was
1.0 identically and the loyalty medal drew platinum for every season of every club. The field is
gone from both writer and card; see `awardsDenominatorOf`'s doc comment
(`seasonRollover.ts:112-132`) and ROUND4 §5.

### `users/{uid}/seasonTitles/{groupId}__{seasonId}__{titleKey}`

The public copy of a title, on the winner's profile. Deterministic id so a redelivery overwrites
rather than duplicates; the duo title's joined key `a__b` is split and written to both profiles
(`seasonRollover.ts:832-859`). Deleted exactly by `reopenSeason`, `seasonRollover.ts:1217-1245`. Rules:
`allow read: if isSignedIn(); allow write: if false;` (`firestore.rules:2010`).

```json
// users/1IdtNEjbEXfiRSqvLrJVn99NsfI2/seasonTitles/HhzIwmjMl1i5HSOGHt3p__s1__mostLoyal
{ "groupId": "HhzIwmjMl1i5HSOGHt3p",
  "groupName": "מועדון שכחת שושי",       // frozen: survives a club rename or the player leaving
  "seasonId": "s1", "seasonNo": 1,
  "titleKey": "mostLoyal", "value": 19,
  "at": 1789661526768 }
```

`value` is the raw winning number and its unit varies by title: 19 evenings for `mostLoyal`, 10 goals
for `topScorer`, 13 mini-game wins for `topWinner`, an average of 6.0 for `mvp`, a *rate* of 1.0 for
`penaltyKing`. Nothing on the document says which. The type is `SeasonTitle`
(`src/types/index.ts:1029-1038`).

### `roundSummaries/{gameId}` and `eveningStandings/{gameId}__{uid}`

Neither is a seasons collection, but both are inputs to the seasons machinery.

`roundSummaries/{gameId}` is created once per sealed evening with `create()`
(`index.ts:4876`, `:5161`). Its relevance here is twofold. First, **its existence is the sweep's
liveness gate**: `clubIsQuiet` (`index.ts:15466`, the unsealed-game check at `:15533-15570`) blocks a close when one of the three newest
finished games has no `roundSummaries` document and `didEveningHappen` says it happened. The
collection only began on 2026-08-26 — the live club has 10 summaries against 23 finished games — and
a legacy close is 'happened'. Ported and run over all 91 finished games in production, **24 of 30
clubs return `{ok:false, blocker:'unsealedGame'}` permanently**. Second, it carries an optional
`seasonEvenings` field derived as `eveningsSealed + 1 − seasons.roundsAtStart` (`index.ts:5157`) —
a *sixth* answer to "how many evenings", from the counter that started late. No production document
carries it; all ten predate the field.

```json
// roundSummaries/TZ7IWEJWVww2itvIKCd8
{ "gameId": "TZ7IWEJWVww2itvIKCd8", "groupId": "HhzIwmjMl1i5HSOGHt3p",
  "at": 1789655700000, "generatedAt": 1789655711641, "version": 1,
  "basis": { "since": 1787739600000, "eveningsCompared": 9 },
  "coverage": { "hasRoundHistory": false, "hasAssists": false },
  "stats": { "rounds": 0, "goals": 0, "assists": 0, "ties": 0, "shootouts": 0 },
  "events": [ { "type": "club_milestone", "metric": "evenings", "threshold": 10, "total": 10 } ],
  "leaders": { "topScorers": null, "topAssisters": null, "topWinners": null,
               "topCleanSheets": null, "topGoalInvolvement": null },
  "pairHighlight": null, "teamHighlights": { "best": [], "worst": [] } }
```

`eveningStandings/{gameId}__{uid}` is a per-player, owner-read-only row
(`firestore.rules:1772`): the score, its delta, and the rank before and after. Seasons touch it only
by resetting the table it ranks against; `at` is stamped `Date.now()` rather than the evening's
`startsAt`, so a late confirmation dates the row by the confirmation (ROUND4 §30).

### Six counters, one question

The reader will meet the phrase "how many מחזורים" in six different places. They are different
numbers and they disagree in production **today**:

| # | Where | Derivation | Value on the live club |
|---|---|---|---|
| 1 | `clubRecords.eveningsSealed` | `increment(1)` per seal, since 26.08.2026 | 10 |
| 2 | `groups.seasons.playedRounds` | seeded at open, `increment(1)` per seal of the running season | 0 (s2) |
| 3 | `completedRoundsFrom` fallback | `eveningsSealed − roundsAtStart` | 3 |
| 4 | client games scan, `inSeason` + `didEveningHappen` | 22 for s1, 0 for s2 | 22 / 0 |
| 5 | `seasonSummary.completedRounds` | whatever the closing caller passed | 22 (hand-repaired) |
| 6 | `awardsDenominatorOf` = `max(players.games)` | the eligibility gate's denominator | 19 |
| 7 | `seasonCards.totals.rounds` | **mini-games**, mislabelled in Hebrew as games | 37 |

`functions/src/seasonCounters.ts` was extracted specifically to make 1–4 testable side by side
(`tests/logic/seasonCounterReconciliation.test.ts`), and it is the right instinct. But 5, 6 and 7
live in `seasonRollover.ts` and are never reconciled with 1–4, and only 5 and 6 decide anything
irreversible.

### Absence semantics, collected

| Field | Absent means | Distinguishable from 0? | Who relies on it |
|---|---|---|---|
| `games.seasonId` | **season 1** | n/a (string) | `inSeason`, `eveningInSeason` — both sides |
| `seasons.playedRounds` | fall back to the sealed-counter subtraction | **yes**, tested with `typeof` | `completedRoundsFrom:110` |
| `seasons.roundsAtStart` | 0 | no | the subtraction fallback |
| `seasons.cadence.targetRounds` | `{kind:'none'}` → never due | yes | `seasonFinishLine:148` |
| `seasons.targetHistory` | never moved | no (`[]` ≡ absent) | nothing reads it |
| `seasons.reopenedAt` | no grace period | no | `index.ts:15979`, `:16179` |
| `seasonSummary.zeroedAt` | **resume a half-finished close** | yes (truthiness of a timestamp) | `seasonRollover.ts:667` |
| `seasonSummary.endedEarly` / `partialData` | not early / not partial | yes (omitted, not `false`) | card badges |
| `players[uid].csRounds` / `asRounds` | **coverage unknown → divide by `rounds` instead** | **yes, deliberately** | `seasonArchive.ts:102`, efficiency tab |
| every other archive field | 0 | **no** | `num()` fallback, `seasonArchive.ts:9` |
| `seasonSummary.closedBy` | manual-close metadata | yes | nothing |

The last two rows are the model's structural weakness. There is no schema version on any seasons
document, so a reader cannot tell an archive written by an old build from one written today, and the
only defence against silent degradation is two hand-maintained `typeof` checks on two fields.
