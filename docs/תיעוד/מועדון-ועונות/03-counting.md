## How a מחזור is counted — the three counters

A **מחזור** (*machzor*) is one game-night. This club plays one a week. A **משחקון**
(*mischakon*) is one mini-game inside that night; there are typically four to six of
them, and they exist only in "advanced mode". The one club that has ever run a
season is on the plain timer: across its ten sealed evenings it recorded
`stats.rounds` of 4, 2, 0, 3, 2, 4, 0, 0, 0, 0 — and zero on every evening since the
feature was switched on. Everything in this section counts **evenings**. Where a
number in the codebase is called `rounds` and means mini-games, it is named as such.

The app holds three independent, separately-written answers to "how many evenings
has this club played", plus four server derivations and two frozen archive copies.
None of them is a view of another. This section is the map of all of them.

### The three writers

| # | Where it lives | Written by | Unit | Resets? | Client can read it? |
|---|---|---|---|---|---|
| 1 | `clubRecords/{groupId}.eveningsSealed` | server, `FieldValue.increment(1)` | evenings sealed since 26.08.2026 | never | **no** — rules deny |
| 2 | `groups/{groupId}.seasons.playedRounds` | server, seeded + `increment(1)` | evenings in the running season | zeroed by every season-opening path | yes |
| 3 | nothing — derived on the phone | `gameService.getCommunityStats` scan | evenings in the 200-newest terminal games | n/a (recomputed each read) | it *is* the client |

### Counter 1 — `clubRecords.eveningsSealed`

The oldest of the three, and the only one that is *exact*. It is written in one
place, `functions/src/index.ts:5194`, inside the batch at the bottom of
`sealRoundSummary`:

```ts
// functions/src/index.ts:5188-5196
batch.set(
  db.collection('clubRecords').doc(groupId),
  {
    groupId,
    ...next,
    // INCREMENT, not `read + 1`.
    eveningsSealed: admin.firestore.FieldValue.increment(1),
```

The comment above it records the incident that forced the atomic form: three
evenings sealed within a minute on the QA club left three summaries and a counter of
two. It is safe to increment because `summaryRef.create()` at `:5162` throws if this
evening was already sealed, so the batch runs at most once per game.

Three properties matter, and all three are traps.

**It began on 26.08.2026.** `sealRoundSummary` shipped in commit `59cd9b6`
(2026-08-25). Production proves the date exactly: `clubRecords/HhzIwmjMl1i5HSOGHt3p`
carries `since: 1787739600000` = **2026-08-26T10:20:00Z**, which is the `startsAt`
of `games/T7qRTLR0…`, the club's first sealed evening. Every evening before it —
twelve of them, from 28.06 to 24.08 — has **no `roundSummaries` document at all** and
is invisible to this counter. I enumerated the club's 23 terminal games and probed
`roundSummaries/{gameId}` for each:

| Evening (UTC) | roundSummary | `basis.eveningsCompared` | mini-games |
|---|---|---|---|
| 28.06 – 24.08 (12 evenings) | **absent** | — | — |
| 26.08 10:20 | present | 0 | 4 |
| 31.08 13:35 | present | 1 | 2 |
| 07.09 05:25 | present | 2 | 0 |
| 08.09 06:35 | present | 3 | 3 |
| 11.09 05:35 | present | 4 | 2 |
| 14.09 09:40 | present | 5 | 4 |
| 15.09 13:00 | present | 6 | 0 |
| 16.09 06:20 | present | 7 | 0 |
| 17.09 14:30 | present | 8 | 0 |
| 17.09 14:35 | present | 9 | 0 |
| 17.09 21:19 | **absent** (auto-closed, `playVerified:false`) | — | — |

`eveningsCompared` is `eveningsSealed` as read at the top of that seal
(`index.ts:5153`), so the ladder 0→9 is the counter's own history. It stands at
**10** today. The club has played **22**.

**Nothing decrements it.** The deletion handler at `index.ts:5357-5391` writes a
`gameDeletions` audit row and sends pushes; it does not touch `clubRecords` or
`seasons`. Delete a sealed evening and the counter keeps it. This is deliberate —
`src/utils/seasonLifecycle.ts:34-37` states it as the reason to prefer the counter
over a query — but it means counter 1 and counter 3 drift permanently apart on any
deletion, in the opposite direction from the 26.08 blindness.

