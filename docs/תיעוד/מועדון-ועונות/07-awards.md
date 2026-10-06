## The nine titles

### Where the code lives

The whole award decision is one pure function in one file, duplicated byte-for-byte on the server:

| file | role | lines |
| --- | --- | --- |
| `src/utils/seasonAwards.ts` | the canonical copy, bundled into the app | 1–247 |
| `functions/src/seasonAwards.ts` | the deployed copy, a 15-line header then an exact transcript of the client file | 1–15 header, 16–262 copy |
| `tests/logic/seasonAwardsMirror.test.ts` | fails the build if the two ever drift | — |
| `functions/src/seasonRollover.ts` | the **only** caller: builds the input rows, calls it, seals the result | 503–560 |
| `src/utils/seasonMedalTier.ts` | grades a won title into bronze/silver/gold/platinum | 1–177 |

Because of the 15-line header, every line number in the server mirror is the client line number **+15**. All line numbers below refer to the client file unless stated.

Nothing on the client ever calls `computeSeasonAwards`. The titles are decided exactly once, inside the close, and written into three places: `seasonSummary/{groupId}__{seasonId}.awards` (the archive), `seasonCards/{groupId}__{seasonId}.winners` (the denormalised card the hall of fame reads, `seasonRollover.ts:715–732`), and one document per winner at `users/{uid}/seasonTitles/{groupId}__{seasonId}__{titleKey}` (`seasonRollover.ts:831–859`). The client file is compiled and shipped, but on the app side it is used only for its `SeasonTitleKey` type and `SEASON_TITLE_KEYS` ordering.

### The input rows, and what actually writes each field

`computeSeasonAwards` takes three arguments and reads nothing else:

```ts
// src/utils/seasonAwards.ts:171
export function computeSeasonAwards(
  players: readonly SeasonPlayerLine[],
  pairs: readonly SeasonPairLine[],
  completedRounds: number,
): SeasonAwards
```

`SeasonPlayerLine` (lines 26–52) is assembled at `seasonRollover.ts:503–522` from the live `communityPlayerStats/{groupId}__{uid}` rollup rows, which are read at `seasonRollover.ts:310–313` before the close wipes them. The provenance of each field is the single most important fact in this section, because it decides which titles a club can win at all:

| field | unit | written by | present for a timer-only club? |
| --- | --- | --- | --- |
| `games` | **evenings** (מחזורים) | `onGameRosterChanged`, `functions/src/index.ts:5901`, `+1` per attendee per sealed evening, no-shows excluded | **yes** |
| `rounds` | **mini-games** (משחקונים) | `commitRoundStats`, `index.ts:14330–14338` | no |
| `goals`, `assists`, `wins`, `cleanSheets` | mini-games | `commitRoundStats` | no |
| `penTaken/penScored/penFaced/penSaved` | kicks | `commitRoundStats` §1c | no |
| `mvpAvg` | evening score 6–10 | derived at `seasonRollover.ts:516–519` from `eveningScoreSum / eveningScoreCount`, both incremented at `index.ts:6378–6379` | yes — but always exactly `6.0` (below) |

`commitRoundStats` is the advanced-mode mini-game commit. A club that runs the plain live timer never calls it. So for the common club, **eight of the nine titles are decided on fields that are permanently zero**, and only `mostLoyal` can ever be awarded. The Hebrew settings copy at `src/i18n/he.ts:2103–2107` acknowledges this in a code comment but gets the number wrong — it says such a club "can never award more than three" (`לא יכול לחלק יותר משלושה`); the correct figure is one.

`SeasonPairLine` (lines 55–62) is built at `seasonRollover.ts:525–537` from `communityPairStats`:

```ts
score: p.assistsAToB + p.assistsBToA,   // directional assists, both ways
together: p.sameTeam,                    // mini-games on the same side
```

### `leaders()` — the single ranking primitive

Every one of the nine goes through the same eight-line function (lines 144–161):

```ts
function leaders<T>(rows, value, id, floor = 0): SeasonAward | null {
  let best = -Infinity;
  for (const r of rows) { const v = value(r); if (v > best) best = v; }
  if (!Number.isFinite(best) || best <= floor) return null;
  const winners = rows.filter((r) => value(r) === best).map(id);
  return winners.length ? { winners, value: best } : null;
}
```

