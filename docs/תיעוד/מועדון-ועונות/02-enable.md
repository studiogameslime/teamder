## Turning seasons on, off, and on again

Seasons are switched on by one callable, `enableClubSeasons`, and off by another,
`disableClubSeasons`. Both live in `functions/src/index.ts` — enable at **:16286–16611**,
disable at **:16613–16626**. Neither is a document write from the client: `firestore.rules:376–395` makes the
`seasons` map server-owned and immutable from the app (`!affectedKeys().hasAny(['seasons'])
|| request.resource.data.seasons == resource.data.seasons`), and `:334–341` forbids a club
from being created holding one. Enabling can archive a club's entire history and hand out
permanent titles in a single call, so it belongs to the server.

The decision the admin makes is modelled as a **plan** — a pure function,
`planActivation`, in `src/utils/seasonActivation.ts:90–176`, with a byte-identical server
mirror at `functions/src/seasonActivation.ts` (the only textual difference is the import
path, `@/utils/seasonDates` → `./seasonDates`; verified by `diff`). The same function is
called three times for one activation: once by the settings screen to decide whether the
button is enabled, once implicitly by the confirmation sheet which renders the plan object
it is handed, and once by the server, which recomputes it from the club's own data rather
than trusting the request.

### The inputs, and the branch tree

```ts
// src/utils/seasonActivation.ts:24–37
export interface ActivationInput {
  cadence: Cadence;               // 'date' | 'rounds'
  months?: number;                // date cadence: season length
  targetRounds?: number;          // rounds cadence: evenings per season
  choice: HistoryChoice;          // 'continue' | 'sealNow'
  playedHistory: number;          // evenings the club has already played
  today: CalendarDate;            // 'YYYY-MM-DD' in the club's timezone
  season1EndsOn?: CalendarDate;   // chosen last day of season 1 (date+continue)
  hasHistory?: boolean;           // the club has run seasons before
}
```

`cadence` × `choice` gives four combinations, and `planActivation` treats each separately.
**מחזור** (*machzor*, an evening) is the unit throughout — `targetRounds: 24` means
twenty-four game-nights, not twenty-four mini-games. Nothing in this file knows that
**משחקון** (*mischakon*, a mini-game) exists.

| cadence | choice | plan fields returned | meaning |
|---|---|---|---|
| rounds | sealNow | `startsAtRounds: 0`, `roundsRemaining: target` | history sealed as season N, season N+1 opens empty |
| rounds | continue | `startsAtRounds: playedHistory`, `roundsRemaining: target − playedHistory` | season N opens already holding the club's history |
| date | sealNow | `startsOn: today`, `endsOn: seasonEndDate(today, months)`, `nextStartsOn` | history sealed, season N+1 runs `months` from today |
| date | continue, date given | `endsOn: season1EndsOn`, `nextStartsOn` — **no `startsOn`** | season N is transitional: it reaches back as far as the club does |
| date | continue, no date, `hasHistory` | `endsOn: seasonEndDate(today, months)`, `nextStartsOn` | the re-enable escape hatch, added 18.09 |
| date | continue, no date, first time | error `season1EndRequired` | the admin must name an end date |

The rounds+continue branch carries two refusals that are the heart of the feature's
arithmetic (`:112–121`):

```ts
if (playedHistory > target!)  return { ...base, error: 'historyExceedsTarget' };
if (playedHistory === target) return { ...base, error: 'historyFillsTarget' };
```

A season that opens already at or past its finish line is not a season — it would be
archived on the hourly sweep's next pass. `MIN_SEASON_ROUNDS = 2` (`:80`) is the floor, with
no ceiling: "a club that wants a 200-evening season is describing a long season, not a
mistake." For the date cadence the bounds are `MIN_SEASON_MONTHS = 1` and
`MAX_SEASON_MONTHS = 24` (`src/utils/seasonDates.ts:156–166`).

### Why the season-1 end date exists, and only there

Under a rounds cadence a transitional first season needs no dates: it starts at
`playedHistory` and ends at `target`. Under a **date** cadence with **continue**, there is no
honest start date — the history stretches back to the club's first game, months or years
before the admin opened the settings screen. The code's answer is to make the first season
open-ended at the front and let the admin name its *end*, with the chosen `months` applying
only from the following season (`seasonActivation.ts:145–176`; the server mirrors this at
`index.ts:16459–16464` by writing `cadence.startsOn = null`, `cadence.endsOn = plan.endsOn`,
`cadence.endsAt = null`).

