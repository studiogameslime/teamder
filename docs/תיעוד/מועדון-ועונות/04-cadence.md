## Cadence — how a season knows it is over

All line numbers are against HEAD, commit `e35394a`. The only club in production that has
ever run a season is `HhzIwmjMl1i5HSOGHt3p` (מועדון שכחת שושי, "Shoshi's Forgetfulness FC").
A scan of all 195 `groups` documents on 19.09.2026 found **two** clubs with a `seasons` block
at all, and **both use the rounds cadence**. No club has ever run a date season. Everything in
the date half of this section is therefore verified by reading and by arithmetic, not by
observing it work.

### The finish line is one function, asked by two callers

Every decision about whether a season is over passes through `seasonFinishLine` and
`isSeasonDue` in `functions/src/seasonCounters.ts:136` and `:175`. This centralisation is
recent; before it the hourly sweep and the seal-time close each classified a cadence for
themselves, which is how one path came to close a season at a number the other had never
computed.

```ts
// functions/src/seasonCounters.ts:136
export function seasonFinishLine(cadence: {
  type?: string; endsOn?: unknown; endsAt?: number | null; targetRounds?: number | null;
}): SeasonFinishLine {
  if (cadence?.type === 'rounds') {
    const target = cadence.targetRounds;
    return typeof target === 'number' && target > 0
      ? { kind: 'rounds', target }
      : { kind: 'none', cadence: 'rounds' };
  }
  if (isCalendarDate(cadence?.endsOn)) return { kind: 'date', endsOn: cadence.endsOn };
  if (typeof cadence?.endsAt === 'number' && cadence.endsAt > 0)
    return { kind: 'epoch', endsAt: cadence.endsAt };
  return { kind: 'none', cadence: cadence?.type ?? '(none)' };
}
```

Four kinds, not two: `rounds`, `date` (a calendar day), `epoch` (the legacy millisecond
deadline), and `none`. `isSeasonDue` then answers each — `played >= target`,
`isSeasonOver(endsOn, today)`, `now >= endsAt`, and `false`.

### ROUNDS cadence

`cadence.targetRounds` is the season's **total** number of מחזורים (evenings/game-nights), not
a remainder. It is measured against `seasons.playedRounds`, a mirror on the club document that
is seeded to 0 when a season opens and incremented by one every time an evening is sealed. The
read path is `completedRoundsOf` (`functions/src/index.ts:15695`), which delegates to
`completedRoundsFrom` (`seasonCounters.ts:105`):

```ts
export function completedRoundsFrom(sealedEvenings, roundsAtStart?, playedRounds?) {
  if (typeof playedRounds === 'number' && playedRounds >= 0) return playedRounds;
  const all  = typeof sealedEvenings === 'number' && sealedEvenings > 0 ? sealedEvenings : 0;
  const base = typeof roundsAtStart  === 'number' && roundsAtStart  > 0 ? roundsAtStart  : 0;
  return Math.max(0, all - base);
}
```

The fallback — `clubRecords/{groupId}.eveningsSealed − seasons.roundsAtStart` — is a
subtraction of two counters from different eras. `eveningsSealed` only began accumulating on
26.08.2026. On the real club it currently reads **10**, while the club has played **22**
evenings. Any caller that forgets to pass `playedRounds` therefore measures the season against
a number twelve short of reality. The code comments record this having happened three separate
times; `endSeasonNow` (`index.ts:17030`) carries a comment saying it would have sealed a season
of three that the club had watched reach twenty-two.

**Two paths notice that the target is met.**

1. **On the seal.** `onGameRosterChanged` seals an evening, increments `playedRounds`, and then
   calls `closeSeasonIfRoundsTargetMet` (`index.ts:15943`) from `index.ts:5287`. It computes
   `playedNow = liveSeasons.playedRounds + 1` (the in-hand snapshot predates the batch it just
   committed), asks `seasonFinishLine`, returns immediately unless `line.kind === 'rounds'`,
   and closes if `played >= target` — subject to a 48-hour `REOPEN_GRACE_MS` immunity and to
   `clubIsQuiet`.
