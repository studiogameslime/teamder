## Season scope versus lifetime — how the statistics are divided

Every number on a club screen comes from one of four places: a **live scan** over the club's
finished game documents (`gameService.getCommunityStats`), a **live rollup** of per-player counters
(`communityPlayerStats`, read through `gameService.getCommunityChampionship`), a **sealed archive**
of one closed season (`seasonSummary/{groupId}__{seasonId}`, plus its small twin `seasonCards`), or
a **merge** of the live rollup with every archive (`src/utils/allTimeTable.ts`). Closing a season
zeroes the rollups and leaves the scan untouched, so the divide between "this season" and "all
time" is not one mechanism — it is two different mechanisms that have to be kept in agreement by
hand, on every screen, for every row. This section is about the scan, which is the half that was
retro-fitted with a season filter, and about the five places that call it.

All line numbers are HEAD (`e35394a`, 2026-09-18 21:40 +0300, version 1.1.10). Where a defect was
fixed after the shipped store binaries were cut, that is stated: the 1.1.9 artifacts on both stores
were built from `4de80d0`, which predates most of what follows (ROUND4 #1).

### `gameService.getCommunityStats` — one query, two tallies

`src/services/gameService.ts:949-1262`. The signature is one required club id and one optional
season scope:

```ts
async getCommunityStats(
  groupId: GroupId,
  season?: { currentId: string; currentNo: number },   // :965
): Promise<{ /* ~14 fields, listed below */ }>
```

The query (`:1112-1117`) is fixed and bounded:

```ts
const q = query(
  col.games(),
  where('groupId', '==', groupId),
  where('status', 'in', ['finished', 'cancelled']),
  orderBy('startsAt', 'desc'),
  limit(200),
);
```

So the universe is **the 200 most recent terminal game documents of this club, newest first**.
Nothing paginates past that. A permission-denied read returns the all-zero `empty` object
(`:1008-1033`); any other error is logged to the `errors` inbox and re-thrown, which every caller
turns into `null` with a `.catch`.

The loop (`:1150-1217`) runs **once** and maintains **two independent tallies**. The lifetime tally
is computed first, in a bare block *before* the season gate:

```ts
for (const doc of snap.docs) {
  const g = doc.data();
  {                                                   // :1155 — lifetime, unscoped
    const st = eveningPlayState(g as PlayableEvening);
    if (g.status === 'cancelled' || st === 'notHappened') lifeCancelled += 1;
    else if (st !== 'unverified') {
      lifeFinished += 1;
      /* attendance set, 30d / 365d windows, lifeNights.push(...) */
    }
  }
  if (!inSeason(g as { seasonId?: string }, season)) continue;   // :1171 — the gate
  const state = eveningPlayState(g as PlayableEvening);          // :1179
  if (g.status === 'cancelled') { totalCancelled += 1; continue; }
  if (state === 'unverified') continue;                          // :1188 — counts for neither
  if (state === 'notHappened') { totalCancelled += 1; continue; }// :1191
  totalFinished += 1;                                            // :1195
  /* thisMonthFinished, attendedTally, activeMonth, activeYear, nights.push(...) */
}
```

Two things are worth naming here. First, *whether an evening happened* is never re-derived: both
tallies ask `eveningPlayState` (`src/utils/eveningPlayed.ts`), which returns `'happened'`,
`'notHappened'`, `'unverified'` or `'pending'`. An `'unverified'` night — auto-closed by the sweep
with no timer, no goals and no rotation, and no admin ruling — is excluded from **both** halves of
the organisation-rate fraction rather than counted as a failure. Second, the lifetime block has no
`thisMonthFinished`, no `attendedByUser`, no `avgAttendance` and no `topPlayers`: those four exist
only in the season-scoped half, which is why a caller that wants an unscoped attendance count must
pass no season at all rather than read `lifetime`.

The return (`:1230-1260`) is:

| Field | Scope | Meaning | Absent → |
| --- | --- | --- | --- |
| `totalFinished` | season | evenings `'happened'` in scope | 0 |
| `totalCancelled` | season | `cancelled` + `notHappened` in scope | 0 |
| `organizationRate` | season | `finished / (finished + cancelled)`, 0 when both are 0 | 0 |
| `avgAttendance` | season | member arrivals ÷ finished nights | 0 |
| `thisMonthFinished` | season | finished within 30 days | 0 |
| `activeThisMonth` | season | distinct attendees, 30-day window ∩ season | 0 |
| `activeThisYear` | season | distinct attendees, 365-day window ∩ season | 0 |
| `topPlayers` | season | top 5 `{uid, attended}`, desc | `[]` |
| `attendedByUser` | season | uid → nights attended (the authoritative "הופעות") | `{}` |
| `longestStreak` / `longestStreakUid` | season | longest consecutive-night run | 0 / `null` |
| `currentStreakByUser` | season | uid → current run | `{}` |
| `lifetime.totalFinished` / `.totalCancelled` / `.organizationRate` | lifetime | as above, unfiltered | 0 |
| `lifetime.activeThisMonth` / `.activeThisYear` | lifetime | as above, unfiltered | 0 |
| `lifetime.longestStreak` / `.longestStreakUid` | lifetime | the club's permanent record | 0 / `null` |

The streak is computed by one shared helper, `lifetimeStreak` (`:550-575`), called twice — once on
`nights` (`:1218`) and once on `lifeNights` (`:1239`) — so the season record and the lifetime record
can never be computed by two different rules. It walks nights oldest→newest, resets a player's run
on a missed night, and keeps the first uid to reach each new maximum (`if (run[uid] > longestStreak)`
is strict). On a club where several regulars never miss, the named holder is therefore decided by
`g.players` array order in the earliest night of the window — ROUND4 #28.

**`limit-200-window-is-a-lifetime-label`.** The doc-comment at `:934-947` is honest that this is a
window, not all time, but the field is named `lifetime` and the screen renders it under the word
"אי פעם" ("ever"). For a club past 200 terminal documents — roughly four years of weekly play, or
one year for a club that also cancels — `lifetime.totalFinished` silently becomes "the last 200
attempts". Worse under scoping: the `limit(200)` is applied by Firestore **before** `inSeason` runs
in JavaScript, so a season that sits entirely outside the newest 200 documents scores zero with no
error. For the one production club (23 terminal docs) neither bound bites.

**`avgAttendance` counts members only** (ROUND4 #16). The inner loop iterates `g.players`
(`:1207`); guests live in a separate `g.guests` array whose ids never appear there. Recomputed over
the real club's 22 held evenings: **141 member arrivals against 98 guest slots**, so the screen
renders 141/22 = **6.4** for nights that averaged 10.9 on the pitch — one night was 7 members and
11 guests. The label is "ממוצע הגעות למחזור" ("average arrivals per game-night"), and the club's
own sealed archive records `guestGoals: 4`, so guests are participants elsewhere.

### The season predicate

`src/utils/seasonScope.ts` holds the whole rule:

```ts
export function inSeason(game: { seasonId?: string }, season?: SeasonScope): boolean {
  if (!season) return true;
  const stamp = typeof game.seasonId === 'string' ? game.seasonId : '';
  return stamp ? stamp === season.currentId : season.currentNo === 1;
}
```

Three cases. **No scope** → everything passes, and the function degenerates into the pre-seasons
lifetime scan. **A stamp** → exact string equality with the running season id. **No stamp** → the
evening belongs to season 1, because the `seasonId` stamp is written by the server only from the
feature's ship date onward, and "your history becomes season 1" is what enabling seasons promises.

`unstamped-season-1-rule-disagrees-with-the-server-by-19` — **now fixed, and the fix has a sharp
edge.** The server's copy is `eveningInSeason` in `functions/src/seasonCounters.ts:53-60`, character
for character the same rule, and `functions/src/index.ts:15599-15637` (`playedEveningsOfSeason`)
now passes `seasonNo` through to it. Before that fix the server counted only stamped games and
answered **3** where the client answered **22**; a reopen of season 1 would have written 3.
`tests/logic/seasonCounterReconciliation.test.ts` runs both copies over one fixture.

The edge is what the rule does for a club **past** season 1. Production, `HhzIwmjMl1i5HSOGHt3p`
(מועדון שכחת שושי), read live:

```
groups/HhzIwmjMl1i5HSOGHt3p.seasons =
  { enabled: true, currentId: 's2', currentNo: 2, count: 1,
    playedRounds: 0, roundsAtStart: 10, startedAt: 1789679141952,
    cadence: { type: 'rounds', targetRounds: 24 } }
```

23 terminal game documents. Their stamps: **19 carry none, 3 carry `'s1'`, 1 carries `'s3'`** (an
orphan — the club's seasons block has never known an `s3`). With `season = {currentId:'s2',
currentNo:2}`, `inSeason` returns false for all 23: the unstamped ones fail `currentNo === 1`, the
`s1` and `s3` ones fail the string compare. **Not one game in the club's history is in scope for
the season it is currently playing.** Every season-scoped field above is therefore 0 / `{}` /
`null`.

A structural consequence nobody has written down: the stamp is written by `onGameRosterChanged`
only on a transition into `active` or `finished` (`functions/src/index.ts:5802-5810`). A game
cancelled from `open` never reaches either, so it is never stamped, so for any club in season ≥ 2 a
genuine cancellation can never enter `totalCancelled`. The season-scoped `organizationRate` is
therefore **either exactly 0 (no evenings in scope) or exactly 1.0** — the only way to lose points
is the `notHappened` route, an evening that kicked off and was later declared not to have happened.
It is not a rate; it is a two-valued flag wearing a percentage sign.

### The five callers

| Caller | Passes a season? | Scope it gets | What it renders |
| --- | --- | --- | --- |
| `CommunityStatsScreen.tsx:199` | **yes** (`:193-197`) | season, with `lifetime` beside it | hero evening tile, `mostLoyal`, org donut, streak row, "פעילים השנה", `attendedByUser` → league table, badges, club level |
| `playerCompareService.ts:159` | **yes** (`:146-152`) | season | the `games` / "מחזורים" row of the compare card, and the denominator of every per-game rate on it |
| `CommunityDetailsScreen.tsx:189` | no | lifetime | "מפגשים שנערכו" headline, and the four-cell `CommunityStatsSection` |
| `assistantInsightsService.ts:170` | no | lifetime | the coach's attendance streak and "N ערבים על הדשא" lines |
| `SeasonsSettings.tsx:341` | no | lifetime | `history`, the club's pre-seasons evening count shown in the activation confirm sheet |

Two of those five are deliberate and correct, and three are deliberate and unscoped. The two
season-passing callers both read the club document first for the sole purpose of learning the
scope, and both carry a comment saying so — one extra document read per screen.

**`CommunityStatsScreen`** (`:182-200`) resolves the scope from the group:

```ts
const g = await groupService.get(groupId).catch(() => null);
const scope = g?.seasons?.enabled && g.seasons.currentId
  ? { currentId: g.seasons.currentId, currentNo: g.seasons.currentNo ?? 1 }
  : undefined;
```

(The local `scope` shadows the screen's `scope` state for the length of the effect; harmless, but it
is the same word meaning two different things eight lines apart.) A club with seasons switched off
passes `undefined` and gets its lifetime numbers in both halves, which is why the same function
serves both kinds of club.

**`CommunityDetailsScreen`** is the screen the owner's original complaint was about. It calls with
no season (`:189`) and renders `communityStats.totalFinished` as `matchesHeld` (`:614`) plus a
four-cell block (`:1284-1310`) reading `totalFinished`, `thisMonthFinished`, `organizationRate` and
`avgAttendance`. This is right for what it is — a club screen, not a season screen — but nothing on
it says so.

`evenings-22-on-one-screen-0-on-the-next` (ROUND4 #2) is the collision of those two rows in the
table. Hand-recomputed from the 23 raw documents, exactly as the code computes it:

```
lifetime:  finished 22, cancelled 1, organizationRate 0.9565 (96%),
           activeThisMonth 7, activeThisYear 7,
           longestStreak 22 held by 1IdtNEjbEXfiRSqvLrJVn99NsfI2,
           attendance { 22, 20, 20, 20, 20, 20, 19 }
season s2: finished 0, cancelled 0, organizationRate 0, activeThisYear 0,
           longestStreak 0, attendedByUser {}
```

So `CommunityDetailsScreen` prints **"מפגשים שנערכו 22"** and **"אחוז הצלחה בארגון 96%"**, and one
tap away `CommunityStatsScreen` prints **"מחזורים 0"**. Both are correct answers to different
questions, neither screen states which question it asked, and the shipped 1.1.9 binary makes it
worse: at `4de80d0` the organisation donut read the *season* rate (`stats?.organizationRate`,
`:876` of that revision) and rendered **0% in green** — "no evening was ever cancelled" and "every
evening was cancelled" render identically.

**`playerCompareService`** — `compare-card-divides-season-goals-by-lifetime-nights` is **fixed at
HEAD and unshipped**. The card's goals/assists/wins/rounds come from `getCommunityChampionship`
(the rollup a close zeroes) while `games` is overridden from the scan
(`:191-192`: `games: attended[uidA] ?? baseA.games`), and `toPlayer` divides one by the other
(`:103`: `goalsPerGame = row.goals / row.games`). With an unscoped scan that is *this season's
goals over the club's lifetime evenings*. On this club it produced goals 0-0, assists 0-0,
אחוז ניצחון 0%-0%, ממוצע גולים למחזור 0.0-0.0 and then **מחזורים 22-20**, a single non-zero row,
which set `verdict.leader` and printed "אתה מוביל 👑 ב-1 מתוך 6 קטגוריות" ("you lead in 1 of 6
categories") over five zeros — on a card designed to be captured to PNG and shared. HEAD passes the
season, which makes both columns read 0 and makes the new `if (!baseA || !baseB) return null` guard
(`:178`) the thing that stops the card rendering at all. The club league table solved the same
problem the other way: `CommunityChampionship.tsx:179` suppresses the override outright
(`attendedByUser={seasonNo || seasonId || rows ? undefined : attendedByUser}`) rather than
re-scoping it.

**`assistantInsightsService`** deliberately stays lifetime. Its two consumers are
`rules.ts:425-438`: `attendanceStreak >= 3` → "אתה מחזיק רצף של N הגעות רצופות" and
`attendedNights >= 10` → "N ערבים על הדשא". Both are statements about a person's history, not about
a season, so the unscoped scan is the right source — but the *same object* also carries
table-derived places and crowns from the season-zeroed rollup, so one coach card mixes a 22-night
lifetime streak with a season standing of nothing. ROUND4 #6 described `getClubInsight` returning
`null` before it could say either; HEAD splits the two cases (`:163` `if (!mine && rows.length > 0)
return null`) so the attendance half still speaks when the table is empty. The 200-document scan is
still paid for, every 6 h per user, on a branch named `perf/firestore-read-costs`.

**`SeasonsSettings`** (`:339-351`) uses the scan for something else entirely: `st.totalFinished` is
the club's *pre-seasons history*, the number the activation sheet promises will become season 1.
Unscoped is correct — the club has no season yet — and the call is made only on the `firstTime`
branch. For a live club the same state is filled from `seasons.playedRounds` instead (`:336`),
which for this club is **0** while the scan would say 22.

### The three scopes on the statistics screen

`scope` is a union (`:60`): `{k:'current'}`, `{k:'season', id}`, `{k:'all'}`. `slice` (`:356`) is
`null` for the running season, the parsed archive for a closed one, and the merge for all-time; the
whole screen derives from `viewChamp`/`slice` rather than from `champ` directly, so a past season
renders through exactly the same code path as the running one.

| Row on screen | running season | closed season | all time |
| --- | --- | --- | --- |
| גולים / בישולים / משחקונים tiles | live rollup (`champ`) | archive `totals` | `mergeAllTime` totals |
| **מחזורים** tile (`:769`) | **season scan** `totalFinished` | **card** `scopedCard.completedRounds` | **`lifetime.totalFinished`** |
| top scorer hero, leaders card | live rollup rows | archive `players` rows | merged rows |
| כתר ההתמדה / `mostLoyal` (`:479-490`) | **scan** `topPlayers[0]` | archive `games` column | merged `games` column |
| הצמד הקטלני | live `communityPairStats` | archive `pairs` | **not offered** (pair data is per-season) |
| organisation donut (`:907-914`) | **lifetime** | hidden | hidden |
| longest streak row (`:943-953`) | **lifetime** | hidden | hidden |
| פעילים השנה (`:975-985`) | **lifetime** `activeThisYear` | replaced by "N שחקנים שיחקו בעונה" from row count | same replacement |
| כימיה section | live pairs | hidden | hidden |
| league table (own fetch) | rollup with `keepAll=true` | archive | merged rows |
| club badges + level (`:494-517`) | **lifetime** + archived goals | hidden | hidden |

Three of those rows are lifetime *inside* the season scope, and the tooltip under the picker says
so: `he.communityStatsScopeClosedInfo` — *"אחוז ההתארגנות, הרצפים, הכימיה בין השחקנים ותארי המועדון
נמדדים על המועדון לאורך כל הדרך, לא על עונה בודדת — ולכן הם מוצגים רק בעונה הרצה"* ("the
organisation rate, the streaks, the chemistry between players and the club titles are measured over
the club's whole life, not over a single season — which is why they are shown only in the running
season"). The reason is that a record and a badge are permanent things the club did: season-scoping
them meant a club un-earned its gold "שערי המועדון" badge and dropped a club level the morning after
every close, and its 22-night attendance record vanished from the app entirely.

`closed-season-tooltip-promises-lifetime` is **true of HEAD and false of every shipped binary**. At
`4de80d0` the donut read `stats?.organizationRate`, the streak row read `stats.longestStreakUid` /
`stats.longestStreak`, and "פעילים השנה" read `stats?.activeThisYear` — all three season-scoped,
all three zero, under a tooltip stating they were lifetime. Commit `5531a21` switched exactly those
three to `stats.lifetime.*` and added the fields to make it possible. It also created ROUND4 #13:
the **מחזורים tile above them stayed season-scoped**, so the next build reads "מחזורים 0", then
"96% מהמחזורים שתוכננו יצאו לפועל", then "— הגיע 22 מחזורים ברצף", then "7 שחקנים היו פעילים השנה"
— four rows, two scopes, one card, nothing marking the boundary. The old version was consistently
wrong; this one is inconsistently right.

`activeThisYear-is-season-intersected` is why that switch was needed. The 365-day window is applied
*inside* the post-`inSeason` branch (`:1213`), so the season figure is the intersection of a year
and a season. A season three days old makes "השנה" ("this year") mean three days, and this club —
whose entire roster of seven played this month — read **"0 שחקנים היו פעילים השנה"**. The
invariant the two tallies exist to hold is `season ≤ lifetime` for every counter; it holds by
construction, because the season branch is nested inside the lifetime one. The mock block at
`:1034-1105` used to violate it (`activeThisYear: 28` over `lifetime.activeThisYear: 18`), which is
ROUND4 #25, and has been rewritten to derive both from one monotone tally.

`appearances-rollup-undercounts-the-scan`. `mostLoyal` deliberately reads the scan for the running
season and the archive's `games` column for a closed one — and the two disagree. Production, side
by side:

```
scan (attendedByUser)     archive seasonSummary/…__s1 (players[].games)
1IdtNEjb…  22             1IdtNEjb…  19      ← mostLoyal winner, value 19
YIZlKWBv…  20             YIZlKWBv…  18
B5KpYO4I…  20             B5KpYO4I…  18
alsobLSA…  20             alsobLSA…  18
CEkRfDs2…  20             CEkRfDs2…  18
K5rSGB4J…  20             K5rSGB4J…  18
JoLFRxFr…  19             JoLFRxFr…  17
```

The gap is exactly three evenings — `2SMrlCGHyjnCmfRVthlS` (06.07), `MMtE8J6HClLHpjhHL99A` (16.07)
and `FCa5UtSdIb7m3X9rs9og` (04.08) — and I confirmed the cause directly: those three games have an
**empty `finishCredited` subcollection**, while every other night has one document in it. That
marker is the idempotency latch created in the same batch as the `games: increment(1)` writes
(`functions/src/index.ts:5895-5915`); no marker means the increment never ran. So the scan is right
and the rollup is short. The card for season 1 prints `completedRounds: 22` while the title it
awarded, כתר ההתמדה, was decided on 19 — and the eligibility denominator for all nine titles was
derived from the same 19 (`seasonRollover.ts:541-544`).

`archived-goals-silently-zero`. Lifetime club goals are assembled on the client as
`champ.totalGoals + archivedGoals` (`:508`), where `archivedGoals` is summed from
`seasonHistoryService.list` (`:217-219`). `list` returns the string `'error'` on failure and the
handler is `if (!alive || list === 'error') return;` — so a failed read leaves `archivedGoals` at
its initial `0` **and** leaves `pastSeasons` empty, which removes the "כל הזמנים" chip and every
past-season chip from the picker. One failed `seasonCards` query silently collapses club goals to
this season's (zero, after a close), and removes the only route to the club's history. On this club
the damage is currently invisible: 27 archived goals against a 100-goal bronze threshold, and 303
vs 276 club-level points both landing in level 3. On a club with three seasons behind it the same
failure is a visible demotion with no error shown.

### What a close does to the live tables

`performSeasonClose` writes the archive, then winds the live counters back. `PLAYER_SEASON_FIELDS`
(`functions/src/seasonRollover.ts:184-210`) names 21 columns — goals, assists, rounds, wins, losses,
ties, games, cleanSheets, ownGoals, the six penalty counters, `csRounds`, `asRounds`,
`eveningScoreSum`, `eveningScoreCount` — and every one is subtracted from each
`communityPlayerStats` row. `PAIR_SEASON_FIELDS` (`:220-231`) does the same for all ten counters on
every `communityPairStats` row. `CLUB_SEASON_FIELDS` (`:234-242`) — `rounds`, `goals`, `guestGoals`,
`ownGoals`, `tiedRounds`, `shootoutRounds`, `scorelessRounds` — is **set to absolute 0** on
`communityStats/{groupId}` (`:1004-1010`) rather than subtracted, which the module's own comment
forbids for the other two.

The result, read live today, three weeks after the 17.09 close:

```
communityStats/HhzIwmjMl1i5HSOGHt3p = { goals: 0, rounds: 0, guestGoals: 0,
                                        ownGoals: 0, tiedRounds: 0, ... }
all 7 communityPlayerStats rows      = { goals:0, assists:0, wins:0, games:0, rounds:0,
                                         cleanSheets:0, penTaken:0, ... }
```

Everything downstream of those rows is therefore zero at once. `rankChampionshipRows`
(`src/utils/championship.ts:139-147`) keeps a row only if `keepAll || goals>0 || assists>0 ||
games>0 || wins>0`, and `getCommunityStats`'s sibling `getCommunityChampionship(groupId)` is called
with no `memberIds` from the stats screen (`gameService.ts:1365`, `keepAll=false`) — so `champ.players`
comes back **empty**, `hasScoring` is false, and the hero card, the leaders card and six of the
eight fun facts disappear in one paint. The league table at the bottom of the same screen makes its
*own* call **with** `memberIds` (`CommunityChampionship.tsx:90`, `keepAll=true`) and therefore
renders seven rows of zeros: one screen, one function, two different answers to "does this club have
players". The banner `he.communityStatsSeasonFresh` exists precisely to stop a ten-year member
reading that as "מחקו לי הכל" — *"עונה N רק התחילה, אז הטבלה עוד ריקה. שום דבר לא נמחק"* ("season N
has only just begun, so the table is still empty. Nothing was deleted").

How long does it last? Until the club's **next evening finishes with evidence of play**. That single
transition (`didEveningHappen` false→true, `functions/src/index.ts:5870-5915`) writes
`games: increment(1)` for every non-no-show member, which re-populates the rollup rows and so
restores `champ.players`; the same evening is stamped `s2` by the trigger, which gives the season
scan its first `totalFinished`. For a club that plays once a week that is **up to seven days of a
club that looks brand new**, and for a club that has stopped playing it is permanent. Goals,
assists, wins and mini-games do not come back with it — those are written only by the advanced-mode
mini-game commit path, so the common timer-only club stays on `goals: 0` for the whole season, and
`hasScoring` (`:564`) never becomes true. The "all time" scope is the only place where the club's
real totals survive, and it is offered only once `pastSeasons.length > 0` (`:625`).

`mergeAllTime` (`src/utils/allTimeTable.ts`) is the addition: the live slice first, then every
archive, summing thirteen count columns (`SUMMED`, `:35-49`) per uid and merging names
first-wins so a current member keeps their live name over a frozen copy. Its one piece of care is
`mergeCoverage` (`:63-69`): `csRounds` and `asRounds` are summed **only when both sides have one**,
because absent means "never measured" and adding a present one to an absent one would invent
coverage and deflate the rate. Everything else is a plain `n(prev[f]) + n(row[f])` with `n(undefined)
= 0`, so an older archive missing a column contributes a confident zero — the
`older-archive-degrades-into-plausible-zeros` finding, reached through the merge rather than through
the reader.