**The client cannot see it.** `firestore.rules:1813` is
`allow read, write: if false`. This is why counter 2 exists at all.

### Counter 2 — `seasons.playedRounds`

The mirror. It is the number the club card shows, the number the hourly sweep closes
on, and the number `endSeasonNow` archives. `src/components/community/SeasonsCard.tsx:151`:

```tsx
<Text style={styles.big}>{seasons.playedRounds ?? 0}</Text>
<Text style={styles.bigOf}>{he.seasonsCardOfTarget(cadence!.targetRounds as number)}</Text>
```

`he.seasonsCardOfTarget` (`src/i18n/he.ts:2126`) renders `מתוך {target} מחזורים`
("out of {target} evenings"), so the card reads e.g. "0 מתוך 24 מחזורים".

It is **seeded** at activation and **incremented** at every qualifying seal
(`index.ts:5216-5236`):

```ts
if (seasonRoundsAtStart !== null) {
  batch.set(
    db.collection('groups').doc(groupId),
    { seasons: { playedRounds: admin.firestore.FieldValue.increment(1) } },
    { merge: true },
  );
}
```

`seasonRoundsAtStart` is non-null only when the evening belongs to the *running*
season (`index.ts:5092-5106`):

```ts
if (sea?.enabled) {
  tableZeroedAt = num(sea.roundsAtStart);
  const stamp = typeof args.seasonId === 'string' ? args.seasonId : '';
  const mine = stamp ? stamp === sea.currentId : sea.currentNo === 1;
  if (mine) seasonRoundsAtStart = tableZeroedAt;
  else { console.log('[season] seal is not for the running season — progress not credited', …); }
}
```

That `mine` expression is the stamp rule (below), and it is why an admin confirming a
forgotten evening from an archived season no longer pushes the current season one
evening closer to its target.

**The seed** comes from `src/utils/seasonSeed.ts` (mirrored at
`functions/src/seasonSeed.ts`), called at `index.ts:16572-16575`:

```ts
...seasonSeed(
  await sealedEveningsOf(groupId),                              // → roundsAtStart
  closedSoFar > 0 ? 0 : await playedEveningsFromGames(groupId), // → playedRounds
),
```

so season 1 of a first-time club is seeded with the **games count**, and every later
season with **0**. Season 1 owns the club's history; season 5 does not.

**Every path that opens a season zeroes it**: `index.ts:15905` (the rollover's
lifecycle write), `:16501` (the `sealNow` activation branch), `:17057`
(`endSeasonNow`). The `continue` activation branch seeds it via `seasonSeed`. The
reopen recomputes it from the games (`:16925-16934`).

