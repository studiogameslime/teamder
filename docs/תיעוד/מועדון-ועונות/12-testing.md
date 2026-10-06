## What is tested, what is not, and the open questions

### How the suites are run, and by whom

There are two independent test surfaces and no automation connecting them to anything.

The unit suite is Jest. `jest.config.js` is five lines:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }] },
};
```

`roots` is `tests/` only, and the transform matches `.ts`/`.tsx`. The rules suite under `tests/rules/` is written in `.mjs` against Node's built-in `node:test` runner, so `npx jest` does not see a single one of its files. Running `npm test` at the repo root reports a green run while 146 security assertions have not been executed.

The rules suite is its own npm project (`tests/rules/package.json`) with its own `node_modules`:

```json
"test": "node --test --test-concurrency=1 --test-reporter=spec *.test.mjs"
```

`--test-concurrency=1` is load-bearing. Five of the eight suites (`firestore`, `antiHijack`, `clubIsolation`, `oldClientCompat`, `roundHistoryAccess`) share `projectId: 'demo-soccer'` and each calls `clearFirestore()` in its setup; run in parallel they wipe each other's fixtures. `seasonSummary.test.mjs` is one of the three that took its own project id (`rules-season-summary`), so the seasons rules tests are at least isolated from that hazard.

There is **no CI**. There is no `.github/`, no workflow file, no `.husky/`, and no non-sample hook in `.git/hooks`. Nothing runs Jest, the rules suite, or `tsc` unless a person types the command. `npm run typecheck` (`tsc --noEmit`) is clean at HEAD for both the app and `functions/`, but Metro — the React Native dev server — does not typecheck, which is how three seasons defects of exactly the class a compiler catches reached the production `errors` collection on 18.09 from the developer's own emulator:

| fingerprint | message | surface |
|---|---|---|
| `toxitz` | `_he.he.seasonsCardOfTarget is not a function (it is undefined)` | `SeasonsCard` |
| `1ytrraf` | `Cannot read property 'totalFinished' of undefined` | `CommunityStatsScreen` |
| `3lov71` | `Property 'winsPlaceIsFactual' doesn't exist` | `assistantInsightsService` |

All three are `appVersion 1.1.5` with a `10.0.2.2:8081` Metro bundle URL, so they are dev-emulator reports rather than store users — but they are the only seasons entries the error inbox has ever held, and they are all "a symbol that did not exist yet". The production `errors` collection holds 21 documents in total and **not one of them comes from the seasons backend**, which is a fact about the backend's error reporting rather than about its correctness: the hourly sweep's failure path is `console.log`, and only a `throw` reaches the inbox.

### The seasons unit suite, file by file

Twenty-three Jest files touch seasons; together they are 362 assertions and they all pass today (2.7s). Every one of them was written between 13.09 and 18.09.2026 — that is, *after* the feature shipped in 1.1.7 on 16.09 and mostly *during* the audit. Season 1 of the only club that runs seasons was closed by this code at `2026-09-17T16:12:06Z`, at which point the close had no functional test of any kind.