Three properties follow, and they are the whole ranking policy:

1. **Ties are shared, always.** Every row on the maximum is returned. There is no uid tie-break anywhere in this file — deliberately, per the header comment at lines 18–20. This is the opposite of the club-screen leaders (see below), and it is why a single sealed season in production carries a title with seven holders.
2. **The floor is strict (`best <= floor` → `null`).** With the default `floor = 0`, "everyone on zero" yields *no title*, not a winner on zero. `null` is written into the archive and rendered as `'לא חולק'` ("not awarded", `he.ts:2496`) in a fixed nine-slot cabinet.
3. **Equality is exact float equality.** The comment at lines 157–158 states this is intentional so 8.3746 and 8.3751 are two numbers. For integer titles this is harmless. For `mvp`, which is a quotient of floats, it means a shared MVP is essentially unreachable for real data (`21.6/3 = 7.199999999999999`), while the *degenerate* sentinel case ties perfectly — see below.

### The nine, one by one

`SEASON_TITLE_KEYS` (lines 83–93) fixes both the type union and the render order of the medal cabinet; `SeasonHistoryScreen.tsx:143–146` chunks it three-per-shelf, so a title nobody won is drawn as an empty socket rather than closing the gap.

| key | Hebrew (`he.ts:34–43`) | measures | field read | unit | floor | eligible set |
| --- | --- | --- | --- | --- | --- | --- |
| `topScorer` | כתר השערים | goals scored | `p.goals` | mini-game goals | `> 0` | eligible players |
| `topAssister` | כתר הבישולים | assists | `p.assists` | mini-game assists | `> 0` | eligible players |
| `mvp` | כתר העונה | mean evening score | `p.mvpAvg` | 6–10 score | `> 6` (`MVP_SCALE_FLOOR`, line 141) | eligible players |
| `topWinner` | כתר הניצחונות | mini-games won | `p.wins` | mini-games | `> 0` | eligible players |
| `mostLoyal` | כתר ההתמדה | evenings attended | `p.games` | **evenings** | `> 0` | eligible players |
| `cleanSheetKing` | כתר השער הנקי | mini-games whose side conceded nothing | `p.cleanSheets` | **mini-games** | `> 0` | eligible players |
| `penaltyKing` | כתר הפנדלים | conversion **rate** | `penScored/penTaken` | ratio 0–1 | `> 0` | eligible **and** `penTaken >= minAttempts` |
| `penaltyKeeper` | כתר העצירות | save **rate** | `penSaved/penFaced` | ratio 0–1 | `> 0` | eligible **and** `penFaced >= minAttempts` |
| `deadlyDuo` | הצמד הקטלני | assists exchanged between two players | `assistsAToB + assistsBToA` | assists | `> 2` (`MIN_DUO_ASSISTS - 1`, line 244) | pairs where **both** halves are eligible |

Every one of them shares ties; there is no per-title tie-break to document, because there are none.

Two units are worth flagging for the reader, because the product's own vocabulary collides here. `mostLoyal` counts **evenings** and is rendered `'{n} מחזורים'` (`he.ts:2443-2444`). `cleanSheetKing`, `topWinner`, `topScorer`, `topAssister` count **mini-games** or events inside them. The same season card therefore prints "19 מחזורים" beside "13 שערים נקיים" where the 19 counts evenings and the 13 counts mini-games out of 37 — two denominators, neither shown.

`deadlyDuo` is the only title whose id is not a uid: `leaders` is given `` `${p.a}__${p.b}` `` (line 243), and the title-write loop at `seasonRollover.ts:837` splits that key back apart to place one document on each of the two profiles, skipping any half whose id starts with `guest:`.

**Defect — `deadlyduo-together-is-collected-and-never-read`.** `SeasonPairLine.together` (line 61, "Rounds the two were on the same side") is populated at `seasonRollover.ts:536` from `p.sameTeam` and is never read by `computeSeasonAwards` — `grep -n together src/utils/seasonAwards.ts` returns exactly one hit, the field declaration. The partnership-volume gate the field exists for was never written. A pair that played together twice and exchanged three assists outranks a pair that played together fifteen times and exchanged three, and the code has the number to distinguish them sitting unused in the same object.