The UI that picks that date is `SeasonsSettings.tsx:818–872` — four chips labelled with the
actual dates (`SEASON1_MONTH_CHOICES = [1, 2, 3, 6]`, `:67`) plus a custom stepper. It is
rendered inside `{firstTime ? … }` (`:795`), and

```ts
// src/components/community/SeasonsSettings.tsx:309
const firstTime = (seasons?.count ?? 0) === 0 && !live;
```

**Defect `live-club-cannot-use-date-cadence` (P0).** Until commit `ae2c042` (18.09 16:53)
`planActivation` returned `season1EndRequired` whenever `season1EndsOn` was missing, with no
`hasHistory` escape. Combined with the `firstTime` gate above, the date cadence was
*unreachable for the rest of a club's life*: a club already running seasons, or any club with
`count > 0` switching the feature back on, saw the enable button permanently disabled and a
red line reading **"בחרו תאריך סיום לעונה 1."** ("Choose an end date for season 1.") — naming
a season it had archived, with no date control anywhere on the screen. The server half was
patched first (`index.ts:16428–16432` derives the date itself when the client sends none,
for the benefit of 1.1.7 clients in the store); the client half followed two commits later.

**This fix is not in the shipped app.** The store build is 1.1.9 (Android vc235, iOS 103) at
commit `4de80d0`, 18.09 08:54 IDT. `git show 4de80d0:src/utils/seasonActivation.ts | grep -c
hasHistory` returns **0**. Every user on the current release still has the dead date cadence;
only the server-side derivation protects them, and only when the client lets them press the
button, which it does not.

A related residue, ROUND4 finding 21, was fixed at HEAD: the `hasHistory` branch originally
returned `endsOn` alone, so the confirmation sheet — which renders each date line only when
its field is present (`SeasonConfirmSheet.tsx:180, :186, :196`) — showed an end date and no
"עונה N+1 מתחילה ב-". `seasonActivation.ts:161–170` now derives `nextStartsOn` too.

Note also that the **server never passes `hasHistory`** (`index.ts:16433–16454`). It reaches
the same outcome by a different route, pre-computing `season1EndsOn` itself. Two code paths
to one answer is a maintenance hazard in a file whose entire premise is "one plan, computed
identically in three places".

### The seeding: two counters, two eras

This is the part that produces wrong numbers on real clubs. When a season opens, two fields
are stamped onto `groups/{id}.seasons`:

```ts
// src/utils/seasonSeed.ts:22–30 (and functions/src/seasonSeed.ts, identical)
export function seasonSeed(sealedEvenings: number, playedHistory = 0) {
  return { roundsAtStart: num(sealedEvenings), playedRounds: num(playedHistory) };
}
```

They come from **different sources covering different eras**, and the call site makes that
explicit (`index.ts:16573–16576`):

```ts
...seasonSeed(
  await sealedEveningsOf(groupId),
  closedSoFar > 0 ? 0 : await playedEveningsFromGames(groupId),
),
```

| field | source | what it counts | era it can see |
|---|---|---|---|
| `roundsAtStart` | `sealedEveningsOf` → `clubRecords/{groupId}.eveningsSealed` (`index.ts:15578–15583`) | every evening ever *sealed*, all-time, never resets, never decrements | **from 26.08.2026 only** — the counter did not exist before evening-sealing shipped |
| `playedRounds` | `playedEveningsFromGames` → scan of up to 200 terminal `games`, filtered by `didEveningHappen` (`index.ts:15655–15670`) | every evening the club actually held | the club's whole life, capped at 200 documents |

`roundsAtStart` is a *zero mark* for the all-time counter, so that every future seal adds
exactly one to a season-relative figure. `playedRounds` is the number the club is **shown**
on its card and the number the rollover closes on. They are not the same quantity and must
not be compared, but because both are "rounds" and both are seeded in the same expression,
the codebase has confused them repeatedly.

On the one club that has ever run seasons, `HhzIwmjMl1i5HSOGHt3p` (מועדון שכחת שושי), the
gap between the two eras is exactly measurable today:

```
clubRecords/HhzIwmjMl1i5HSOGHt3p.eveningsSealed = 10
games scan (23 terminal docs, 22 with didEveningHappen = 'happened') = 22
```