| File | n | What it pins | What it leaves free |
|---|---|---|---|
| `seasonCounterReconciliation.test.ts` | 38 | All four answers to "how many מחזורים" agree on the real club: the client games scan, `inSeason`, the counter subtraction, and `countSeasonParticipants` | One club's fixture. A second club shape is not exercised |
| `seasonMedalTier.test.ts` | 40 | The 60/80/100% steps, the 6–10 MVP range, all nine titles gradable, `titleStreak` | Nothing renders a medal in a test |
| `seasonAwards.test.ts` | 32 | Eligibility `ceil(D/2)`, penalty floors, ties shared, the MVP scale floor, the nine-key set | The *choice* of `D` — the denominator is an argument here |
| `seasonPersonal.test.ts` | 29 | `buildPersonalSeason`: rates, ranks, peer orientation, guest exclusion, three distinct rival rows | `seasonSummaryService`, which chooses the inputs |
| `seasonCardVariant.test.ts` | 22 | full / card / ribbon / void classification; a timer-only club is never void; `heroWinner`, `heroSeasonId` | The screen that renders the variant |
| `seasonLifecycle.test.ts` | 22 | `isSeasonDue`, the quiet seam, rounds remaining, mid-season retarget validation, month clamping | The client copy only; the server has its own |
| `seasonActivation.test.ts` | 21 | `planActivation` for every cadence × choice × history combination, including the pre-picker client | The settings screen that builds the input |
| `seasonDates.test.ts` | 21 | Month-end clamping, leap years, club-midnight vs UTC, three years of arithmetic | — |
| `seasonCloseNumbers.test.ts` | 20 | `windBackRow`, `restoreRow`, `seasonPairKey`, `awardsDenominatorOf`, `sealedCardEvenings` | Which documents `closeSeason` reads, in what order, in which batch |
| `eveningPlayedMirror.test.ts` | 17 | Five client/server mirror pairs: byte identity **and** differential execution | The deployed bundle |
| `seasonSweep.test.ts` | 12 | `seasonFinishLine` and `isSeasonDue` from `functions/src/seasonCounters.ts` | The sweep itself, `clubIsQuiet`, `performSeasonClose` |
| `seasonOpensWithOffset.test.ts` | 11 | All five season-opening object literals stamp `roundsAtStart` and `playedRounds` | Whether the values are right |
| `groupSeasonsReader.test.ts` | 10 | The client deserializer keeps every field the server writes, including `targetHistory` | — |
| `groupHydrate.test.ts` | 10 | A failed club refresh does not empty the store | — |
| `seasonRolloverFields.test.ts` | 9 | `__seasonFields` — the exact list of counters a close zeroes, and their pairings | That the list is applied |
| `seasonArchiveTable.test.ts` | 8 | `parseSeasonTable` over a hand-copied archive fixture | Key-set parity with the writer |
| `seasonChoices.test.ts` | 7 | `lastClosedSeason`, the season picker order | — |
| `seasonScopedStats.test.ts` | 7 | `inSeason` — including "unstamped means season 1" — over the real club's documents | — |
| `seasonAwardsMirror.test.ts` | 6 | The title rules agree client/server at denominators 0, 1, 2, 13, 19, 20, 22, 40 | — |
| `seasonCadenceClean.test.ts` | 5 | Every cadence literal nulls the other kind's fields and declares its `type` | — |
| `sealedCounterAtomicity.test.ts` | 5 | Neither evening counter is ever written as `x + 1` | The race itself |
| `seasonCardParticipants.test.ts` | 5 | `countSeasonParticipants` on a timer-only club | — |
| `seasonSeedHistory.test.ts` | 5 | `seasonSeed` starts a season at zero regardless of club history | — |
| `allTimeTable.test.ts` | 9 | Live season + archives merge; coverage denominators are dropped, not invented, when one side never measured | — |

The fixture that most of the newer files share, `tests/fixtures/realClub.ts`, is a hand-copied snapshot of the one club that runs seasons, taken on 18.09.2026: 22 evenings of which 19 carry no `seasonId`, one `unverified` evening, one cancelled, `eveningsSealed: 10`, `roundsAtStart: 7`, a sealed card of `completedRounds: 22` beside `totals.rounds: 37`. Its own header explains why it exists — every fixture before it described a club that does not exist. Nothing re-verifies it against production; it will drift silently.

### Measured coverage of the server modules

```
File                    | % Stmts | % Branch | % Funcs | Uncovered Line #s
------------------------|---------|----------|---------|-------------------
 functions/src          |   45.14 |    33.99 |   72.41 |
  seasonActivation.ts   |   97.22 |      100 |     100 | 179
  seasonAwards.ts       |   92.45 |    83.33 |   87.09 | 249-250
  seasonCounters.ts     |    97.5 |    97.14 |     100 | 75
  seasonDates.ts        |   85.24 |    69.23 |   88.88 | 74-76,128-135
  seasonParticipants.ts |     100 |      100 |     100 |
  seasonRollover.ts     |   12.62 |     5.50 |   28.00 | 308-1026, 1072-1252
  seasonSeed.ts         |     100 |      100 |     100 |
```

`seasonRollover.ts` is 1,253 lines. The uncovered ranges are exactly `closeSeason` (declared at line 307) and `reopenSeason` (line 1067). Everything the file has a test for is the arithmetic helpers above them — `windBackRow` (62), `restoreRow` (84), `seasonPairKey` (104), `awardsDenominatorOf` (133), `sealedCardEvenings` (155) and the `__seasonFields` list (1034). The two functions that actually mutate a club's history run 5.5% branch-covered.