### The eligibility gate

```ts
// lines 102–117
export function eligibilityThreshold(completedRounds: number): number {
  return Math.ceil(Math.max(0, completedRounds) / 2);
}
export function isEligible(line: Pick<SeasonPlayerLine, 'games'>, completedRounds: number): boolean {
  return line.games >= eligibilityThreshold(completedRounds);
}
```

Applied once at line 190 (`const eligible = players.filter(...)`) and inherited by all nine titles. Pairs inherit it transitively at lines 195–198: both halves must clear it on their own, so a regular and a one-night guest cannot take the duo between them.

A zero-length season short-circuits before any of this (lines 184–189) and returns nine `null`s, because `eligibilityThreshold(0) === 0` would otherwise open every gate.

The user-facing promise is at `he.ts:2416`:

> `'לא חולקו תארים בעונה הזאת. תואר ניתן רק למי שהגיע לפחות לחצי מערבי המשחק של העונה…'`
> *"No titles were awarded this season. A title goes only to whoever attended at least half of the season's game evenings."*

**Now the subtlety that makes that sentence false.** The `completedRounds` argument is *not* the season's length. The caller computes it at `seasonRollover.ts:556–559`:

```ts
const seasonEvenings = awardsDenominatorOf(
  awardLines.map((l) => l.games),
  args.completedRounds,
);
const awards = computeSeasonAwards(awardLines, awardPairs, seasonEvenings);
```

and `awardsDenominatorOf` (`seasonRollover.ts:133–139`) is:

```ts
export function awardsDenominatorOf(attendances: readonly number[], fallback: number): number {
  if (attendances.length === 0) return Math.max(0, rowNum(fallback));
  return Math.max(0, ...attendances.map((g) => rowNum(g)));
}
```