Twenty-three terminal games run 28.06.2026 → 18.09.2026. Nineteen of them predate the
season stamp entirely and carry no `seasonId`; three carry `s1`; one (18.09,
`DTNscolR…`) carries **`s3`** and is `playVerified: false`, so it does not count. The
counter sees ten of those twenty-two because it only began on 26.08.

**Defect (historic, fixed 18.09 in `0bb0812`).** `playedRounds` was originally seeded from
`eveningsSealed` too. The club turned seasons on, asked for 24, and the card read
**"7 מתוך 24"** ("7 of 24") — not its history (19 at the time), not a fresh start (0), but
however far a two-week-old counter had got. The owner's report is quoted verbatim in the
source: *"שיחקנו 19 ולא 7"* ("we played 19, not 7"). The fix routes `playedRounds` through
the games scan, which is also what the club screen's "מפגשים שנערכו" has always counted.

The client's half of the same number comes from a different function again:
`gameService.getCommunityStats(groupId).totalFinished` (`SeasonsSettings.tsx:340–351`). That
scan is also `limit(200)` over `status in ['finished','cancelled']` and also asks
`eveningPlayState`, so on the real club the two agree exactly at 22 — but it is a
*coincidence of construction*, not a shared module, and `getCommunityStats` additionally
applies a season filter (`inSeason`, `src/utils/seasonScope.ts:28–36`) when it is given a
scope. The settings screen passes none, so the filter is inert there. Nothing enforces that.

Note the seeding is **skipped for a re-activation**: `closedSoFar > 0 ? 0 : …`. A club that
has closed a season before starts the next one at zero, because those evenings are already
sealed inside an archive. Before that guard existed, a club with 22 evenings behind it could
not open a 2-round season at all — the server answered `failed-precondition` and the app
showed "משהו השתבש" ("something went wrong").

### The `sealNow` branch

```ts
// functions/src/index.ts:16466–16512 (trimmed)
if (choice === 'sealNow') {
  const quiet = await clubIsQuiet(groupId);
  if (!quiet.ok) throw new HttpsError('failed-precondition', quiet.blocker ?? 'busy');
  const firstNo = closedSoFar + 1;
  await closeSeason({
    db, groupId, seasonId: `s${firstNo}`, seasonNo: firstNo,
    startsAt: 0,                    // display resolves the club's first game
    completedRounds: played,        // ← see below
    roundsAtStart: 0,
    partialData: true,              // assists only from 21.06, clean sheets from 17.08
    now,
  });
  await ref.set({ seasons: {
    enabled: true, currentNo: firstNo + 1, currentId: `s${firstNo + 1}`,
    startedAt: now, roundsAtStart: sealedAllTime, playedRounds: 0,
    reopenedAt: 0, cadence: rebaseCadence(cadence, now, now),
    targetHistory: [], count: firstNo,
  } }, { merge: true });
  await announceSeasonClosed({ … });
  return { ok: true, closedSeasonNo: firstNo, currentNo: firstNo + 1 };
}
```

**Defect `enable-sealnow-archives-counter-not-games` (P1).** `completedRounds: played` where
`played` is computed at `:16328`:

```ts
const played = await completedRoundsOf(groupId, existing?.roundsAtStart);
```

Two arguments, not three — so `completedRoundsFrom` (`functions/src/seasonCounters.ts:105–118`)
takes the fallback path and returns `eveningsSealed − roundsAtStart`. On a first activation
`roundsAtStart` is absent, so this is simply `eveningsSealed`. Meanwhile the confirmation
sheet the admin approved showed `plan.playedHistory`, which is the **games scan**
(`SeasonConfirmSheet.tsx:159`, rendering
`he.seasonsConfirmSealedNow(plan.playedHistory)` → **"20 מחזורים קיימים — תיסגר כעת"**,
"20 existing rounds — will be sealed now"). `closeSeason` writes that argument straight into
the archive card (`functions/src/seasonRollover.ts:625–627`). Had שכחת שושי taken this
branch on 16.09, the sheet would have said **20** and the permanent archive would have stored
**7**. The archive is created with `summaryRef.create()` — there is no second chance.

The club took `continue` instead, so the defect is unexercised in production; the sealed card
`seasonCards/HhzIwmjMl1i5HSOGHt3p__s1` today reads `completedRounds: 22`, written later by
`endSeasonNow` after its own two-argument bug was repaired. Its `startsAt` is
`1789547794676` = **16.09.2026 11:36**, the enable moment — which is why the hall of fame
prints "ספט׳ 2026 – ספט׳ 2026" over a season containing three months of football.