`functions/src/index.ts` is 17,081 lines and is **never imported by any test**. The seasons lifecycle occupies roughly lines 15,405–17,081 of it, plus the stamp block at 5,802–5,850, the push fan-out at 15,333–15,367 and the notification body at 1,101. All of it is reached only as text.

### The MIRROR tests, and what they cannot see

Cloud Functions cannot import from the app's `src/`, so six modules exist twice. Each server copy carries a marker line and is required to be byte-identical below it:

```ts
const MARKER =
  '// ---- everything below this line is a copy of the client file ----';
const copied = server
  .slice(server.indexOf(MARKER) + MARKER.length)
  .replace(/^\n+/, '')
  // Cloud Functions have no `@/` alias, so that one line is allowed to
  // differ — and ONLY that one.
  .replace(/from '\.\/seasonDates'/g, "from '@/utils/seasonDates'");
expect(copied).toBe(client);
```

`eveningPlayedMirror.test.ts:32` declares five pairs — `eveningPlayed`, `seasonParticipants`, `seasonSeed`, `seasonDates`, `seasonActivation` — and `seasonAwardsMirror.test.ts:23` covers the sixth, `seasonAwards`.

Two defects in this mechanism were found by the audit and both are fixed at HEAD, but the second is the one a reviewer should understand:

1. **`mirror-each-ignores-its-own-params` (LEDGER).** The `describe.each` table declared five module pairs and the body hard-coded `src/utils/eveningPlayed.ts`. Four of the five mirrors were never compared; the suite reported ten green assertions that were two assertions run five times. The comment at lines 47–55 now records this.

2. **Byte identity is not evidence.** Two identical copies of a *wrong* rule pass a diff. Until 18.09 nothing in either file ever *executed* the server copy, so the server half of six rules had no test at all — only a diff. Both files now also load both modules and run them side by side: 480 evening shapes through `eveningPlayStateWithReason`, every club-document shape through `seasonSeed`, three years of month ends through `seasonDates`, every settings-screen submission through `planActivation`, and the real club's seven rows through `computeSeasonAwards` at eight different denominators.

The limitation that remains is structural and the reviewer should not overlook it. **The mirror tests read `functions/src/`. Production runs `functions/lib/`**, the `tsc` output, which is gitignored (`.gitignore:58`). Nothing in the repo compares the deployed bundle against either copy. This is not hypothetical: ROUND4 #1 established that both 1.1.9 store binaries were built from commit `4de80d0` while the backend they talk to was HEAD — twenty client files and +2,636 lines apart — and the audit's only method for checking what was actually deployed was downloading the function bundles and grepping them. A green mirror run proves `src/utils/x.ts` and `functions/src/x.ts` agree in the working tree. It says nothing about what the user's phone and the running function are doing.

A third limitation: agreement is not correctness. `seasonAwardsMirror.test.ts:65` runs the real club's sealed season through both copies and asserts they produce the same answer. They do. The answer they agree on gave שחקן העונה ("player of the season") to all seven members of the club at a value of 6.0, which is the evening-score sentinel for "no mini-games were recorded". Both halves were wrong in perfect agreement.

### The SOURCE-GREP guards

Three rules cannot be unit-tested from a Node process — a Firestore merge into a nested map, a read-modify-write race, and a field missing from one of five inline object literals. The repo guards them by reading the backend as a *string* and asserting its shape. The three guards are `seasonCadenceClean.test.ts`, `seasonOpensWithOffset.test.ts` and `sealedCounterAtomicity.test.ts`.

As shipped, all three read exactly one file — `functions/src/index.ts` — with hand-written regular expressions that terminated on indentation. The cadence guard's original matcher was:

```
/(?:cadence|next) = \{[\s\S]*?\n {4,6}\};/
```

Two failure modes follow directly. **Indentation-sensitive**: the `\n {4,6}\};` terminator means a literal nested one level deeper, or written on a single line, is simply not matched. **Single-file**: a writer moved into `seasonRollover.ts` — or into a file created tomorrow — is invisible. Both are the same flaw: *the guard describes where the code is today rather than what it must not do*. And a guard that matches nothing asserts nothing while reporting green: the cadence file reports four passing tests over an empty array just as happily as over four literals.

