## Notifications, security rules, triggers and cost

Everything here is infrastructure the seasons feature borrowed rather than built, and
most of the defects are at the seams — where a new notification type, a new collection
and a new sweep were bolted onto plumbing that already had rules of its own. Line
numbers are HEAD (`e35394a`, 2026-09-18 21:40 +0300); where production and HEAD differ,
that is said explicitly.

### The announcement: `announceSeasonClosed`

`functions/src/index.ts:15324-15373`. One push per player, fanned out after the
archive is sealed, never before.

```ts
// functions/src/index.ts:15332-15361
const snap = await db.collection('seasonSummary').doc(`${groupId}__${seasonId}`).get();
if (!snap.exists) return;
const players = (snap.data()?.players ?? {}) as Record<string, { rounds?: unknown; games?: unknown }>;
const ops: Promise<unknown>[] = [];
for (const [uid, row] of Object.entries(players)) {
  const rounds   = typeof row?.rounds === 'number' ? row.rounds : 0;
  const evenings = typeof row?.games  === 'number' ? row.games  : 0;
  if (rounds <= 0 && evenings <= 0) continue;
  ops.push(createNotificationOnce({
    type: 'seasonSummary', recipientId: uid,
    entityType: 'group', entityId: groupId, reason: `season-${seasonId}`,
    payload: { groupId, seasonId, seasonNo, groupName },
  }));
}
```

Three deliberate choices, all defensible:

1. **The recipient list is the archive, not the club roster.** Somebody who played the
   first half of the season and then left the club is still told what they did; a
   member who never turned up is not sent a screen of zeros. The archive's `players`
   map is the only list that encodes "played this season".
2. **The filter is `rounds || games`, in that order.** `rounds` counts משחקונים
   (mini-games) and is written only by the advanced live screen. A club running the
   plain timer archives `rounds: 0` for every player of every season it will ever
   play, so filtering on `rounds` alone means a timer-only club closes its season and
   tells *nobody*. `games` is evenings attended and every club records it. The fix is
   in — in *this* function. It is not in the security rules (below), which is the
   whole of finding **season-archive-rule-gates-on-minigames**.
3. **Best-effort.** Wrapped in a `try`, failures counted and logged, never rethrown.
   A failed push must not roll back an archive that is already sealed and a live table
   that is already zeroed.

Point 3 has a hole: `createNotificationOnce` **never rejects** — every internal failure
path returns `{ wrote: false, skipped: '…' }` — so the `Promise.allSettled` /
`failed > 0` accounting at `index.ts:15363-15368` is dead code, and can only ever print
`0/N`. That is **season-fanout-failure-accounting-dead**: a fan-out where every
recipient silently failed and one where every recipient succeeded log identically.

### Deterministic ids: `dedupeIdFor` and the cooldown buckets

`functions/src/notificationDedup.ts` is a hand-maintained mirror of
`src/services/notificationDedup.ts` — the functions build has its own `tsconfig`
rootDir and cannot import app source, so the two are kept in lockstep by hand and by a
byte-comparison test.

```ts
// functions/src/notificationDedup.ts:105-121
export function dedupeKeyFor(input: DedupeInput): string {
  return `${input.type}:${input.recipientId}:${input.entityType}:${input.entityId}:${input.reason}`;
}
export function dedupeIdFor(input: DedupeInput, nowMs: number = Date.now()): string {
  const cooldown = cooldownMsFor(input.type);
  const bucket = Math.floor(nowMs / cooldown);
  const raw = `${dedupeKeyFor(input)}__b${bucket}`;
  const safe = raw.replace(/[^A-Za-z0-9:_\-.]/g, '_');
  return safe.length > 480 ? safe.slice(0, 480) : safe;
}
```

The document id *is* the dedupe key plus a bucket number, and the write is
`ref.create()` — atomic, failing with `AlreadyExists` (gRPC code 6) if the id is taken.
That is the entire dedupe mechanism for `seasonSummary`: no unread-suppression query
(`STRICT_UNREAD_DEDUP`, `index.ts:305`, holds only `gameCanceledOrUpdated`) and no
aggregation (`AGGREGATE_ON_DUPLICATE`, `index.ts:352`, only `playerCancelled` and
`gamePlayersJoined`). Its cooldown is **seven days** (`notificationDedup.ts:95`), and
the bucket is a global epoch-week — `Math.floor(now / 604800000)` — so boundaries fall
on Thursday 00:00 UTC.