Note also `roundsAtStart: sealedAllTime` here versus `seasonSeed(await sealedEveningsOf(…))`
in the continue branch: the same figure, read twice from the same document in one invocation
(`:16338` and `:16574`). Harmless, but it is a second Firestore read per activation.

### The `continue` branch and the silent clamp

```ts
// functions/src/index.ts:16523–16531
if (cadence.type === 'rounds' && closedSoFar === 0) {
  cadence.targetRounds = Math.max(cadence.targetRounds ?? 0, played + 1);
}
```

**Defect `rounds-clamp-uses-a-different-history` (P2).** The plan refused a target below
`playedHistory` using the **games scan**; this clamp raises the target using **`played`**,
i.e. `eveningsSealed`. Two histories, one decision. When the counter is *lower* than the
scan — the normal case today, 10 against 22 — the clamp is a no-op and the plan's refusal
governs. When the counter is *higher* — a club past the 200-document scan window, or one
that has deleted games (deleting a game decrements nothing, which is precisely why
`sealedEveningsOf` exists) — the clamp silently rewrites the admin's choice. The source
comment names the failure: an admin choosing 24 gets 201. No `targetHistory` entry is
written, no error is returned, and `SeasonConfirmSheet` has already promised 24. This is
finding `approved-rounds-target-is-not-the-one-written` from the other side.

### Switching off, and switching back on

`disableClubSeasons` is four lines of effect:

```ts
// functions/src/index.ts:16621–16624
const seasons = group.seasons as { enabled?: boolean } | undefined;
if (!seasons?.enabled) return { ok: true, alreadyOff: true };
await ref.set({ seasons: { enabled: false } }, { merge: true });
```