`tests/fixtures/serverSource.ts` (added 18.09) replaces both properties. `serverFiles()` walks all of `functions/src/`, skipping `node_modules` and `lib`, and returns each file's text with a repo-relative path so a failure names something greppable. `objectLiterals(marker)` finds the opening brace after the marker and then **counts braces** to the close, so indentation is not part of the rule:

```ts
const open = file.text.indexOf('{', m.index + m[0].length - 1);
let depth = 0, i = open;
for (; i < file.text.length; i += 1) {
  if (file.text[i] === '{') depth += 1;
  else if (file.text[i] === '}') { depth -= 1; if (depth === 0) break; }
}
```

`codeLines()` strips comments so a guard looking for a forbidden write does not fire on the comment explaining why it is forbidden — and, more importantly, is not *satisfied* by one.

What is still fragile, and a reviewer should treat these as weaker than the tests around them:

- **The guards are count assertions.** `expect(cadenceLiterals.map(c => c.where)).toHaveLength(4)` and `expect(blocks.map(b => b.where)).toHaveLength(5)`. A sixth season-opener fails the count, which is the intent — but it fails on arithmetic, not on behaviour, and the fix ("update the number") is one character away from the fix that defeats the guard.
- **They match identifiers and string literals.** `/type: 'rounds'/`, `/currentId:/`, `/playedRounds:\s*eveningsSealed/`. Renaming a field, or building the literal by spread from a helper, quietly removes code from the guard's view. `seasonOpensWithOffset.test.ts` already has to special-case `...seasonSeed(` for this reason.
- **`sealedCounterAtomicity.test.ts:63` is the only guard that proves it can see its own subject** ("and the guard is reading the file the seal is actually in"). The other two do not. That assertion is the pattern the other guards need.
- They read `functions/src/`, with the deployment gap described above.

### The honest inventory of untested code

| Path | Where | Functional test |
|---|---|---|
| `runSeasonRollovers` — the hourly sweep | `index.ts:16055` | **none** |
| `clubIsQuiet` — the close permission gate | `index.ts:15466` | **none** |
| `performSeasonClose` — archive + titles + push + lifecycle | `index.ts:15790` | **none** |
| `closeSeasonIfRoundsTargetMet` — the on-seal close | `index.ts:15943` | **none** |
| `closeSeason` — the wipe and the archive | `seasonRollover.ts:307` | **none** (helpers only) |
| `reopenSeason` — the undo | `seasonRollover.ts:1067` | **none** (helpers only) |
| The `seasonId` stamp trigger + `seasonStampRetry` marker | `index.ts:5802` | **none** |
| `playedEveningsOfSeason` / `completedRoundsOf` | `index.ts:15599`, `15695` | **none** |
| The six callables (`enableClubSeasons` 16286, `disableClubSeasons` 16613, `updateSeasonTarget` 16627, `reopenLastSeason` 16848, `endSeasonNow` 16971) | `index.ts` | **none** |
| `onNotificationCreated` and the `seasonSummary` push body | `index.ts:1874`, `1101` | **none** |
| The push fan-out | `index.ts:15333–15367` | **none** |
| `seasonSummaryService.ts` (636 lines), `seasonService.ts` (274) | `src/services/` | **none** |
| `SeasonsSettings.tsx` (1,150), `SeasonSummaryScreen.tsx` (951), `SeasonHistoryScreen.tsx` (699), `SeasonPoster`, `SeasonShareCard`, `SeasonsCard`, `SeasonMedal`, `SeasonConfirmSheet`, `SeasonTitlesShelf` | `src/screens`, `src/components` | **none** — there is no component-render test in this repo at all |

Stated plainly, because it is the single most important sentence in this section: **the only unattended path in the app that destroys production data has no functional test.** The phrase is the codebase's own, from the comment on the cron that carries it (`index.ts:13589`):

```ts
export const cronEvery60Min = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'Asia/Jerusalem',
    // The default is 60 seconds, and this job now contains the season sweep —
    // the only unattended path in the app that destroys production data.
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    await runSweep('cleanupStaleGames', runCleanupStaleGames);
    /* … four more … */
    await runSweep('seasonRollovers', runSeasonRollovers);
  },
);
```