2. **The hourly sweep.** `runSeasonRollovers` (`index.ts:16055`), run last inside
   `cronEvery60Min` (`index.ts:13585`, `schedule: 'every 60 minutes'`). It pages 200 clubs at a
   time over `where('seasons.enabled','==',true)`, asks the same two functions, and closes at
   most `MAX_CLOSES_PER_SWEEP = 5` seasons per run.

A date season can only ever be closed by path 2. A rounds season is closed by whichever gets
there first; `performSeasonClose` re-reads the club document and abandons the close if
`currentId` has moved (`index.ts:15823-15834`).

**The clamp at activation.** When seasons are first switched on and the admin chooses to carry
season 1 (which holds the club's entire history) forward under a rounds cadence, the server
raises the target so that "continue" cannot mean "close immediately":

```ts
// functions/src/index.ts:16530
if (cadence.type === 'rounds' && closedSoFar === 0) {
  cadence.targetRounds = Math.max(cadence.targetRounds ?? 0, played + 1);
}
```

`played` here comes from `completedRoundsOf(groupId, existing?.roundsAtStart)` at
`index.ts:16328` — **two** arguments, so it takes the `eveningsSealed − roundsAtStart` fallback.
But `planActivation`, which validated the same activation ten lines earlier and produced the
sheet the admin approved, was given `playedEveningsFromGames(groupId)` — a scan of the games
themselves. These are different numbers: 10 and 22 on the one real club (defect
`rounds-clamp-uses-a-different-history`). The clamp can only raise, and the plan's own rule
(`historyExceedsTarget`, `seasonActivation.ts:113`) already requires `target > gamesCount`, so
today the clamp is a silent no-op — unless `eveningsSealed` exceeds the games count, which
happens whenever a finished game is deleted, because deletion decrements no counter. Then an
admin who confirmed 24 gets `eveningsSealed + 1` and is never told.

`playedEveningsFromGames` (`index.ts:15655`) has two further teeth: `.limit(200)`, so a club
with more than 200 finished-or-cancelled games undercounts its own history, and a `catch` that
returns **0**. Zero is a claim, not an absence: it tells `planActivation` the club has never
played, which disables every history refusal.

**Production worked example.** Season 1 of `HhzIwmjMl1i5HSOGHt3p` was archived at
`seasonSummary/HhzIwmjMl1i5HSOGHt3p__s1` with `originalTarget.targetRounds = 22` and
`completedRounds = 22` — target met exactly. `totals.rounds = 37`: that is **משחקונים**
(mini-games), a different unit, and it is the number several client screens display beside the
word מחזורים. The club is now in season 2 with `roundsAtStart: 10`, `playedRounds: 0`,
`cadence: {type:'rounds', targetRounds:24, months:null, endsAt:null, endsOn:null,
startsOn:null}`. `completedRoundsFrom(_, 10, 0)` returns 0, so the season is 0/24 and the
fallback would agree (10 − 10 = 0). This is the only configuration in production where the two
derivations happen to coincide.

### DATE cadence: four fields for one deadline

| Field | Type | Written by | Read by | Absent ⇒ |
|---|---|---|---|---|
| `months` | 1–24 int | `enableClubSeasons` :16396, `updateSeasonTarget` :16763, `rebaseCadence` :15441 | `rebaseCadence` (to compute the next season's length); `SeasonsSettings` seeds its chips from it | `rebaseCadence` guesses from `endsAt − startedAt`, then defaults to 6 |
| `endsOn` | `'YYYY-MM-DD'` | same three | `seasonFinishLine` **first**; `SeasonsCard` line + countdown | falls through to `endsAt` |
| `endsAt` | epoch ms | same three, except the carry-on branch which nulls it (:16463) | `seasonFinishLine` only if `endsOn` is absent; `SeasonsCard` legacy branch | falls through to `none` |
| `startsOn` | `'YYYY-MM-DD'` | same | **nothing** — one grep hit per write, zero reads | — |

`startsOn` is write-only. `endsAt` is retained so that pre-1.1.7 clients keep rendering
something. `endsOn` is the authority.

**They do not agree.** `endsOn` is computed as `seasonEndDate(todayIn(), months)` — the day
*before* the anniversary. `endsAt` is computed as `addMonthsClampedServer(now, months)` — the
anniversary instant itself. So `endsAt` lands on the **next season's first day**
(`endson-endsat-one-day-apart`). Verified by executing both algorithms with `TZ=UTC`, as Cloud
Functions run:

| `now` | `todayIn()` | `endsOn` (3 months) | `endsAt` | `endsAt` as an Israel date |
|---|---|---|---|---|
| 2026-09-19T07:00Z | 2026-09-19 | 2026-12-18 | 2026-12-19T07:00Z | 2026-12-19 |
| 2026-09-19T22:00Z | 2026-09-20 | 2026-12-19 | 2026-12-19T22:00Z | 2026-12-20 |
| 2026-08-31T07:00Z | 2026-08-31 | 2026-11-29 | 2026-11-30T07:00Z | 2026-11-30 |

The gap is one day in every case, but *which* day each field names depends on the hour the
admin pressed the button, because `todayIn` uses Asia/Jerusalem and `addMonthsClampedServer`
uses `new Date().getDate()`, which in Cloud Functions is UTC. An old client and a new client
looking at the same season will disagree about its last day.

### `src/utils/seasonDates.ts`, in full

166 lines, pure except one function. `functions/src/seasonDates.ts` is a byte-identical copy
with a seven-line header (`diff` confirms: the header is the only difference), so every server
line number in this file is the client's plus 7.

- **`CLUB_TZ = 'Asia/Jerusalem'`** (`:21`) — the club's calendar. Hard-coded; there is no
  per-club timezone anywhere in the schema.
- **`CalendarDate`** — a `'YYYY-MM-DD'` string. `isCalendarDate` (`:28`) is a regex test only:
  `'2026-13-45'` passes. The shape is chosen because lexicographic order *is* chronological
  order for it, which is what makes `compareDates` (`:83`) a two-character comparison.
- **`daysInMonth(y, m)`** (`:43`) — `new Date(Date.UTC(y, m, 0)).getUTCDate()`. Month is
  1-indexed here and 0-indexed in `Date.UTC`, so passing `m` unchanged asks for "day 0 of month
  m", i.e. the last day of month m−1 in 0-index = month m in 1-index. Correct, and leap years
  fall out for free.
- **`addMonths(d, months)`** (`:55`) — converts to an absolute month number, adds, converts
  back, and **clamps the day to the last valid day of the target month**. 31.08 + 6 = 28.02,
  not 03.03.
- **`previousDay`** (`:64`) / **`nextDay`** (`:73`) — cross month and year boundaries with no
  special cases.
- **`seasonEndDate(start, months)`** (`:94`) — `previousDay(addMonths(start, months))`. The
  *inclusive last valid day*. This minus-one is why two consecutive seasons cannot both claim
  the anniversary.
- **`nextSeasonStart(end)`** (`:102`) — `nextDay(end)`.
- **`todayIn(tz = CLUB_TZ, now = Date.now())`** (`:113`) — the only timezone-aware function.
  Uses `toLocaleDateString('en-CA')` because that locale formats as `YYYY-MM-DD`, with an
  `Intl.DateTimeFormat` fallback for runtimes that ignore the locale's ordering.
- **`isSeasonOver(end, today)`** (`:138`) — `compareDates(today, end) > 0`. Strictly greater:
  the season is valid **through** its last day.
- **`monthsBetween`** (`:143`) — whole months, used only to describe a legacy season's length.
- **`MIN_SEASON_MONTHS = 1`, `MAX_SEASON_MONTHS = 24`** (`:156-157`), enforced by
  `isValidSeasonMonths`.

**Worked example: a 31st-of-the-month start, and the anniversary ratchet.** Six-month seasons
from 31.08.2026, chaining `seasonEndDate` → `nextSeasonStart`:

| Season | Runs | Boundary day-of-month |
|---|---|---|
| 1 | 2026-08-31 → 2027-02-27 | 31 |
| 2 | 2027-02-28 → 2027-08-27 | 28 |
| 3 | 2027-08-28 → 2028-02-27 | 28 |
| 4 | 2028-02-28 → 2028-08-27 | 28 |
| 5 | 2028-08-28 → 2029-02-27 | 28 |

`addMonths` clamps *downwards only*, and `nextSeasonStart` then feeds the clamped day back in
as the next season's start. The day-of-month is therefore **monotonically non-increasing over
the club's life**: once a season boundary passes through February it can never return to the
31st. A club on one-month seasons from 31.01.2027 walks 31 → 28 in a single step and stays
there: `2027-01-31→02-27`, `02-28→03-27`, `03-28→04-27`, … The club permanently loses three
days of the calendar month it chose. This is a consequence of the design, not a bug in it, but
nothing in the UI says it will happen and no season summary records the drift.

### Three different month arithmetics

| Function | Where | Operates on | Timezone | Live? |
|---|---|---|---|---|
| `addMonths` | `seasonDates.ts:55` | calendar dates | none | yes |
| `addMonthsClampedServer` | `index.ts:15733` | epoch ms | the process's local zone = **UTC** | yes, writes `endsAt` |
| `addMonthsClamped` | `seasonLifecycle.ts:169` | epoch ms | the **device's** local zone | **dead** |

`src/utils/seasonLifecycle.ts` — 177 lines containing a second `isSeasonDue`, `canCloseNow`,
`roundsRemaining`, `validateTargetChange`, `continueSeasonTarget` and `addMonthsClamped` — is
imported by exactly one file in the repository: `tests/logic/seasonLifecycle.test.ts`, which
runs 22 tests against it. No screen, no service and no Cloud Function imports it. Its header
claims it exists so that "the client (which greys out a button and explains why) and the server
(which is the one that actually decides)" cannot disagree; in fact the client's copy of
`isSeasonDue` never consults `endsOn` at all, so if it *were* wired up it would disagree with
the server on every date season opened since calendar boundaries shipped. Similarly,
`functions/src/index.ts:15729` declares `const MONTH_CHOICES = [1, 3, 6, 12]` under a
nine-line comment about the harm it once did; grep finds no use of it.

### `rebaseCadence` — the finish line moves at every rollover

`functions/src/index.ts:15405`. A **rounds** target survives a rollover untouched: "24" means
"another 24 evenings" for every season. A **date** target cannot, because an inherited end date
is already in the past and would make the new season due the instant it opened — one empty
archived season per hour, for ever.

```ts
function rebaseCadence(cadence, seasonStartedAt, now) {
  if (!cadence || cadence.type !== 'date') {
    return (cadence ?? { type: 'date', months: 6 }) as { … };
  }
  let months = isValidSeasonMonths(Number(cadence.months)) ? Number(cadence.months) : 0;
  if (!months && seasonStartedAt > 0 && typeof cadence.endsAt === 'number') {
    const ranMonths = Math.round((cadence.endsAt - seasonStartedAt) / (30*24*60*60*1000));
    months = isValidSeasonMonths(ranMonths) ? ranMonths : 0;
  }
  if (!months) months = 6;
  const startsOn = todayIn(undefined, now);
  return { type: 'date', months, endsAt: addMonthsClampedServer(now, months),
           startsOn, endsOn: seasonEndDate(startsOn, months), targetRounds: null };
}
```

| Caller | Line | What it is rebasing |
|---|---|---|
| `performSeasonClose` | 15886 | the successor of a season the sweep or the seal just closed |
| `enableClubSeasons`, seal-now branch | 16505 | season *N+1*, measured from the activation moment |
| `reopenLastSeason` | 16957 | the season being **brought back** |
| `endSeasonNow` | 17061 | the successor of a manually-ended season |

Two problems live here.

**A missing cadence produces a season that can never end.** The first branch returns
`{type:'date', months:6}` with **no `endsOn` and no `endsAt`**. Fed to `seasonFinishLine`, that
is `{kind:'none', cadence:'date'}` — and `isSeasonDue` returns `false` for `none`, for ever.
Any close of a season whose club document lacks a `cadence` map opens a successor that no path
will ever close. This is `cadence-with-no-finish-line-never-closes`. The sweep at least now
*says* so (`index.ts:16141-16152`, `noFinishLine += 1` plus a `console.warn`) instead of the
bare `continue` it used to be — but it is a log line, not an error row, and the production
`errors` collection has never held a seasons entry.

**Reopen gives a date season a whole new life.** `reopenLastSeason` is the undo button for an
accidental close. It rebases from `archive.originalTarget` — so a six-month season that was
ended three days early comes back running **six months from today**, not three days
(`reopen-extends-a-date-season-by-a-full-length`). `rebaseCadence` is the function for opening
the *next* season; the reopen needs the original `endsOn` restored, and there is no code that
does that.

### The four end-date options

On a **first** activation with a date cadence and "carry season 1 on", the admin must name
season 1's last day, because season 1 contains the club's entire history and has no computable
start. `SeasonsSettings.tsx:67` defines the shortcuts and `:831-845` renders them as dates:

```tsx
const SEASON1_MONTH_CHOICES = [1, 2, 3, 6] as const;
…
{SEASON1_MONTH_CHOICES.map((m) => {
  const d = seasonEndDate(today, m);
  return <Chip key={m} label={formatCalendarDate(d)} active={!season1Custom && season1EndsOn === d}
           onPress={() => { setSeason1Custom(false); setSeason1Months(m); setSeason1EndsOn(d); }} />;
})}
```

They are deliberately shorter than the season-length chips (`MONTH_CHOICES = [3, 6, 12]`,
`:62`) because this season already holds everything played so far. A fifth chip,
"מותאם אישית" ("custom"), opens a 1–24 stepper that also writes a date rather than a number —
the comment at `:867` records that it previously moved a number while the date the admin was
actually choosing never changed.

Verified against `today = 2026-09-19`: the chips render 18.10.2026, 18.11.2026, 18.12.2026 and
18.03.2027, and `nextSeasonStart` of each is the 19th. Correct, and consistent with
`planActivation`'s `nextStartsOn`. `planActivation` (`seasonActivation.ts:174`) then refuses
`end <= today` — so the same-day option, if a custom stepper could reach it, would be rejected
with `season1EndNotFuture` → "תאריך הסיום של עונה N חייב להיות בעתיד" ("season N's end date
must be in the future").

Three ranges are in play for one concept and they do not match: the client offers 3/6/12, the
client's custom stepper allows 1–24, the server accepts 1–24 (`isValidSeasonMonths`), and the
dead server constant says 1/3/6/12. The server's date branch also still silently rewrites
anything outside 1–24 — including a missing `months` field — to **6**, directly under a comment
declaring that "rewriting silently is not [honest], and 6 was neither what they picked nor what
they confirmed". The class of input was narrowed, not eliminated.

### `updateSeasonTarget` — moving the line mid-season

`functions/src/index.ts:16627`. The client calls it from `SeasonsSettings.saveTarget` (`:513`)
with `{groupId, cadenceType, months?, targetRounds?}` and nothing else.

**What an admin can change:** the target number, and the cadence *type* itself — rounds↔date,
mid-season, with no extra guard. A club twelve evenings into a 24-evening season can switch to
a three-month date cadence; `playedRounds` stays at 12 but stops meaning anything.

**What is refused:**

| Condition | Code | Message the admin sees |
|---|---|---|
| not an admin | `permission-denied` | "הפעולה מיועדת למנהלי המועדון" |
| `seasons.enabled !== true` | `failed-precondition` `seasons are off` | mapped |
| rounds, non-finite or ≤ 0 | `invalid-argument` `targetRounds required` | mapped → `targetInvalid` |
| rounds `< MIN_SEASON_ROUNDS` (2), :16723 | `invalid-argument` `target N is below the 2-round floor` | **unmapped** — `refusalOf` (`seasonService.ts:145`) only matches `invalid-argument` messages containing the literal `targetRounds`, so this reaches the admin as the generic "משהו השתבש" |
| rounds `<= played`, :16730 | `failed-precondition` `target N is not above the M rounds already played` | mapped → `targetBehind`, and `playedFromError` recovers M |
| rounds `<= played` **and** an evening in play, :16686 | `failed-precondition` `openGame`/`unsealedGame` | mapped |

Nothing is refused on the date side. `months` is at least 1 by the time it is used, so
`addMonthsClampedServer(now, months)` is always in the future: **a date re-target can only ever
extend a running season**, never shorten it below one month from today, and never close it.

**What `targetHistory` records.** One `arrayUnion` entry per accepted change (`:16802`):
`at`, `by`, `byName` (frozen), `from` (the whole previous cadence map, or `null`), `to` (the
whole new one), `playedAtMove` (sealed because `played` is a moving number), and
`endsTheSeason`.

**What it does not record.** No `seasonId` — which is exactly what let a reopen reattach one
season's history to another (`target-history-entry-carries-no-season-identity`). Not the
*initial* target: the first entry's `from` is the only trace of it. Not the rewrites
`rebaseCadence` performs at every rollover and at every reopen, which move a date club's finish
line with no entry at all. And nothing shows it: `targetHistory` is typed
(`src/types/index.ts:1004`), deserialized (`src/firebase/firestore.ts:691`) and unit-tested
(`tests/logic/groupSeasonsReader.test.ts:50`), and rendered by no screen — there is no Hebrew
string for it (`target-history-never-shown-to-anyone`). The client's `SeasonTargetChange` type
also describes only `{type, endsAt, targetRounds}` for `from`/`to`, so `months`, `endsOn`,
`startsOn`, `playedAtMove` and `endsTheSeason` are invisible to TypeScript even though they are
in the document.

**`target-history-erased-at-close`.** `performSeasonClose` (`:15911`) and `endSeasonNow`
(`:17062`) both write `targetHistory: []` for the successor season. The array is now sealed
into the archive first (`:15838`, `:17042`), but the one archive that exists in production —
`seasonSummary/HhzIwmjMl1i5HSOGHt3p__s1`, whose full key set is `awards, closedAt,
completedRounds, endsAt, groupId, groupName, no, originalTarget, pairs, players,
roundsAtStartOfSeason, seasonId, startsAt, totals, zeroedAt` — **has no `targetHistory` key**.
It was closed before the sealing existed. That club's finish line moved from 22 to 2 to 24 and
only the last move survives anywhere.

**`target-change-can-close-a-season-with-no-confirmation`** is now *half* fixed, and the fix
made a second mechanism unreachable. The `asked <= played` throw at `:16730` means the
`endsTheSeason` computation twenty lines later —

```ts
const endsTheSeason = next.type === 'rounds'
  && typeof next.targetRounds === 'number' && next.targetRounds <= played;
```

— **can never be true**, because that call has already thrown. Consequently
`seasons.targetMovedToClose` is written by nothing (grep: one gated write at `:16816`, three
unconditional deletes, one read), and the `endedEarly`/`closedBy` branch in
`performSeasonClose` at `:15845-15864` that exists to read it back is dead. The residual hole
is `played + 1`: it is accepted, it is not flagged, and the very next seal closes the season —
from a plain one-tap button, because `SeasonsSettings` routes a live club straight to the
server (`:953`: `onPress={live ? saveTarget : () => setConfirmOpen(true)}`) while the
functionally identical "סיים עונה עכשיו" ("end the season now") gets an `appAlert`
confirmation. The code comment at `:16787` argues `played + 1` is a season "reaching its finish
line", which is defensible for the flag and not for the missing confirmation.

**`date-retarget-restarts-the-clock`.** The date branch writes `startsOn: todayIn(now)` and
recomputes `endsOn` from today, while `seasons.startedAt` keeps the season's real start. The
same season then has two start dates: `SeasonsCard`'s progress bar uses `seasons.startedAt`
(`SeasonsCard.tsx:123`) and the settings preview labels today "תחילת העונה" ("start of the
season", `he.ts:2310`). `months` means "length" when a season is enabled and "time remaining
from now" when it is re-targeted, with no word anywhere marking the difference.

**`date-season-cannot-be-renewed-at-the-same-length`.** The save button is gated on
`targetChanged` (`SeasonsSettings.tsx:401`):

```ts
if (cadence === 'rounds') return c?.type !== 'rounds' || c.targetRounds !== rounds;
return c?.type !== 'date' || c.months !== months;
```

For a date club the comparison is on `months` alone — the very field the server does *not*
treat as an identity. An admin who wants "another three months from today", which is precisely
the move the 48-hour reopen grace exists to allow, finds the button disabled and the line
"זה היעד שמוגדר כרגע במועדון" ("this is the club's current target"). The one correct action is
the one the UI calls a no-op.

Finally, `SeasonsSettings` seeds `history` for a live club from `seasons.playedRounds`
(`:336`), which is the same figure the server measures against — so
`settings-screen-validates-a-live-target-against-zero` is fixed at HEAD. Per ROUND4 finding 1,
neither that fix nor any other client fix from 18.09 is in the shipped store binaries, which
were built from `4de80d0`.