It deliberately does **not** close the running season — the dialog says so
(`he.seasonsDisableBody`): *"העונה שרצה עכשיו לא תיסגר ולא יחולקו עליה תארים"* ("the season
running now will not be closed and no titles will be awarded for it"). Everything else on
the block survives, `count` included, so numbering continues: a club that ran seasons 1–3
re-opens at 4, never at 1.

The same dialog also promises: *"ואם תפעילו עונות שוב הספירה תמשיך מהמקום שבו עצרה"* — **"and
if you turn seasons on again the count will continue from where it stopped."**

**Defect `disable-reenable-zeroes-running-season` (P1).** It does not. Re-enabling runs the
`continue` branch with `closedSoFar > 0`, so `seasonSeed(eveningsSealed, 0)` writes
`playedRounds: 0` and `startedAt: now`. Every evening the season had accumulated while the
feature was on is erased from the card, and the promise in the dialog is exactly inverted.
The one in-between case is a club with `count === 0` that never closed anything: it is
re-seeded from the games scan, which is *closer* to correct but still discards whatever the
live season held.

**`QA Test Club` (`6zotsP1u5Wa18hIysQif`) is sitting in that state right now.** It is the
only other club in the database of 195 groups with a `seasons` block:

```
enabled: false        count: 0           currentNo: 1      currentId: "s1"
playedRounds: 3       roundsAtStart: 0   reopenedAt: 1789509161010 (15.09)
cadence: { type: "rounds", targetRounds: 3, months: null, endsAt: null }
clubRecords/6zotsP1u5Wa18hIysQif: does not exist  → sealedEveningsOf = 0
terminal games for this group: 0
```

Press "הפעל עונות" on it today and: `closedSoFar = 0` → `firstTime` on the client is true →
`playedHistory = playedEveningsFromGames = 0` → `seasonSeed(0, 0)` → `playedRounds: 0`. Three
evenings of progress replaced by zero, and `currentId` re-issued as **`s1`** — the same id the
previous run used. Its `cadence` map also shows the merge hazard the code warns about: it has
`months` and `endsAt` keys but no `startsOn`/`endsOn` at all, because it was written by an
older build; `merge: true` into a nested map merges field by field, which is why the current
enable path writes explicit `null`s on the unused half (`:16362–16368`, `:16386–16394`).

**Defect `season-id-reissued-with-live-stamps` (P1).** `count` advances only on a *close*, so
disable + enable re-issues the *same* `currentId` while games from the previous run still
carry that stamp. The card, seeded to 0, and the season-scoped statistics screen, which counts
stamped games via `playedEveningsOfSeason`/`countSeasonEvenings`, then answer the same question
differently — one says 0, the other says however many games bear the stamp. The live club
already shows the general shape of stamp drift: `groups/HhzIwmjMl1i5HSOGHt3p.seasons.currentId`
is `"s2"`, and game `DTNscolR…` played on 18.09 is stamped **`"s3"`** — a season the club
document has never heard of.

**Defect `reenable-inherits-stale-reopenedat` (P2).** The `sealNow` branch writes
`reopenedAt: 0` (`:16502`); the `continue` branch does not write the field at all, and
`merge: true` preserves it. `reopenedAt` buys a season 48 hours of immunity from closing
(`REOPEN_GRACE_MS`, checked at `:15977–15979` on the seal path and `:16178–16182` in the
hourly sweep). So a brand-new season opened by a re-enable within two days of an undo inherits
the predecessor's grace and cannot be closed by either mechanism, however far past its target
it is. שכחת שושי carries `reopenedAt = 1789727847680` = **18.09.2026 10:37** today.

The same write also sets `targetHistory: []` unconditionally (`:16578`), discarding the audit
trail of every finish-line move the club ever made — finding `reenable-wipes-targethistory`.
On the live club that array currently holds one entry (a change from `targetRounds: 2` to
`targetRounds: 24` by *Eliran Tzabari* at 18.09 10:37:54), and a disable/enable cycle would
delete it.

### Refusals, and whether the admin ever sees them

Every way `enableClubSeasons` can say no, and what the user gets:

| thrown | code | client mapping (`seasonService.ts`) | Hebrew shown |
|---|---|---|---|
| `sign-in required` | `unauthenticated` | none | generic |
| `groupId required` | `invalid-argument` | `null` unless message contains `targetRounds` | generic |
| `club not found` | `not-found` | `null` (only `no archive` maps) | generic |
| `admin only` | `permission-denied` | `notAdmin` | "רק מנהל המועדון יכול לסיים עונה." |
| `seasons already on` | `failed-precondition` | `seasonsAlreadyOn` | "עונות כבר פעילות במועדון. רעננו את המסך…" |
| `targetRounds required` | `invalid-argument` | `targetInvalid` | "עונה חייבת להכיל לפחות 2 מחזורים." |
| `season-plan:<error>` ×6 | `failed-precondition` | `lengthInvalid` / `targetInvalid` / `historyExceedsTarget` / `historyFillsTarget` / `seasonEndRequired` / `seasonEndPast` | the six written explanations |
| `openGame` / `unsealedGame` (sealNow only) | `failed-precondition` | `openGame` / `unsealedGame` | "יש מחזור פתוח במועדון…" / wait-for-seal |

The mapping lives in `refusalOf` (`src/services/seasonService.ts:128–183`) and is turned into
text by `seasonRefusalText` (`:77–126`), which takes a `SeasonRefusalContext` carrying the real
season number — because every one of these messages was originally written about "עונה 1"
while numbering continues across a disable/enable cycle.

**Defect `season-plan-refusals-unmapped` (P2).** `git show 4de80d0:src/services/seasonService.ts
| grep -c 'season-plan:'` returns **0**. In the shipped 1.1.9 build all six plan refusals fall
through to `he.seasonActionFailed` — **"משהו השתבש. נסו שוב עוד רגע."** ("Something went wrong.
Try again in a moment.") — which is advice that can never work, printed beside a destructive
button and an invitation to press it again. The six Hebrew explanations exist in `he.ts`
(`:2333–2345`) and are reachable today only when the *client's own* `planActivation` reaches
the same verdict first, which by construction it cannot when the disagreement is between
client and server histories. The screen also renders the plan error inline
(`SeasonsSettings.tsx:901–905`) and disables the button while `!plan.ok` (`:943–949`), so in
practice a server-side plan refusal means the two sides disagreed — exactly the case where the
generic line is least useful.

Two invariants this area is trying to hold, and their status:

- *"The summary a person approves is the thing that actually happens."* **Does not hold.**
  The clamp at `:16531` can raise an approved rounds target, and `sealNow` archives a different
  evening count from the one the sheet displayed.
- *"Numbering continues across the feature being switched off and on."* **Holds for `count`
  and `currentNo`, but not for the data.** The id is reused while old games keep the stamp, and
  the season's progress is reset to zero against a dialog that promised the opposite.