Every sixty minutes, unattended, that function may zero a club's `communityPlayerStats`, `communityStats` and `communityPairStats`, write a `seasonSummary` with `create()` (which is one-shot), write nine `seasonTitles` onto players' profiles, and push every participant. `clubIsQuiet` is the only thing standing between a club and that happening mid-evening, and the fix that unblocked 24 of 30 clubs from a permanent `unsealedGame` refusal — the `endedBy !== 'admin' && endedBy !== 'auto'` skip for legacy closes at `index.ts:15557` — landed with no test exercising it. The resume path that exists because a close can be killed halfway is likewise untested; so is the archived-latch that is supposed to stop a concurrent seal-close and sweep from resetting the *new* season (LEDGER `perform-close-writes-next-season-even-when-nothing-was-archived`).

Two more absences worth naming. Nothing tests the Hebrew vocabulary: the latest commit at HEAD (`e35394a`, "The last six labels that still called a משחקון a משחק") was, in its own words, "caught on the device, not in the diff" — the club stats screen printed "37 משחקים" (37 *games*) beside "22 מחזורים" (22 *evenings*) while the hall of fame one tap away called the same 37 "משחקונים" (*mini-games*). `copyDirectionality.test.ts` bans horizontal arrows in user-facing strings and `format.test.ts` pins the Hebrew plural forms of the season countdown; neither can catch a unit word. And nothing reconciles a *sealed* archive against the current rules: the s1 card still names seven MVPs at 6.0 because it was written before the scale floor existed, and `seasonAwards.test.ts:327` now asserts that cannot happen again — for future seasons only.

### The rules test suite

```sh
brew install openjdk@21                       # firebase-tools requires JDK 21+
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
firebase emulators:start --only firestore --project demo-soccer
cd tests/rules && npm install && npm test
```

One practical trap the README does not mention: `firebase.json` declares no `emulators` block, so the CLI also starts the Emulator UI on port 4000 and **aborts the whole run** if that port is taken (`Error: Could not start Emulator UI, port taken`). Adding `"emulators": { "ui": { "enabled": false } }` locally is the workaround.

Run against HEAD on 19.09.2026 the suite reports:

```
ℹ tests 146   ℹ suites 14   ℹ pass 142   ℹ fail 4   ℹ duration_ms 7476
```

The four failures, and what each actually is:

1. **`games: self can join an open community game`** (`firestore.test.mjs:179`) — expects success, gets `PERMISSION_DENIED: Unable to evaluate the expression as the maximum of 1000 expressions to evaluate has been reached. for 'update' @ L824`. Not a rules bug in the ordinary sense: the `/games` `allow update` at `firestore.rules:824` is one long OR chain and Firestore stops evaluating a rule after 1,000 expressions. The rules file documents this at line 826 — the publish-split branch was moved to the front *because* "on a real game document (82 fields) the branches below burn the whole budget and the request is denied before this one is ever reached. That is what actually failed in production."
2. **`OLD-CLIENT manual-offer cancel`** (`oldClientCompat.test.mjs:61`) — the same ceiling, same rule, same line.
3. **`groupsPublic: admin of canonical group can create the public mirror`** — a stale test. It writes `memberCount: 2`; `firestore.rules:627` caps a create at `<= 1`. The test predates the cap.
4. **`notifications: cannot fake an "approved" push to inflate a join`** — a test that contradicts its own comment. It `assertFails` on a `spotOpened` create, then explains three lines later that "spotOpened IS in the client whitelist — that's intentional". Stale, not a hole.

So two of the four are test rot and two are a **live production constraint that the seasons rules sit directly downstream of**. The expression ceiling is not confined to the failures. Over the whole run, forty requests logged `maximum of 1000 expressions`: twenty-two of them against `@ L343` (the `/groups` `allow update`) and eighteen against `@ L824`. Every one of the seven tests that prove `groups.seasons` cannot be touched from a client (`not an admin adding it`, `not an admin rewinding one that exists`, `and an ordinary member certainly does not`, `not deleting the field`, `not one nested number`, `not riding along on a self-leave`, `not riding along on a join request`) **passes with a budget-exhaustion error in the log**. The deny is real, but it is not proof the rule denied — it is proof the engine gave up. If the `seasons` immutability clause were removed tomorrow, those seven tests would very likely still pass. That is the most serious weakness in the rules coverage of this feature and it has not previously been reported.