Worked example, from production. The real close on `HhzIwmjMl1i5HSOGHt3p`
(מועדון שכחת שושי) ran at `createdAtMs = 1789661534040` = **2026-09-17 16:12:14 UTC**.
`1789661534040 / 604800000 → 2959`. The seven documents written are literally named:

```
seasonSummary:1IdtNEjbEXfiRSqvLrJVn99NsfI2:group:HhzIwmjMl1i5HSOGHt3p:season-s1__b2959
```

Bucket 2959 opened 2026-09-17 00:00 UTC and closes 2026-09-24 00:00 UTC. Any re-close
of `s1` inside that window — which is exactly what an undo-then-reclose is — mints the
same seven ids, hits `AlreadyExists`, and pushes nobody
(**reclose-after-undo-notifies-nobody**). The key itself is sound: `season-s1` sits in
the `reason`, so a *different* season reaches everybody. It is the seven-day bucket that
makes a same-season retry unreachable for up to a week.

### Why nobody has ever received a season-summary push

This is the P0: **season-push-type-not-implemented-in-prod**.

`onNotificationCreated` (`index.ts:1874-1998`) is an `onDocumentCreated` trigger on
`notifications/{id}`. Its shape:

```ts
// index.ts:1941-1951
const canonical = await canonicaliseNotificationPayload(notif.payload);
const message = buildMessage(notif.type, canonical);
if (!message) {
  await snap.ref.update({ delivered: true, deliveredAt: Date.now(), skipped: 'type-not-implemented' });
  return;
}
```

`buildMessage` (`index.ts:660-1122`) is a `switch` over the type with
`default: return null`. Its `seasonSummary` case, `index.ts:1101-1112`:

```ts
case 'seasonSummary': {
  const no = typeof payload.seasonNo === 'number' ? payload.seasonNo : 0;
  const club = typeof payload.groupName === 'string' ? payload.groupName : '';
  return {
    title: no ? `עונה ${no} נגמרה 🏁` : 'העונה נגמרה 🏁',   // "Season {n} is over"
    body: club
      ? `סיכום העונה שלך ב${club} מוכן — שערים, בישולים, ומי שיחק איתך הכי הרבה`
      : 'סיכום העונה שלך מוכן — שערים, בישולים, ומי שיחק איתך הכי הרבה',
  };
}
```
("Your season summary at {club} is ready — goals, assists, and who played with you
the most.")

The case exists in source. It did not exist in the **deployed** reader on 17.09. The
writer (`announceSeasonClosed`) had been redeployed twice that day; `onNotificationCreated`
had not been redeployed since 07.09. Production proves it — all seven documents,
read today:

| field | value |
|---|---|
| `type` | `seasonSummary` |
| `delivered` | `true` |
| `skipped` | `type-not-implemented` |
| `stats` | *(absent)* |
| `read` | `false` |
| `deliveredAt` | 1789661535069 – 1789661535113 (≈1.0 s after creation) |

Seven documents, seven `type-not-implemented`. Six of the seven recipients had live
FCM tokens at the time. The season-summary push — the thing the entire close builds
towards — has been delivered to **zero people, ever**.

Two aggravations:

* **It is unreplayable** (**season-push-unreplayable**). The docs are stamped
  `delivered: true`, so even if `onDocumentCreated` re-fired it would return at
  `index.ts:1879`. And `onDocumentCreated` does not re-fire on an update in any case
  — the same trap that hid 39 undelivered `teamsGenerated` documents for eleven weeks
  (ROUND4 #3). Recovery needs either a manual re-mint with a different id, or waiting
  out bucket 2959.
* **The bail happens *after* `canonicaliseNotificationPayload`**, which reads
  `groups/{groupId}` per notification (`index.ts:1848-1868`). The 17.09 close therefore
  spent seven reads of the same club document building a message it immediately threw
  away.

`gcloud functions describe` puts `onNotificationCreated`'s last update at
**2026-09-18T18:16:54Z**, i.e. after commit `8235851` (18:14 UTC) — so the reader in
production today does contain the case. Nothing has closed a season since, so this is
still untested against a real delivery.

### Delivery: `deliverBatch`, the dormant gate, and the toggle that does not exist

`deliverBatch` (`index.ts:1511-1789`) turns recipients into FCM tokens and sends. Three
gates, in order, per recipient:

```ts
// index.ts:1548-1578 (abridged)
const prefKey = type === 'approved' || type === 'rejected' ? 'approvedRejected'
  : type === 'friendRequest' || type === 'friendRequestAccepted' ? 'friendRequest'
  : type;
for (const user of recipients) {
  if (user.notificationPrefs?.[prefKey] === false) { skippedPref++; continue; }
  if (dormantGated) {
    const ls = typeof user.lastSeenAt === 'number' ? user.lastSeenAt : 0;
    if (ls > 0 && ls < dormantCutoff) { skippedDormant++; continue; }
  }
  const userTokens = (user.fcmTokens || []).filter(t => typeof t === 'string' && t.length > 0);
  if (userTokens.length === 0) { skippedNoToken++; continue; }
  …
}
```

**The dormant gate.** `DORMANT_PUSH_CUTOFF_MS` is 21 days; `DORMANT_SUPPRESSIBLE`
(`index.ts:326-347`) lists the suppressible types. `seasonSummary` is deliberately
**excluded**, with a comment arguing that the person a closing season is most for is
exactly the one who played the first half and drifted off, and that it fires once per
season. Sound in isolation; unsound in combination with the next paragraph.

**The preference key does not exist.** `prefKey` for `seasonSummary` falls through to
the 1:1 branch, i.e. the key `seasonSummary`. But `defaultNotificationPrefs`
(`src/types/index.ts:405-424`) has no such key, and `readNotificationPrefs`
(`src/firebase/firestore.ts:453-463`) rebuilds the object by iterating the *default*
key set:

```ts
const out: NotificationPrefs = { ...defaultNotificationPrefs };
(Object.keys(out) as (keyof NotificationPrefs)[]).forEach((k) => {
  if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
});
```

A stored `seasonSummary: false` is discarded on read and can never be written back, and
the settings screen builds its switches from the same list, so there is no switch. Net
effect: `seasonSummary` is the one type in the app that **ignores the dormant cutoff and
has no off switch anywhere**. A comment at `index.ts:1539-1547` says exactly this. Same
for `eveningSummary` (ROUND4 #20).

**The stats block.** After delivery, `index.ts:1990-1997` writes:

```ts
await snap.ref.update({
  delivered: true, deliveredAt: Date.now(),
  stats: { ok: totalOk, failed: totalFailed, skippedPref, skippedNoToken, skippedDormant },
});
```

`skippedDormant` was added only in the round-4 pass. Before it, 279 of the 1,206
notification documents carrying a stats block (23%) read
`{ok:0, failed:0, skippedPref:0, skippedNoToken:0}` — a deliberately-suppressed
announcement and a silently-broken dispatcher were indistinguishable (ROUND4 #14).
There is no in-app notification inbox, so this block is the only durable record that a
push existed; the corresponding Cloud Run log line ages out after 30 days.

What the seven recipients would have looked like had the reader worked, from a live
read of `/users/{uid}` and `/users/{uid}/private/push`:

| recipient | tokens | `lastSeenAt` | outcome |
|---|---|---|---|
| מתן לוי | 4 | 2026-09-18 | delivered |
| Lioz Madar | 1 | 2026-09-16 | delivered |
| Linoy Levi | 1 | 2026-08-29 | delivered |
| איציק לוי | 1 | 2026-09-14 | delivered |
| Nofar Tzabari | 1 | 2026-09-04 | delivered |
| Eliran Tzabari | 1 | 2026-09-19 | delivered |
| הלן צברי | **0** | 2026-06-05 | `skippedNoToken` |

Note the last row: 104 days dormant, and *not* suppressed by the dormant gate (because
`seasonSummary` is exempt) — she is skipped only because she happens to hold no token.
None of the seven has a `notificationPrefs` map at all except מתן לוי, whose map has no
`seasonSummary` key, because it cannot.

### The deep link

`src/navigation/navigationRef.ts:359-373`:

```ts
case 'seasonSummary': {
  const seasonId = typeof data.seasonId === 'string' ? data.seasonId : undefined;
  if (groupId) {
    nav.navigate('ProfileTab', { screen: 'SeasonSummary', initial: false, params: { groupId, seasonId } });
    return true;
  }
  return false;
}
```

`SeasonSummary` is registered in all three stacks that can host it
(`ProfileStack.tsx:162`, `CommunitiesStack.tsx:150`, `GameStack.tsx:172`), so the known
nav-registration trap — `navigate()` silently no-ops for a screen missing from the
active stack — does not apply. The push carries `groupId` and `seasonId`, so the route
resolves. The screen then loads through `seasonSummaryService.load`
(`src/services/seasonSummaryService.ts:411-540`), which is **archive-first** when a
`seasonId` is given (`:433`) precisely so a departed player never touches `/groups/{id}`,
which they can no longer read. That design is correct, and it is exactly what the rules
then break.

### Security rules

Two traps this repository has been bitten by, both of which are load-bearing here.

**Trap 1 — a `list` query does not bind path wildcards.** In `match /x/{docId}`, a
query (as opposed to a single-document `get`) evaluates the rule with `docId`
unbound — it reads as `null`. Any expression touching it raises a *Null value error*,
and a raised error denies the **entire query**, not just one document. The workaround
throughout this file is to answer `list` from a **field** on the document and to add a
separate `allow get` for the by-id path.

**Trap 2 — `.get(k, default)` defaults only on ABSENT, never on present-null.** A
document holding `k: null` returns `null`, not the default; the comparison downstream
(`null > 0`, `uid in null`) then raises, and the request is denied. This bit production
before, on `guestsOpenAt: null` blocking non-admin guest-add.

#### `/seasonSummary/{doc}` — `firestore.rules:2121-2164`

```
allow read: if isGroupMemberSafe(resource.data.get('groupId', ''));
allow get:  if isGroupMemberSafe(resource.data.get('groupId', '')) ||
  (request.auth != null &&
   request.auth.uid in resource.data.get('players', {}) &&
   (resource.data.players[request.auth.uid].get('games', 0) > 0 ||
    resource.data.players[request.auth.uid].get('rounds', 0) > 0));
allow write: if false;
```

The split is Trap 1 applied correctly, and keeping the participant clause *out* of
`list` is subtler and also correct: a `list` is evaluated per document and the whole
query dies if any one fails, so a participant clause there would deny a member's
*entire* season history the moment it contained one season they sat out.

**The defect: `games` in that clause is younger than the deployment.** HEAD has
`games > 0 || rounds > 0`. The previous commit (`f446474`) has `rounds > 0` alone, and
the `games` half landed in `8235851` at 2026-09-18 21:14 +0300. Both server sides — the
close's participant filter and the push fan-out above — were corrected first. So there
is a window in which the server pushes a season summary to every ex-member of a
timer-only club and the deep link lands on `permission-denied`: the precise failure the
clause exists to prevent. That is **season-archive-rule-gates-on-minigames**, confirmed
independently three times in round 3 and again as ROUND4 #8. I could not read the live
ruleset from this session (the Firebase Rules API returns 403 for these credentials), so
whether the deployed ruleset is `f446474` or `8235851` is an **open question for the
reviewer** — but the source history establishes that the two sides were out of step for
at least four days.

The clause has not fired in production yet, and the honest reason is that the only club
that has ever closed a season is an *advanced-mode* club: all seven archived rows carry
`rounds` between 24 and 26 alongside `games` between 18 and 19. The rules gate passes
on `rounds` for every one of them. The trap is waiting for the first timer-only club.

Trap 2 is **latent, not live**, here. `closeSeason`
(`functions/src/seasonRollover.ts:367-380`) writes every `PLAYER_SEASON_FIELDS` entry
through `num()`, which coerces to a real number, so `games` and `rounds` are always
present integers. `csRounds`/`asRounds` are deliberately *omitted* when absent
(`seasonRollover.ts:376-378`) rather than written as `0` — which is the right shape for
`.get(k, default)` and would still be safe if a rule ever read them. The exposure is
one `?? null` away: a writer that ever emits `games: null` turns `allow get` into a hard
deny for every participant, with no error the client can explain.

#### `/seasonCards/{doc}` — `firestore.rules:2105-2109`

```
allow read: if isGroupMemberSafe(resource.data.get('groupId', ''));
allow get:  if isGroupMemberSafe(resource.data.get('groupId', ''));
allow write: if false;
```

`read` already means `get` + `list`, and both statements carry the **identical**
expression, so `allow get` is a no-op. Harmless, but the comment above claims the pair
exists for the list/get split — true of `/communityStats` (`:2093-2094`, where the two
expressions genuinely differ: field vs path wildcard) and false here.

Note also that the card is **members-only, with no participant clause**: a departed
player can open the sealed archive of a season they played but cannot see the club's
list of seasons, which makes the hall of fame a member-only surface by construction.

#### `/clubRecords/{groupId}` — `firestore.rules:1813-1815`

```
match /clubRecords/{groupId} { allow read, write: if false; }
```

Fully server-only. This holds `eveningsSealed`, the all-time counter
`seasons.roundsAtStart` is seeded from. Because the client cannot read it, season
progress had to be mirrored onto the club document as `seasons.playedRounds`
(`index.ts:5219-5232`) — a second copy of a number, and the origin of a good deal of the
"22 on one screen, 0 on the next" family of defects. The rule is right; the mirror it
forces is the cost.

#### `groups.seasons` — `firestore.rules:334-341` and `376-396`

Create: `!('seasons' in request.resource.data)` — a club cannot be *born* holding a
seasons block. Without it, anyone could plant `enabled: true` with an arbitrary
`count`, and the hourly sweep would adopt the club without `enableClubSeasons` ever
having run.

Update: the whole map is pinned.

```
( !affectedKeys().hasAny(['seasons']) ||
  ( 'seasons' in resource.data &&
    request.resource.data.seasons == resource.data.seasons ) )
```

Server-owned and immutable from the client, which is correct: four callables exist
because enabling can seal a club's whole history and closing archives, zeroes every stat
row and awards nine permanent titles. Note that this is a whole-map equality comparison,
and the live cadence genuinely contains present-nulls
(`{"targetRounds": 24, "months": null, "endsAt": null, "endsOn": null, "startsOn": null}`
on the real club today) — map equality handles nulls fine, so Trap 2 does not apply.

#### `games.seasonId` — nowhere

`grep -n seasonId firestore.rules` returns **zero hits**. The stamp that decides which
season an evening belongs to is not mentioned in the rules at all. Consequences
(**games-seasonid-unpinned**):

* `allow create` (`:794-822`) validates a named handful of fields and says nothing
  about extras, so a member can create a game already carrying any `seasonId` they
  like.
* The organiser/admin branch of `allow update` (`:1172-1244`) can "mutate ANYTHING
  except terminal lifecycle states" plus `createdBy` and `groupId` — `seasonId`
  included.
* The server stamp is **write-once by absence-check**
  (`index.ts:5803-5812`: `!(after as { seasonId?: string }).seasonId`), so a
  client-planted stamp is never corrected. It is accepted as authoritative by both
  `src/utils/seasonScope.ts` (client) and `functions/src/seasonCounters.ts` (server).

This is not hypothetical. Production, today, on the one club that runs seasons
(`seasons = { currentNo: 2, currentId: 's2', count: 1 }` — so `s3` does not exist and
never has):

| date | game | status | `seasonId` |
|---|---|---|---|
| 2026-06-28 → 2026-09-15 (19 games) | … | finished | *(none)* |
| 2026-09-16 | `yA48XsyCEP` | finished | `s1` |
| 2026-09-17 | `nRHEgxVt3j` | finished | `s1` |
| 2026-09-17 | `TZ7IWEJWVw` | finished | `s1` |
| 2026-09-17 | `DTNscolRoj` | finished | **`s3`** |

`DTNscolRoj` is stamped with a season the club has never reached, produced by a
close/close/reopen sequence on 17.09. It belongs to no scope: the client's
`inSeason()` rule (`seasonScope.ts:28-36`) says "stamped → must equal `currentId`",
so it is excluded from s2; `s1`'s archive is sealed and cannot gain it; there is no
`s3` card or archive to hold it. The stamp is write-once and finished games are
client-read-only, so **nothing in the app can repair it**
(**seasonid-stamp-orphan-unrepairable**). It is also live: the seal's
`tableZeroedAt`/`seasonRoundsAtStart` split (`index.ts:5050-5106`) exists *because* of
this document — the code comment names it.

The nineteen unstamped games are not a bug in themselves; "your history becomes season
1" is what enabling the feature promises, and both sides implement it. But the client
implemented it months before the server did, which is
**unstamped-season-1-rule-disagrees-with-the-server-by-19**.

### Triggers

#### `onGameRosterChanged` — `index.ts:5295`

An `onDocumentWritten('games/{gameId}')` trigger and the largest function in the app,
firing on **every** write to a game: join, cancel, arrival check-in, admin edit, status
flip, mini-game commit. End to end it handles deletion bookkeeping (`gameDeletions` +
the cancellation fan-out, `:5355-5428`), capacity notices, waitlist promotion and
`spotOpened`, the pending-joiner buffer, holiday notices, the registration-open
announcement, the join-request fan-out to admins — and four blocks that belong to
seasons.

**Block 1 — the club document, fetched once.** `:5452-5476`.

```ts
let stampedSeasonId = '';
let groupSnapOnce: Promise<admin.firestore.DocumentSnapshot> | null = null;
const groupOnce = (): Promise<admin.firestore.DocumentSnapshot> => {
  if (groupSnapOnce) return groupSnapOnce;
  const p = db.collection('groups').doc(String(after.groupId ?? '')).get();
  groupSnapOnce = p;
  p.catch(() => { if (groupSnapOnce === p) groupSnapOnce = null; });
  return p;
};
```

Four consumers wanted `groups/{groupId}` and each opened it for itself, so one sealed
evening read the same club document **three times** in a single invocation
(**group-doc-read-three-times-per-sealed-evening**). Fixed. Note the deliberate detail:
the *success* is memoised, never the failure — `??=` cached the rejected promise, so one
transient blip cost the invocation its season stamp, its progress mirror *and* the
join-request push, three blocks that used to fail independently (ROUND4 #22).

**Block 2 — the season stamp.** `:5760-5851`.

```ts
const stampStatusChanged = before?.status !== after.status;
const stampRetryPending = (after as { seasonStampRetry?: boolean }).seasonStampRetry === true;
if (after.groupId && (stampStatusChanged || stampRetryPending) &&
    !(after as { seasonId?: string }).seasonId &&
    (after.status === 'active' || after.status === 'finished')) {
  const gSnap = await groupOnce();
  const seasons = gSnap.data()?.seasons;
  if (seasons?.enabled && seasons.currentId) {
    await event.data!.after.ref.update({ seasonId: seasons.currentId, ...clearRetry });
    stampedSeasonId = seasons.currentId;
  }
}
```

The status-transition gate is the fix for the second half of
**group-doc-read-three-times-per-sealed-evening**: with the absence-check alone, a club
that runs no seasons never gets a stamp written, so `!after.seasonId` stays true for
ever and *every* write to an active or finished game re-read the club document to be
told the same thing again. 191 of the 195 clubs in production have seasons off. The
`seasonStampRetry` marker restores the retry the transition gate removed — an evening
that loses the group read on both transitions would otherwise never be stamped, and an
unstamped evening is filed under season 1 by both sides. No game in production currently
carries the marker.

**Block 3 — the seal's season mirror.** `:5050-5232`, inside `sealRoundSummary`. Reads
`groupOnce()`, decides via the evening's stamp whether it credits the *running* season,
and if so increments `groups/{id}.seasons.playedRounds` on the same batch that seals the
evening.

**Block 4 — close-on-target.** `:5269-5291`, after the batch commits.

```ts
if (seasonRoundsAtStart !== null && liveSeasons) {
  const playedNow = typeof liveSeasons.playedRounds === 'number' && liveSeasons.playedRounds >= 0
    ? liveSeasons.playedRounds + 1
    : eveningsSealed + 1 - seasonRoundsAtStart;
  const gName = (await args.groupOnce()).get('name');
  await closeSeasonIfRoundsTargetMet(groupId, gameId, { name: …, seasons: liveSeasons, played: playedNow });
}
```

A rounds season closes the instant the evening that meets it is sealed, not at the top
of the next hour. Only a rounds cadence can close this way; a date cadence is the
sweep's job.

#### `cronEvery60Min` — `index.ts:13585-13606`

```ts
export const cronEvery60Min = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'Asia/Jerusalem', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    await runSweep('cleanupStaleGames',   runCleanupStaleGames);
    await runSweep('sendPromotePrompts',  runSendPromotePrompts);
    await runSweep('holidayGameNotices',  runHolidayGameNotices);
    await runSweep('dailyCleanup',        runDailyCleanupIfDue);
    await runSweep('clubActivity',        runClubActivityIfDue);
    await runSweep('seasonRollovers',     runSeasonRollovers);   // ← LAST
  },
);
```

Six sweeps, **sequential**, one 540-second budget. The seasons sweep runs last and
inherits whatever the other five leave; `runSweep` swallows each sweep's exception so
one failure cannot starve the rest, but it cannot give back time. Two structural notes:
`'every 60 minutes'` is an *interval*, not a cron expression, so `timeZone` is inert
(P3 `cron-is-an-interval-not-a-clock`); and the timeout was raised from the 60-second
default specifically because a close is a transaction per player plus a transaction per
pair plus a batch of titles.

`runSeasonRollovers` (`:16055-16283`) defends its position with two constants:
`SEASON_SCAN_PAGE = 200` (`:16026`) and `MAX_CLOSES_PER_SWEEP = 5` (`:16042`). Without
the second, one sixty-player club with a few thousand pair documents can spend the whole
remainder and every club after it in the scan is silently never reached.

The scan itself (**sweep-scan-fetches-the-whole-group-document**, fixed at HEAD):

```ts
let q = db.collection('groups')
  .where('seasons.enabled', '==', true)
  .select('name', 'seasons')
  .orderBy(admin.firestore.FieldPath.documentId())
  .limit(SEASON_SCAN_PAGE);
if (cursor) q = q.startAfter(cursor);
```

**This reduces bytes, not billed reads.** Firestore charges one document read per
document returned regardless of projection; `.select()` trims the payload (2,259 bytes
→ 666 measured) and `.limit()` + cursor bound memory, but the read count for a club
with seasons enabled is unchanged at one per sweep pass. The cost table below counts
reads, not bytes, and is not improved by this fix.

**due-but-blocked-is-invisible-forever**, also fixed at HEAD: a due season that
`clubIsQuiet` refuses used to emit one `console.log` per hour, for ever, while a season
that *threw* went into the `errors` inbox a person reads. The fix stamps
`seasons.dueBlockedSince` the first hour a due season cannot close and, past
`DUE_BLOCKED_STUCK_MS` (24 h), calls `reportServerError({operation: 'seasonRolloverBlocked'})`
— reported, never thrown, so the sweep still reaches every other club. Verified today:
the production `errors` collection holds **21 documents, none of them seasons-related
and none with `platform: 'server'`**, which is consistent with the old behaviour and
means this path has never yet produced a row. The club's live `seasons` map carries no
`dueBlockedSince`.

### Cost

Counts are Firestore **document reads**. The branch this work sits on is named
`perf/firestore-read-costs`, so this is the ledger it exists for.

Today's scale, read live on 2026-09-19: **195 groups**, **1 with `seasons.enabled == true`**,
95 games (91 finished), 93 `communityPlayerStats` rows, 717 `communityPairStats` rows,
675 users, 1,231 notifications.

#### Per sealed evening

| club state | reads attributable to seasons |
|---|---|
| seasons OFF (191 clubs) | 2 — one `groups/{id}` on the `active` transition, one on `finished`, both via `groupOnce` and both answering "no". Before the transition gate this was one read per *write* to the game while active or finished: dozens per evening, for ever. |
| seasons ON, target not met | 1 — `groupOnce`, now shared by the stamp, the seal mirror and the close check. Was 3. |
| seasons ON, target met | 1 (`groupOnce`) + `clubIsQuiet`: 2 queries (≤2 + ≤3 documents) and up to 3 `roundSummaries` gets, minus the just-sealed evening. Then a full close. |

Writes per sealed evening with seasons on: one `seasonId` stamp (once in the evening's
life) and one `seasons.playedRounds` increment folded into the existing seal batch.

#### Per close

Measured against the real club and then extrapolated. `closeSeason`
(`functions/src/seasonRollover.ts:306-…`) opens with three parallel reads:

```ts
const [psSnap, csSnap, pairSnap] = await Promise.all([
  db.collection('communityPlayerStats').where('groupId', '==', groupId).get(),
  db.collection('communityStats').doc(groupId).get(),
  db.collection('communityPairStats').where('groupId', '==', groupId).get(),
]);
```

| step | reads, real club (7 players) | reads, 60-player club |
|---|---|---|
| `performSeasonClose` pre-flight `groups/{id}` | 1 | 1 |
| `communityPlayerStats` where groupId | 7 | 60 |
| `communityStats/{id}` | 1 | 1 |
| `communityPairStats` where groupId | **314** | ~2,700 |
| `getAll` of `/users` for display names | 7 | 60 |
| `seasonSummary` latch `get` | 1 | 1 |
| per-player wind-back transactions (1 read each) | 7 | 60 |
| `communityStats` wind-back transaction | 1 | 1 |
| `sealedEveningsOf` → `clubRecords/{id}` | 1 | 1 |
| lifecycle advance transaction | 1 | 1 |
| `announceSeasonClosed` → `seasonSummary` re-read | 1 | 1 |
| `onNotificationCreated` ×N: `canonicalise` `groups/{id}` | 7 | 60 |
| `onNotificationCreated` ×N: `loadUsers` (root + `private/push`) | 14 | 120 |
| **total** | **≈363** | **≈3,067** |

The pair row dominates and is almost pure waste
(**guest-pairs-make-every-close-read-15x-what-it-archives**). Of the club's 314 pair
documents, 293 are guest pairs — a guest id is minted fresh for every game, so the
collection gains a permanent document per stranger per night and nothing ever deleted
one. The archive keeps none: the log for the real 17.09 close reads "kept 0, dropped 293
guest, 21 empty" — 314 read, zero archived. HEAD deletes guest pairs during the
wind-back (`seasonRollover.ts:926-948`); the 314 are still there today because that code
was committed after the only close.

Two more line items are pure overhead: the seven `canonicalise` reads of one club
document (one per notification, all identical, all discarded when `buildMessage`
returned null), and the `/users` read per close that exists only to stamp `closedBy` /
`closedByName` — two fields **read by nothing** (**closedby-write-only**).

#### Per sweep run

`runSeasonRollovers` costs, per hour:

* **1 read per club with `seasons.enabled == true`** — the paged scan. Today: **1**.
* Clubs not yet due stop there: a date cadence is answered from the document in hand,
  and `completedRoundsOf` is called only for a rounds cadence, and then only via the
  `playedOnce()` memo (`:16114-16124`) so the value is computed once instead of the
  two identical derivations it used to do.
* A due club adds `clubIsQuiet`: 2 game queries plus up to 3 `roundSummaries` gets ≈ 5–8.
* A due-and-quiet club adds a full close (table above).

| scale | sweep reads/hour | sweep reads/day |
|---|---|---|
| today (1 enabled club, not due) | 1 | 24 |
| 1,000 enabled clubs, none due | 1,000 | **24,000** |
| 1,000 enabled clubs, 5 due and quiet | 1,000 + 5×~363 ≈ 2,815 | ~67,600 |

24,000 reads/day is the floor at 1,000 clubs, it buys nothing on the ~999 not due, and
it is the number `.select()` does *not* reduce. The obvious improvement — a
`where('seasons.cadence.endsAt', '<=', now)` filter — is not implemented, and cannot
cover a rounds cadence, whose due-ness is not a field on the club document.

The 5-close ceiling interacts badly with scale: at 1,000 clubs on a weekly rhythm, more
than five will routinely be due in the same hour, and a club deferred behind a busier
neighbour has no priority or fairness mechanism — the scan order is document-id
ascending, for ever. Nothing tests any of this (**nothing-tests-the-sweep**: zero tests
for `runSeasonRollovers`, `clubIsQuiet`, or the ordering).

#### Per statistics-screen open

Season-scoped club statistics come from `gameService.getCommunityStats`
(`src/services/gameService.ts:949-1124`), whose single query is:

```ts
const q = query(col.games(),
  where('groupId', '==', groupId),
  where('status', 'in', ['finished', 'cancelled']),
  orderBy('startsAt', 'desc'),
  limit(200));
```

**Up to 200 game documents per open**, season-scoped or not — the season filter is
applied in memory afterwards, via `inSeason()`. On the real club that is 23 reads; on a
club with three years of history it is the full 200, every time the screen is opened,
with no cache. Plus, on the same screen: the club document, `communityStats/{groupId}`,
and a `communityPlayerStats where groupId` scan (7 today, 60 on a large club).

The hall of fame is cheap by design: `seasonHistoryService.list`
(`src/services/seasonHistoryService.ts:116-145`) reads `seasonCards`, not archives —
2,473 bytes per card against 20,596 bytes for the same season's archive, with the
winners already resolved. One read per finished season.

The personal season summary (`seasonSummaryService.load`) is two-shaped: a **closed**
season is one read of `seasonSummary/{groupId}__{seasonId}` plus a peer-name resolve; the
**running** season is `groups/{id}` + `communityPlayerStats where groupId` +
two `communityPairStats` queries (`a == me`, `b == me`), so it scales with roster size
rather than with the season.

Finally, the rules themselves bill reads. `isGroupMemberSafe`
(`firestore.rules:101-106`) performs an `exists()` **and** a `get()` on
`groups/{gid}` — two document accesses per evaluation, cached within a single request.
So every `seasonCards` list, every `seasonSummary` get and every `communityStats` read
adds two billed reads on top of the documents returned. On the archive's `allow get`
the participant clause is free by comparison: membership is a key in the document being
read, so it costs nothing extra.