Because the field is zeroed by three paths and written by `merge:true` set()s,
`disable → re-enable` on a club with a running season re-seeds `playedRounds: 0` even
though the disable dialog promises `הספירה תמשיך מהמקום שבו עצרה` ("the count will
continue from where it stopped") — LEDGER `disable-reenable-zeroes-running-season`.
This is not hypothetical on the live club: `seasons.startedAt` is
**2026-09-17T21:05:41Z**, five hours *after* season 1 closed at 16:12Z, which is the
signature of exactly that re-open.

**What happens when it is absent.** `completedRoundsFrom` (below) falls through to
counter 1 minus the offset. That fallback is the single most expensive line in the
feature's history.

### Counter 3 — the client scan

`src/services/gameService.ts:949`, `getCommunityStats(groupId, season?)`. One query,
one pass, two tallies:

```ts
// src/services/gameService.ts:1112-1118
const q = query(col.games(), where('groupId','==',groupId),
  where('status','in',['finished','cancelled']),
  orderBy('startsAt','desc'), limit(200));
```

```ts
// src/services/gameService.ts:1150-1186 (trimmed)
for (const doc of snap.docs) {
  const g = doc.data();
  {                                   // ── LIFETIME, before the season gate
    const st = eveningPlayState(g as PlayableEvening);
    if (g.status === 'cancelled' || st === 'notHappened') lifeCancelled += 1;
    else if (st !== 'unverified') { lifeFinished += 1; /* …attendance… */ }
  }
  if (!inSeason(g as { seasonId?: string }, season)) continue;
  const state = eveningPlayState(g as PlayableEvening);
  if (g.status === 'cancelled') { totalCancelled += 1; continue; }
  if (state === 'unverified') continue;      // counts as NEITHER half of the rate
  if (state === 'notHappened') { totalCancelled += 1; continue; }
  totalFinished += 1;
  …
}
```

Two exported rules do all the deciding — `inSeason` (`src/utils/seasonScope.ts:28`)
and `eveningPlayState`. Neither is re-implemented here, which is new: until 18.09 the
season rule was a closure inside this function, and the only test of it was a copy of
the rule re-declared inside `tests/logic/seasonScopedStats.test.ts` (LEDGER
`inseason-tested-as-a-private-copy`).

`totalFinished` is the season-scoped answer; `lifetime.totalFinished` is the
all-time one. The screen picks between them at
`src/screens/communities/CommunityStatsScreen.tsx:769`:

```tsx
value={scopedCard ? scopedCard.completedRounds
      : scope.k === 'all' ? (stats?.lifetime?.totalFinished ?? 0)
      : (stats?.totalFinished ?? 0)}
label={he.communityStatsEvenings}   // 'מחזורים'
```

so one tile can render three different numbers for the same club depending on which
chip is selected — by design, but see the matrix.

### `roundsAtStart` — the offset, and why its source must match the counter's

`roundsAtStart` exists only to make counter 1 usable. Counter 1 never resets, so a
season must remember its own zero; `completedRoundsFrom` subtracts:

```ts
// functions/src/seasonCounters.ts:105-118
export function completedRoundsFrom(
  sealedEvenings: number, roundsAtStart?: number, playedRounds?: number,
): number {
  if (typeof playedRounds === 'number' && playedRounds >= 0) return playedRounds;
  const all  = typeof sealedEvenings === 'number' && sealedEvenings > 0 ? sealedEvenings : 0;
  const base = typeof roundsAtStart  === 'number' && roundsAtStart  > 0 ? roundsAtStart  : 0;
  return Math.max(0, all - base);
}
```

The invariant the subtraction needs is: **`roundsAtStart` must be a reading of the
same counter, taken at the season's start.** It is — `seasonSeed`'s first argument
and `index.ts:16500`, `:17056`, `:15885` are all `sealedEveningsOf(groupId)`, i.e.
`clubRecords.eveningsSealed`.

The invariant that does **not** hold is the one the fallback silently assumes: that
`eveningsSealed − roundsAtStart` equals the season's evenings. It only equals the
season's evenings *since the counter started*. Season 1 of this club was seeded
`{roundsAtStart: 7, playedRounds: 19}` on 2026-09-16T08:36:34Z — 7 from the counter,
19 from the games. Three seals later the two had moved in lockstep (`10` and `22`),
but the *difference* was 3 and the *truth* was 22. Two shipped code paths reached for
that difference:

* `endSeasonNow` called `completedRoundsOf(groupId, seasons.roundsAtStart)` with two
  arguments, so `playedRounds` was `undefined` and the fallback fired. Pressing
  "סיים עונה עכשיו" would have sealed **3** into a write-once archive for a season the
  card said was 22. (LEDGER `end-season-now-ignores-playedrounds`; fixed, the fix is
  the comment at `index.ts:17022-17034`.)
* `reopenSeason` derived `playedRounds` the same way, then — after that was fixed —
  from stamped games only, which gave 3 again from the other side (LEDGER
  `reopen-season1-drops-the-19-unstamped-evenings`).

Both fixes are in `functions/src/`. Note ROUND 4 finding **17**: HEAD's committed
`functions/lib/` is the compiled output of an older commit and `seasonCounters.js` is
untracked, so what git records as "built" is not what runs.

### The four server derivations

All four live in `functions/src/index.ts` and delegate their *rules* to
`functions/src/seasonCounters.ts`, which exists precisely because they used to be
four inline loops no test could reach.

| Function | Line | Source | Bound | Returns on failure |
|---|---|---|---|---|
| `sealedEveningsOf` | 15578 | `clubRecords.eveningsSealed` | 1 doc | `0` |
| `playedEveningsOfSeason` | 15599 | games query + `countSeasonEvenings` | `limit(300)` | **`-1`** (sentinel) |
| `playedEveningsFromGames` | 15655 | games query + `countPlayedEvenings` | `limit(200)` | `0` |
| `completedRoundsOf` | 15695 | `completedRoundsFrom(…)` | 0–1 docs | — |

```ts
// functions/src/index.ts:15695-15708
async function completedRoundsOf(
  groupId: string, roundsAtStart?: number, playedRounds?: number,
): Promise<number> {
  if (typeof playedRounds === 'number' && playedRounds >= 0) {
    return completedRoundsFrom(0, roundsAtStart, playedRounds);
  }
  return completedRoundsFrom(await sealedEveningsOf(groupId), roundsAtStart);
}
```

Three observations a reviewer should hold on to.

1. **The three game-scans use three different windows.** The client reads 200 docs,
   `playedEveningsFromGames` reads 200, `playedEveningsOfSeason` reads 300. For a club
   past 200 terminal games — none exist yet; the largest in the database is this one
   at 23 — season 1's unstamped evenings truncate differently on each surface. The
   doc-comment above `playedEveningsOfSeason` still claims the 200 bound (ROUND 4 **24**).
2. **Only `playedEveningsOfSeason` distinguishes "zero" from "I could not count".**
   Its `-1` is honoured by exactly one caller, the reopen at `index.ts:16925-16934`.
   `playedEveningsFromGames` returns `0` on a failed query, and `0` is
   indistinguishable from a brand-new club — so a transient failure during activation
   seeds season 1 at zero and the club's whole history is silently dropped from its
   first season.
3. **`completedRoundsFrom(0, roundsAtStart, playedRounds)`** deliberately passes `0`
   as the sealed count so that the fallback branch is unreachable when the mirror is
   present; the `clubRecords` read is skipped entirely. Good, but it means the two
   branches of one function are fed by different arities at eight call sites, which is
   how the two-argument `endSeasonNow` bug survived review.

### The frozen fourth and fifth answers

When a season closes, its evening count is copied twice and never recomputed:

* `seasonSummary/{groupId}__{seasonId}.completedRounds` — the archive, written with
  `create()` (`functions/src/seasonRollover.ts:584`), read by the server.
* `seasonCards/{groupId}__{seasonId}.completedRounds` — the list row, read by
  `src/services/seasonHistoryService.ts:82` and rendered by `SeasonHistoryScreen`,
  `SeasonPoster.tsx:201` and the hero tile above.

For a **running** season the same field is synthesised from counter 2 —
`src/services/seasonSummaryService.ts:512`, `completedRounds: num(seasons.playedRounds)`.
So `SeasonSummaryScreen` prints `he.seasonClubRounds(model.completedRounds)`
("`{n} מחזורים שוחקו במועדון בעונה הזאת`" — "{n} evenings were played in the club this
season") from counter 2 while the season runs and from the frozen archive afterwards.
Those are different numbers with the same name, and nothing recomputes the frozen one
if the counter it was copied from was wrong.

### The matrix — מועדון שכחת שושי, today

Group `HhzIwmjMl1i5HSOGHt3p`. Live `seasons` block:
`{enabled:true, currentId:'s2', currentNo:2, count:1, roundsAtStart:10, playedRounds:0,
startedAt:1789679141952 (17.09 21:05Z), reopenedAt:1789727847680 (18.09 10:37Z),
cadence:{type:'rounds', targetRounds:24}}`. `clubRecords.eveningsSealed:10`.
23 terminal games, all `finished`, of which by `eveningPlayState`: **22 `happened`,
1 `notHappened`** (`DTNscolR…`, auto-closed then `playVerified:false`). Stamps: **19
carry none, 3 carry `s1`, 1 carries `s3`** — and `s3` does not exist.

| Question asked of | Expression | **Answer today** | Why |
|---|---|---|---|
| Counter 1 | `clubRecords.eveningsSealed` | **10** | blind to the 12 evenings before 26.08 |
| Counter 2 (the card) | `seasons.playedRounds` | **0** | zeroed when s2 re-opened; no seal since |
| Counter 3, season scope | `getCommunityStats(g, {s2,2}).totalFinished` | **0** | no game carries an `s2` stamp, and `currentNo` is 2 so unstamped games are not admitted |
| Counter 3, lifetime | `…lifetime.totalFinished` | **22** | 22 `happened` in the 200-doc window |
| Counter 3, org. rate (lifetime) | `lifeFinished/(lifeFinished+lifeCancelled)` | **22/23 = 95.7%** | the `notHappened` evening is the denominator's other half |
| `sealedEveningsOf` | — | **10** | |
| `playedEveningsOfSeason(g,'s2',2)` | `countSeasonEvenings` | **0** | |
| `playedEveningsOfSeason(g,'s1',1)` | `countSeasonEvenings` | **22** | 19 unstamped + 3 stamped `s1`, all `happened` |
| `playedEveningsFromGames(g)` | `countPlayedEvenings` | **22** | |
| `completedRoundsOf(g, 10, 0)` (3-arg, every close) | mirror | **0** | |
| `completedRoundsOf(g, 10)` (2-arg fallback) | `10 − 10` | **0** | agrees *by coincidence*: no seal since s2 opened |
| `seasonCards…__s1.completedRounds` | frozen | **22** | |
| `seasonSummary…__s1.completedRounds` | frozen | **22**, with `roundsAtStartOfSeason: 7` | |
| `seasonSummary…__s1.players[*].games` | rollup | max **19** | three evenings never credited attendance |
| `seasonSummary…__s1.totals.rounds` | mini-games | **37** | the other unit, same screen family |

Read that matrix as a reviewer: the club card says **0 מתוך 24 מחזורים**, the stats
screen's "מחזורים" tile on the *current* chip says **0**, on the *all-time* chip says
**22**, on the *עונה 1* chip says **22**, and the archive of season 1 simultaneously
says 22 evenings, 19 games-attended for its best attendee, and 37 משחקונים. Every one
of those is produced by a different expression and only two of them share a source.

The 2-argument fallback reading 0 today is worth dwelling on: it is *right by
accident*. It was 3 on 17.09 (`10 − 7`) and will be wrong again the moment
`eveningsSealed` moves while `roundsAtStart` does not — i.e. on the next evening this
club plays.

One more live consequence: `roundsAtStart (10) === eveningsSealed (10)` means the
next seal computes `seasonEvenings = eveningsSealed + 1 − tableZeroedAt = 1`
(`index.ts:5157`), which is the "first evening of a season" case
(`functions/src/roundSummary.ts:698`). No production `roundSummaries` document
carries `seasonEvenings` at all — the field post-dates the three seals of 16–17.09 —
so that suppression has never actually fired in production (ROUND 4 **29**, and
LEDGER's rank-movement findings).

### `src/utils/eveningPlayed.ts` — the one thing allowed to say "it happened"

248 lines, mirrored byte-for-byte into `functions/src/eveningPlayed.ts` below a
15-line header; `tests/logic/eveningPlayedMirror.test.ts` fails if they drift (though
see LEDGER `mirror-each-ignores-its-own-params`: the `describe.each` declares five
module pairs and the body hard-codes this one, so the other four mirrors are not
actually compared).

**Four states** (`src/utils/eveningPlayed.ts:70-71`):

| State | Meaning | Counts? |
|---|---|---|
| `happened` | it took place | yes, everywhere |
| `notHappened` | cancelled, or an admin said so | no — counts as a cancellation in the organisation rate |
| `unverified` | the sweep closed it, it left no trace, nobody has said | **neither** — excluded from both halves of the rate |
| `pending` | not over yet | nothing to decide |

**Three fields** decide it: `status`, `endedBy` (`'admin' | 'auto'`), and
`playVerified` (`boolean`, set only by an admin resolving an unverified evening).
Everything else feeds `playEvidence`.

```ts
// src/utils/eveningPlayed.ts:186-226 (trimmed)
export function eveningPlayStateWithReason(game) {
  if (!game) return { state: 'pending', reason: null };
  if (game.status === 'cancelled') return { state: 'notHappened', reason: null };
  if (game.status !== 'finished')  return { state: 'pending',     reason: null };
  if (game.playVerified === true)  return { state: 'happened', reason: 'adminVerified' };
  if (game.playVerified === false) return { state: 'notHappened', reason: null };
  if (game.endedBy === 'admin')    return { state: 'happened', reason: 'manualCompletion' };
  const evidence = playEvidence(game);
  if (evidence) return { state: 'happened', reason: evidence };
  if (game.endedBy === 'auto') return { state: 'unverified', reason: null };
  if (isLegacyClose(game)) return { state: 'happened', reason: 'legacy' };
  return { state: 'unverified', reason: null };
}
```

`playEvidence` (`:120-172`) is an ordered list of signals, most direct first: the
kickoff stamp or a live `phase`; closed timer windows (`activeIntervals`); any timer
press (`timerEvents`, `timerAccumulatedMs`, `timerLastStartedAt`); a
server-aggregated mini-game (`committedRoundCount`); uncommitted scoreboard goals or
a positive score; a committed `rotation`. There is deliberately no minimum duration —
"a night that ran four minutes is still a night". A timer-only club can only ever
produce the `timer` signals, and that is not a branch, it is what the list evaluates
to when the other fields cannot exist.

**Why the absence of `endedBy` is load-bearing.** `isLegacyClose` (`:181-183`) is
`game.endedBy !== 'admin' && game.endedBy !== 'auto'`. Every evening closed before
this module shipped carries no `endedBy`, so it falls through to `happened` with
reason `'legacy'` and counts exactly as it always did. That is the entire
backward-compatibility story: no migration, no backfill, and not one historical
number moves. On this club it is 19 of the 22 evenings — including the three with no
timer, no rotation and no goals (06.07, 16.07, 04.08), which have *no evidence
whatsoever* and are `happened` purely because nobody recorded how they ended. Flip the
default and the club loses three evenings and its season-1 archive becomes
unrecomputable.

The corollary is the sharp edge: `endedBy: 'auto'` with no evidence is the *only*
route to `unverified`. Once the sweep started stamping `endedBy`, the system began
declining to guess — and `DTNscolR…` is the first such evening in the database.

**Why nothing may re-derive it.** Before this module there were two answers: the
server credited attendance on `liveMatch.startedAt` alone, the client asked only
`status === 'finished'`. A night the server refused to count appeared in players'
totals and in the club's organisation rate. Today the callers are
`gameService.getCommunityStats` (`:1156`, `:1179`), the game list (`:327`, `:1703`),
the attendance scan (`:867`, `:2107`), `countSeasonEvenings` and
`countPlayedEvenings` (`functions/src/seasonCounters.ts:78`, `:86`), and the seal
trigger's transition gate (`index.ts:5868-5872`, `!wasHappened && isHappened`). The
rule that matters for a reviewer: **if any surface re-derives "did this evening
happen" from a timer field, a goal array or a status string, the three counters can
no longer be reconciled**, because the arbiter would no longer be single.

### The `seasonId` stamp

**Who writes it:** exactly one place, `functions/src/index.ts:5802-5850`, inside
`onGameRosterChanged`.

```ts
const stampStatusChanged = before?.status !== after.status;
const stampRetryPending  = (after as {seasonStampRetry?: boolean}).seasonStampRetry === true;
if (after.groupId && (stampStatusChanged || stampRetryPending) &&
    !(after as {seasonId?: string}).seasonId &&
    (after.status === 'active' || after.status === 'finished')) {
  const gSnap = await groupOnce();
  const seasons = gSnap.data()?.seasons;
  if (seasons?.enabled && seasons.currentId) {
    await event.data!.after.ref.update({ seasonId: seasons.currentId, …clearRetry });
    stampedSeasonId = seasons.currentId;
  }
}
```

**When:** on the transition into `active` (where it belongs) or into `finished` (the
backstop), and on any later write while the `seasonStampRetry` marker is set.
**Write-once from the server:** the `!after.seasonId` guard means the stamp is never
corrected once present. **Not write-once from the client:** `firestore.rules` never
mentions `seasonId` on `/games` — grep it, there are zero hits outside the
`seasonCards`/`seasonSummary` document-id comments — so a member may create a game
pre-stamped with any season string and the server will not overwrite it (LEDGER
`games-seasonid-unpinned`, emulator-proven with four successful writes).

**What an unstamped game means:** season 1. This is one rule with two copies:

```ts
// src/utils/seasonScope.ts:28-34
export function inSeason(game: { seasonId?: string }, season?: SeasonScope): boolean {
  if (!season) return true;                       // a club with no seasons: everything is in scope
  const stamp = typeof game.seasonId === 'string' ? game.seasonId : '';
  return stamp ? stamp === season.currentId : season.currentNo === 1;
}
```

```ts
// functions/src/seasonCounters.ts:53-60
export function eveningInSeason(game: StampedEvening, seasonId: string, seasonNo?: number): boolean {
  const stamp = typeof game.seasonId === 'string' ? game.seasonId : '';
  return stamp ? stamp === seasonId : seasonNo === 1;
}
```

They disagreed by nineteen evenings until 18.09: the client admitted unstamped games
into season 1, the server did not (LEDGER
`unstamped-season-1-rule-disagrees-with-the-server-by-19`).

**What an orphaned stamp means:** nothing, and it is unrepairable.
`games/DTNscolRojYDf0ZmT0sF` carries `seasonId: 's3'` on a club whose `seasons` block
knows only `s2` and whose archive holds only `s1`. It got there because season 3
briefly existed and a reopen at 18.09 10:37:27Z rolled the club back to `s2`, deleting
the `s3` archive and leaving the stamp. Today that evening belongs to no scope: it is
excluded from `s2` by the stamp and from `s1` by having one. It cannot be repaired —
the stamp trigger only writes when the field is absent, finished games are
client-read-only, and no admin tool exists. And when `s2` eventually closes, `s3` is
re-issued with the same id, at which point a night played on 17.09.2026 will be inside
the brand-new season 3 from its first hour (LEDGER
`seasonid-stamp-orphan-unrepairable`, `orphan-season-stamp-absorbed-by-the-next-season-of-the-same-id`).
It is currently harmless to the counters only because it is also `notHappened`.

Two further consequences of the write-once + transition-gated design. For the 191
clubs with seasons off, the stamp is never written, so `!after.seasonId` stays true
forever and, before the transition gate was added, the group document was re-read on
every write to an active or finished game (LEDGER
`group-doc-read-three-times-per-sealed-evening`). And with the gate added, a game that
loses its `groupOnce()` read on *both* transitions has no further transitions to
retry on — hence the `seasonStampRetry` marker, which is itself defeated by the
memoised-rejection bug in `groupOnce()` (ROUND 4 **22**, **23**).

### What is and is not reconciled

`tests/logic/seasonCounterReconciliation.test.ts` (228 lines, added 18.09) is the
assertion that was missing — LEDGER `no-test-reconciles-the-three-counters`, which is
now **partially** discharged. It runs `inSeason`, `eveningInSeason`,
`countSeasonEvenings`, `countPlayedEvenings` and `completedRoundsFrom` over
`tests/fixtures/realClub.ts` — a fixture built from this club's production shape (22
evenings that happened, 19 unstamped, one `unverified`, one cancelled,
`eveningsSealed: 10` against `roundsAtStart: 7`) — and asserts all five return 22. It
passes.

What it does **not** cover, and what the reviewer should treat as still unreconciled:

* The three *writers* are untested. The `increment(1)` at `index.ts:5194` and `:5228`
  are checked only by `tests/logic/sealedCounterAtomicity.test.ts`, which is a regular
  expression run over `index.ts` as a string.
* `gameService.getCommunityStats` itself cannot be loaded by a test — it pulls React
  Native in through the auth layer — so the *scan* is exercised only through its two
  extracted rules, never end to end.
* The 200/300-document bounds, the `-1` sentinel, and the failure paths of all three
  game queries are untested.
* `closeSeason`, `reopenSeason`, `runSeasonRollovers`, `performSeasonClose` and
  `closeSeasonIfRoundsTargetMet` have no functional test at all; their names appear in
  the suite only inside comments (LEDGER `nothing-tests-the-sweep`).
* No test asserts that the *frozen* copies (`seasonCards.completedRounds`,
  `seasonSummary.completedRounds`) equal what the live counters said at the moment of
  the close — which is the one comparison that would have caught both the 3-vs-22
  archive bugs.

Finally, a naming hazard the reviewer will hit within an hour: `playedRounds` means
**evenings** on `groups.seasons` and **mini-games** in
`src/utils/eveningStats.ts:84,164`, where it is "how many mini-games the player
actually took the field for". Same identifier, two units, one repository.