What the seasons rules suite does pin, and pins well — 40 tests in 12 groups, all passing, with its own project id:

- A club member reads a `seasonSummary` by id and by list, answered from the `groupId` **field**, never the path wildcard (the `list`-does-not-bind trap that once made `communityStats` unreadable).
- A **departed participant** reads a season they played, by id, on `games > 0 || rounds > 0`. The `games` half exists because the rule previously authorised on `rounds` alone and every ex-member of a timer-only club was pushed a season summary and denied when they opened it (LEDGER `seasonsummary-participant-rounds-only`; confirmed three times independently). `seasonSummary.test.mjs:131` — "and a timer-only season, where nobody has a single משחקון" — is the regression test, and it passes.
- A departed player may *not* list, may not read a later season their zeroed row still appears in, and may not read a season they never played.
- `seasonCards` is member-only including the list path; nobody writes a card, an archive or a title; nobody deletes one; nothing is public to the internet.
- A player cannot award themselves a title, on their own profile or anybody else's, nor overwrite one they did win.
- A club cannot be **born** holding a `seasons` block (`allow create` at `firestore.rules:324` ends `!('seasons' in request.resource.data)`), which closed the door on a client planting `enabled: true` and having the hourly rollover adopt it.

What it leaves free:

- **`seasonId` on `/games` is not pinned anywhere.** `grep -c seasonId firestore.rules` = 0 outside two comments, and no rules test touches it. A member can create a game pre-stamped with any season id and the server's stamp is write-once, so it never corrects it. The resulting orphan (a game stamped `s3` on a club that knows only `s1`/`s2`) belongs to no scope and is unrepairable: finished games are client-read-only.
- Only one club shape. The fixtures are one group, one member, one outsider, one departed player.
- The `/groups` update rule is tested only through the budget ceiling described above.

### The open questions

These are the decisions that are genuinely unresolved — not defects with a known fix, but forks where more than one answer is defensible and the code has silently taken one. They are ordered by how much of the feature moves when the answer changes.

**1. Should the awards denominator be the season's length or the best attendance?** Today it is the best attendance: `awardsDenominatorOf` (`seasonRollover.ts:133`) returns `Math.max(...players.games)`, which on the one real season is **19** against a season length of **22**. The gate is `games >= ceil(D/2)`, so 19 gives a threshold of 10 (45% of the season) where the Hebrew copy promises half; and `minPenaltyAttempts(19) = 2` against `(22) = 3`, which is the entire reason מלך הפנדלים went to a player with a 2-of-2 record instead of a 2-of-3 one. *Season length* matches the copy and makes "attended every evening" meaningful, but the numerator (`games`, counted since 22.06) and that denominator (`eveningsSealed`, born 25.08) come from different eras — on the club the gate was calibrated against, 22 would admit 25 of 29 players to a gate meant to admit 13, including seven who turned up twice. *Best attendance* keeps both sides in the same units but is self-referential: `mostLoyal` is the maximum of the same array, so the loyalty winner always clears its own gate and `winner.value / D` is identically 1.0 — which is why `awardsDenominator` was written to the card for half a day and then removed, and why platinum on כתר ההתמדה is currently unreachable for anyone who missed one night. A third answer exists: keep attendance for *eligibility* and length for every *share* the app displays, which is roughly where the code has landed by accident, but has never been stated as the rule.

**2. Should the MVP have a sample-size gate?** `mvpAvg` is `eveningScoreSum / eveningScoreCount` (`seasonRollover.ts:516`) with no minimum on the count, ranked by `leaders(..., MVP_SCALE_FLOOR = 6)`. On the real club, `eveningScoreCount` runs 2–3 against 17–19 evenings attended, and all seven members tied at exactly 6.0 — the sentinel the scale returns for "played no mini-games". *No gate* is the status quo and is simple. *The same `ceil(D/2)` gate the other titles use* is consistent, but on any club whose evening-score accumulator has been live for less than a season it awards nobody, and the card's current Hebrew blames the players for that. *Shrinking toward the club mean* (an empirical-Bayes prior) ranks honestly but costs explainability: the number that decided the title stops being the number on the player's own card.