The denominator is **the maximum attendance of any single player**, and the true season length (`args.completedRounds`, ultimately `clubRecords.eveningsSealed` minus the season's starting offset, via `completedRoundsOf` at `index.ts:15695–15708`) is used only as a fallback when the club has no player rows at all. The stated rationale, written out at `seasonRollover.ts:114–121`, is a units/era argument: per-player `games` has been counted since 22.06 while the sealed-evening counter was only born on 25.08, so comparing a numerator from one era against a denominator from the other admitted far too many players. `max(games)` is at least in the same unit and the same era as the numerators it is compared against.

The consequence is algebraic and unconditional. Let `D = max_i(games_i)` and let `p*` be a player attaining it.

* `isEligible(p*, D)` is `games_{p*} >= ceil(D/2)`, i.e. `D >= ceil(D/2)`, which is true for every `D >= 0`. **The top attendee can never fail the gate.**
* `mostLoyal = leaders(eligible, p => p.games)` returns `best = max` over the eligible set. Since `p*` is always in that set, `best = D`. **`awards.mostLoyal.value === D` identically, for every attendance distribution.**

So the gate's denominator is, by construction, the value of one of the titles it gates — and it is a *different number* from the season length that the same close writes to `seasonSummary.completedRounds` (line 625) and `seasonCards.completedRounds` (line 767).

**On the real archive.** `seasonSummary/HhzIwmjMl1i5HSOGHt3p__s1`, read live:

```
players[*].games = { 1IdtNEjb: 19, alsobLSA: 18, K5rSGB4J: 18,
                     B5KpYO4I: 18, CEkRfDs2: 18, YIZlKWBv: 18, JoLFRxFr: 17 }
completedRounds  = 22
awards.mostLoyal = { winners: ['1IdtNEjb…'], value: 19 }
```

`D = 19`; `mostLoyal.value = 19`; the season was 22 evenings long. The gate that the copy calls "half the season" was `games >= ceil(19/2) = 10`, i.e. **10 of 22 = 45%**. All seven members cleared it either way here, so on this club the gate's membership did not change — but a title did, which is the point below.

**Defect — `eligibility-denominator-is-max-attendance`.** Two numbers describing "how long was this season" live in one archive document (19 and 22) and neither is labelled as the other's alternative; `awardsDenominator` is no longer published anywhere (see below), so a reader of the sealed archive cannot tell which denominator the titles were decided on without re-deriving `max(games)` by hand.

**Defect — `loyalty-crown-is-structurally-platinum` (fixed at HEAD, and worth the reader's attention as a worked example of the identity).** For about a day, `seasonRollover.ts` wrote `awardsDenominator: seasonEvenings` onto the season card and `SeasonHistoryScreen.tsx` graded the loyalty medal as `medalTier('mostLoyal', w.value, season.awardsDenominator ?? season.completedRounds)`. Because `w.value === awardsDenominator` identically, the ratio was `1.0` for every season of every club, and the attendance scale's platinum stop (`>= 1`) fired unconditionally: silver and gold became unreachable code. Both the field and the read are gone at HEAD — `SeasonHistoryScreen.tsx:172` is now `medalTier(key, w.value, season.completedRounds)` and `seasonRollover.ts:786–800` carries a long comment explaining why the field must not come back. The production `seasonCards/HhzIwmjMl1i5HSOGHt3p__s1` predates the field and does not carry it. **Nothing recomputes a sealed season**, so this is history rather than live damage — but the *gate* still uses `max(games)`, which is the same identity in the place it was not removed from.

### The volume gates

```ts
// lines 126–128
export function minPenaltyAttempts(completedRounds: number): number {
  return Math.min(5, Math.max(2, Math.ceil(Math.max(0, completedRounds) / 10)));
}
```

Two attempts minimum, one more per ten "rounds", capped at five. Because the argument is `max(games)` rather than the season length, this gate moves with the club's best attendee. **On production s1 this flipped a real title.**

| denominator | `minPenaltyAttempts` | qualifying kickers | rates | `penaltyKing` |
| --- | --- | --- | --- | --- |
| `max(games)` = **19** (what ran) | 2 | alsobLSA 2 taken, K5rSGB4J 3 taken | 2/2 = **1.000**, 2/3 = 0.667 | **הלן צברי, value 1.0** |
| `completedRounds` = 22 | 3 | K5rSGB4J only | 2/3 = 0.667 | Nofar Tzabari, value 0.667 |

The sealed archive holds `penaltyKing: { winners: ['alsobLSA…'], value: 1 }` — reproducing the stored result requires 19, not 22, which is independent confirmation that the denominator in use is the maximum attendance. (`penaltyKeeper` is unaffected: at both 2 and 3 the qualifying keepers are the same three, and alsobLSA's 3 saves from 3 faced wins either way.)

**Defect — `penalty-titles-crowned-on-two-kicks`.** A season crown at a perfect 100% off **two kicks** is what the archive actually contains, and `medalTier('penaltyKing', 1.0, …)` grades it platinum (`RATE_STEPS = [0.7, 0.85, 1]`, `seasonMedalTier.ts:70`). The poster renders `'100% הצלחה בפנדלים'` (`he.ts:2461`).

**Two methods, one Hebrew name.** The club screen crowns מלך הפנדלים / כתר הפנדלים from a completely different algorithm. `src/utils/penaltyStats.ts:132–162` ranks by a **Wilson score lower bound** (`wilsonLowerBound`, lines 120–128, z = 1.96):

```ts
// penaltyStats.ts, pickLeader: rank by Wilson desc, then count, then attempts, then uid asc
score: wilsonLowerBound(count, attempts)
```

Its doc comment states the design intent explicitly: *"8/10 (0.49) outranks 1/1 (0.21), so a one-shot 100% no longer beats a proven high-volume scorer."* The season title does the exact opposite — a raw rate behind a hard floor, where 2/2 beats 2/3 and beats 8/10. On the same seven players, the club card and the season medal can name different people for the same crown, and since `he.ts:1370` points `communityStatsPenaltyKing` at the *same* `TITLE.penaltyKing` string, the two answers are labelled identically. There is also a second inconsistency in the same pair: `penaltyStats.pickLeader` breaks ties deterministically (`cand.userId < best.userId`, line 155) and returns exactly one leader, while `leaders()` shares. One crown, two rankers, two tie policies.

The same split exists for clean sheets. **Defect — `cleansheetking-ranks-on-count-while-the-club-table-ranks-on-rate`.** The season title is `leaders(eligible, p => p.cleanSheets)` — a raw count. The club's efficiency tab shows a sortable `cleanSheetPct` column (`CommunityStatsTable.tsx:251–252`) computed as `cleanSheets / csRounds` (`efficiencyStats.ts:80–83`), and the club's leaders card uses yet a third function, `leaderBy` (`CommunityStatsScreen.tsx:118–132, 463`), which is a strict-`>` scan that silently keeps the **first** row on the maximum — no shared ties, no floor beyond zero. On s1 the three disagree:

| player | cleanSheets | csRounds | rate |
| --- | --- | --- | --- |
| alsobLSA (הלן צברי) | **13** | 17 | 76.5% |
| 1IdtNEjb (מתן לוי) | 12 | 15 | 80.0% |
| YIZlKWBv (Eliran Tzabari) | 11 | 13 | **84.6%** |

The season crowned הלן צברי on the count; the club's own rate column puts Eliran Tzabari top. Both are labelled `TITLE.cleanSheetKing` = `'כתר השער הנקי'`.

### The MVP

`mvp` is the mean of a player's *evening* scores: `mvpAvg = eveningScoreSum / eveningScoreCount` (`seasonRollover.ts:516–519`), with `0` substituted when the count is zero. The per-evening score comes from `eveningScoreServer` (`functions/src/eveningScoreCore.ts:34–65`), whose last line is:

```ts
if (gamesPlayed <= 0) return 6.0;             // line 43 — the sentinel
…
const score = 6 + (weighted / 10) * 4;
return Math.round(Math.min(10, Math.max(6, score)) * 10) / 10;   // line 64 — clamp to [6,10]
```

Three facts follow, and together they are the worst defect in this section:

1. The scale's **floor is 6.0, not 0** — a genuinely bad evening cannot score below 6.
2. **6.0 is also the sentinel** returned when `gamesPlayed <= 0`. `gamesPlayed` here is the player's *mini-game* count for the evening (`index.ts:6288`, `e.rounds`), which is zero for every evening a club runs on the plain timer. So the value that means "we recorded nothing about this player tonight" is numerically identical to the bottom of the scale.
3. **The sample size is never checked.** The eligibility gate tests `games` (evenings attended); `eveningScoreCount` is a different counter that only started incrementing when the accumulator shipped. A player with 19 attended evenings and one scored evening is compared on a mean of one.

**Defect — `mvp-title-held-by-the-entire-club`.** With the original `floor = 0`, the sentinel cleared the floor and every eligible player tied at exactly 6.0. Production s1 is exactly that:

```
eveningScoreSum / eveningScoreCount  =  18/3, 18/3, 18/3, 18/3, 18/3, 12/2, 12/2  →  6.0 × 7
awards.mvp = { value: 6, winners: [ …all seven uids… ] }
```

Seven of the club's seven members hold כתר העונה at the value that means "nothing was recorded". A collection-group query over `seasonTitles` across the entire database returns **14 documents, of which 7 are `mvp` at value 6** — half of every season title ever awarded in this product is the no-data sentinel, shared by an entire club. Note also that `eveningScoreCount` is 2 or 3 against `games` of 17–19: even setting the sentinel aside, the "season average" was a mean over the last two or three evenings of a 22-evening season.

At HEAD this specific outcome is closed, by one argument added at line 221:

```ts
const MVP_SCALE_FLOOR = 6;                               // line 141
mvp: leaders(eligible, (p) => p.mvpAvg, (p) => p.uid, MVP_SCALE_FLOOR),   // line 221
```

`best <= 6` now returns `null`, so a club whose evenings are all sentinels awards no MVP at all. Two residual problems remain, and neither is addressed:

* The sealed archive is not recomputed. `seasonSummary…__s1.awards.mvp`, the card's `winners`, and the seven `users/*/seasonTitles/*__mvp` documents all still exist in production and still render.
* A player with a *single* real mini-game evening (score, say, 6.3) and eighteen sentinel evenings averages `(6.3 + 18×6.0)/19 = 6.016` — above the floor — and takes the title over teammates who are all flat 6.0. The floor removes the degenerate all-tie; it does not make the metric a season average of anything.

### The medal tier

`src/utils/seasonMedalTier.ts` grades a *won* title's value into one of four metals. It is a pure presentation layer: nothing in the award computation reads it, and the tier is not stored — `SeasonHistoryScreen.tsx:172` recomputes it on every render from the card's `value` and `completedRounds`.

`SCALE` (lines 57–67) is a **total** `Record<SeasonTitleKey, Scale>`, deliberately, so a tenth title is a compile error rather than a silent bronze. Four kinds:

```ts
topScorer:      { kind: 'count', steps: [8, 16, 28] }
topAssister:    { kind: 'count', steps: [6, 12, 22] }
topWinner:      { kind: 'count', steps: [10, 20, 34] }
cleanSheetKing: { kind: 'count', steps: [5, 11, 20] }
deadlyDuo:      { kind: 'count', steps: [5, 11, 20] }
penaltyKing / penaltyKeeper: { kind: 'rate' }        // RATE_STEPS  = [0.7, 0.85, 1]
mostLoyal:      { kind: 'attendance' }               // ATTENDANCE_STEPS = [0.6, 0.8, 1], value / completedRounds
mvp:            { kind: 'eveningScore' }             // MVP_STEPS = [6.6, 7.6, 8.8]
```

`step()` (lines 92–97) is `>=` at every stop, so `1.0` on a rate is platinum and `value === completedRounds` on attendance is platinum. `medalTier` guards `completedRounds <= 0 → 'bronze'` for the attendance scale only (line 120).

The count steps are absolute constants tuned against nothing documented, and they are graded against **mini-game** totals. On a club that plays ~37 mini-games a season, `topWinner`'s platinum at 34 wins and `topScorer`'s at 28 goals are not reachable; the season's entire club goal total was 27.

`MVP_STEPS` carries an honest comment (lines 72–86) admitting the original `[6.5, 7.5, 8.5]` was written against an assumed 1–10 scale that the clamp makes impossible, and that a "correction" to `[7, 8, 9]` made the title *harder* to lift off the floor. The current `[6.6, 7.6, 8.8]` are quarters of the real `[6, 10]` range; the club's own evening-standings leader sits at 6.93, which is silver. The ledger's `mvp-medal-can-never-leave-bronze` finding referred to the earlier constants.

`titleStreak` (lines 141–177) counts consecutive seasons with the same holder set, walking towards older seasons and stopping at a gap in `season.no`. It matches **by display name**, joined on `U+0000`, because a sealed `SeasonWinner` is `{key, names, value}` and carries no uid — a player who renames themselves silently ends their own streak, and the code says so in its comment rather than pretending otherwise. No production club has closed two seasons, so this path has never run against real data.

### The one sealed season, end to end

Everything above, applied to `HhzIwmjMl1i5HSOGHt3p__s1` (מועדון שכחת שושי), season 1, 22 evenings, 37 mini-games, 7 members:

| title | winner(s) | value | medal at HEAD | note |
| --- | --- | --- | --- | --- |
| topScorer | הלן צברי | 10 goals | silver (8/16/28) | 37% of the club's 27 goals |
| topAssister | Nofar Tzabari | 5 assists | bronze (6/12/22) | club total 13 |
| mvp | **all seven members** | 6.0 | bronze | the sentinel; would be `null` at HEAD |
| topWinner | Lioz Madar | 13 wins | silver (10/20/34) | mini-games, not evenings |
| mostLoyal | מתן לוי | 19 evenings | gold (19/22 = 86%) | was platinum for one day; `D` = 19 |
| cleanSheetKing | הלן צברי | 13 | gold (5/11/20) | rate ranking would name Eliran Tzabari |
| penaltyKing | הלן צברי | 1.000 | platinum | **two kicks**; flips to Nofar at `D` = 22 |
| penaltyKeeper | הלן צברי | 1.000 | platinum | three faced, three saved |
| deadlyDuo | — | — | empty socket | best pair exchanged 2 directional assists, floor is `> 2` |

Eight of nine awarded; one player holds four of the eight; one title is held by the entire club. `seasonCards/…__s1.winners` carries all eight with names frozen at close time, and fourteen `seasonTitles` documents were written across seven profiles.