**3. Should a season's statistics be the live scan or the sealed card?** Both exist and they disagree. The card is deterministic, cheap, survives account deletion, and is protected — `allow write: if false` in the rules, `create()` on the server. It is also frozen with whatever was wrong when it was written: seven MVPs at 6.0, and per-player `games` short by exactly their attendance at three evenings that carry no `finishCredited` marker. The live scan is self-correcting — fix the rule and history fixes itself — but cannot answer for a deleted game, changes its answer as evenings age out of the 200-document window, and costs reads on every screen. A third option, *card by default with an admin-visible recompute*, breaks the write-once property both layers currently enforce. Note that the property is already not quite true: `seasonSummary/HhzIwmjMl1i5HSOGHt3p__s1` has `createTime 2026-09-17T16:12:08Z` and `updateTime 2026-09-18T11:41:41Z` — it was repaired by hand a day later, which is exactly the operation the design forbids.

**4. Should guest pairs be archived?** 293 of the 314 `communityPairStats` rows on a seven-player club are guest pairs (93%). The close reads all 314, archives none of the guests, zeroes them, and the undo can only restore what was archived — so a reopen loses them permanently. *Archive them* makes the undo lossless, at the cost of document size (`MAX_ARCHIVED_PAIRS = 1200`, ~250–300 bytes per entry against Firestore's 1MB ceiling) and of freezing a "partner" who is a different human next week, since a guest identity is per-evening. *Delete them at close* removes the 15× read amplification — one close read 314 documents and archived zero — at the cost of the club's lifetime chemistry history. *Never create them* is cheapest of all but the live evening's chemistry card is the feature they exist for. The question is really "is a guest a person or an event", and the data model has not decided.

**5. Should `eveningsSealed` be backfilled?** `clubRecords.eveningsSealed` is **10** on a club that has played 22 evenings, because the counter began on 26.08.2026; `seasons.roundsAtStart` is 7, and `10 − 7 = 3` is the number two separate shipped code paths archived for a season everyone had watched reach 22. *Backfill it per club from the games scan* makes the number mean what its name says, but it is the denominator of every running rounds-cadence season: moving it moves every club's finish line at once, and the `playedRounds` mirrors seeded from it would all need re-seeding in the same operation. *Leave it and rename it* ("evenings since 26.08") is honest and cheap but leaves every rounds target measured in a unit the card does not show. *Retire it in favour of stamped games* removes the era problem but reintroduces the one the counter was created to solve: deleting a game would silently walk a season's progress backwards.

**6. Should the three counters be collapsed into one derivation?** There are three answers to "how many מחזורים": `clubRecords.eveningsSealed` (lifetime counter), `seasons.playedRounds` (per-season mirror), and a scan over stamped games filtered by `didEveningHappen`. `seasonCounterReconciliation.test.ts` exists precisely because nothing compared them and all three disagreed. *One derivation from the games* is the truthful answer and costs an unbounded scan plus sensitivity to deletion. *Keep the mirror as the display number and make the counter internal* is the smallest change and leaves two numbers that can still drift, held together by a single test over a single club's fixture. *Event-source it* — one immutable document per credited evening in a `seasonEvenings` subcollection — gives idempotency, a repairable history and a cheap count, at the price of a migration and one extra write per seal.

**7. Should `מחזור` and `משחקון` be one unit in the data model?** They are two today (`completedRounds` vs `totals.rounds`: 22 and 37 on the same season), and the most recent commit at HEAD is the sixth pass at fixing labels that confused them. *Keep both* is correct and requires the copy discipline no test enforces. *Collapse to evenings* makes every timer-only club — the common club — coherent and throws away the advanced mode's per-mini-game record. *Derive the display unit from the club's mode* removes the confusion at the cost of a screen that reads differently for two clubs looking at the same number.

**8. Should ending a season early be destructive at all?** `endSeasonNow` and the sweep take the same irreversible path, and `reopenLastSeason` exists as the compensating transaction — with no time bound, no already-undone guard, and a `seasonWoundBack` stamp that survives it (all 314 pair rows currently carry `seasonWoundBack: 's2'` while s2 is the *running* season, which will make s2's close archive the chemistry and skip the wind-back). The alternative is a non-destructive "sealed" state: compute the archive, leave the live counters alone, and subtract only when the next season's first evening is credited. That makes undo a no-op and removes the resume path entirely, at the cost of every live table reading as cumulative across the seam — which is the behaviour seasons were introduced to end.
