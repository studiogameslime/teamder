## The personal season summary

`SeasonSummaryScreen` (`src/screens/profile/SeasonSummaryScreen.tsx`, 951 lines) is where the
end-of-season push lands every player who took part. It is titled **"סיכום העונה"** *(the season
summary)* and it answers exactly one question: what happened to **me** between the season opening
and its close. Nothing on it is cumulative — the footnote says so in as many words
(`he.seasonSummaryFootnote`: *"all the numbers here are for this season only; the cumulative
statistics are in the profile"*).

Three files do the work. `src/services/seasonSummaryService.ts` (636 lines) fetches;
`src/utils/seasonPersonal.ts` (427 lines) computes, and is pure; the screen and
`src/components/summary/SeasonShareCard.tsx` (348 lines) render. The service is the only place that
knows whether the numbers came from a live collection or from a frozen archive — `buildPersonalSeason`
takes one shape either way, and the screen never learns which it got.

### Two load paths

`seasonSummaryService.load()` (`:416-539`) takes `{ groupId, userId, seasonId? }`. The `seasonId` is
omitted for "the season running now" and set for a specific one.

**Path A — the sealed archive.** If `seasonId` is given, the very first read is the archive
(`:432-446`):

```ts
if (seasonId) {
  const archived = await getDoc(doc(db, 'seasonSummary', `${groupId}__${seasonId}`));
  if (archived.exists()) {
    return fromArchive(archived.data() as Record<string, unknown>, {
      groupId, userId, seasonId,
      seasons: await readSeasons(db, groupId),   // may be undefined
    });
  }
}
```

Archive-first is deliberate and load-bearing: a player who has since **left the club** cannot read
`/groups/{groupId}` at all, but the push about a season they played still points here. `readSeasons`
(`:322-335`) swallows its own permission error and returns `undefined`, in which case
`available` degrades to a one-entry picker holding only this season (`:405-407`). Everything else
— the club's name, the final table, the pair counters, the titles — comes out of the one document.
Cost: **two document reads**, one of which is optional.

**Path B — the live tables.** Falling through means the running season. It reads the club document
for `seasons` (bailing with `null` if `seasons.enabled` is false), then three queries in parallel
(`:465-481`):

```ts
const [statRows, asA, asB] = await Promise.all([
  getDocs(query(collection(db,'communityPlayerStats'), where('groupId','==',groupId))),
  getDocs(query(collection(db,'communityPairStats'),  where('groupId','==',groupId), where('a','==',userId))),
  getDocs(query(collection(db,'communityPairStats'),  where('groupId','==',groupId), where('b','==',userId))),
]);
```

The pair collection is stored once per unordered pair under a sorted key, so "my pairs" is the union
of the rows where I am `a` and the rows where I am `b`. On the one club that runs seasons
(`HhzIwmjMl1i5HSOGHt3p`, מועדון שכחת שושי) the collection holds **314 pair documents**, and for
`1IdtNEjbEXfiRSqvLrJVn99NsfI2` (מתן לוי, whose uid sorts first) the `a` query returns 39 and the `b`
query 0. So one open of the live path costs 1 group doc + 7 stat docs + 39 pair docs + up to 6
`/users` reads ≈ **50 document reads, repeated on every pull-to-refresh**, against 2 for the archive.
Many of those 39 pair rows are `guest:…` partners that `orient()` discards a moment later.

### What differs between the two paths

| | Archive (closed) | Live (running) |
|---|---|---|
| Player rows | `d.players` map, uid → row | `communityPlayerStats` query |
| Pair rows | `d.pairs` map | two `communityPairStats` queries |
| `completedRounds` | `d.completedRounds` (`:382`) | `seasons.playedRounds` (`:512`) |
| `groupName` | frozen in the archive | live `groups.name` |
| `endsAt` | `d.endsAt` | `null` |
| `roundsCadence` | never set | set iff `cadence.type === 'rounds'` (`:515-523`) |
| `myTitles` / `seasonTitles` | from `d.awards` | **always `[]`** (`:526-527`) |
| Peer names | frozen `displayName` only | `/users` fetch |
| `peerAvatars` | **always `{}`** (`:404`) | avatar from the same `/users` fetch |
| Reads | 2 | ~50 |

Two consequences follow from that table and both are visible to users. Titles do not exist for a
running season by design — they are decided when the numbers stop — so the "תארים בעונה" card is
gated on `me.hasData && model.closed` (screen `:476`). And the archive path deliberately makes no
`/users` read, so **every peer row on a closed season draws the deterministic fallback disc**. That
is the documented price of a summary that still renders after somebody deletes their account
(`:400-403`), not a bug; the bug (`peer-rows-always-show-the-generic-auto-avatar`, P3) was on the
*live* path, where the user document was already being fetched for the name and the avatar thrown
away. `resolvePeers` (`:277-309`) now keeps both — but note its `frozen` parameter is dead: the only
call site passes `new Map()` (`:496`), because the archive path resolves its own names inline at
`:395-399`.

### Every number on the screen

`buildPersonalSeason` (`seasonPersonal.ts:307-427`) reads **one row** — `players.find(r => r.userId === me)`
— and derives the rest. Absent is zero throughout (`num()`, `:147-148`), which is the root of
`older-archive-degrades-into-plausible-zeros` (P2): a season sealed before a counter existed renders
a confident `0` rather than a dash. Only `csRounds`/`asRounds` are allowed to be absent, and
`playerRow` (`seasonSummaryService.ts:164-165`) preserves that distinction on purpose.

| Field | Derivation | Rendered as (`he.*`) |
|---|---|---|
| `goals` / `assists` | row fields | שערים / בישולים, lead tiles |
| `contributions` | `goals + assists` (`:362`) | "שערים + בישולים" |
| `rounds` | row `rounds` — **mini-games (משחקונים)** | "משחקונים" |
| `evenings` | row `games` — **evenings (מחזורים)** | "ערבי משחק" |
| `wins`/`losses`/`ties` | row fields | ניצחונות / הפסדים / תיקו |
| `winPct` | `wins / rounds` (`:336`, `:368`) | "אחוז ניצחון" |
| `cleanSheets` | row field | "שערים נקיים" |
| `cleanSheetPct` | `cleanSheets / csRounds` (`:340`, `:370`) | "אחוז שער נקי" |
| `goalsPerRound` | `goals / rounds` (`:376`) | "שערים למשחקון" |
| `assistsPerRound` | `assists / **asRounds**` (`:377`) | "בישולים למשחקון" |
| `ownGoals`, `penTaken/Scored/Faced/Saved` | row fields; tiles hidden at 0 (screen `:535-553`) | |
| `partialCoverage` | `rounds > 0 && (csRounds < rounds \|\| asRounds < rounds)` (`:378`) | the note at `:564-566` |
| `hasData` | `rounds > 0 \|\| games > 0` (`:359`) | gates the personal half |

`rate()` (`:155-157`) returns **`null`, never `0`, for a zero denominator** — "an unknown rate is not
a zero one" — and the screen prints `—` for null (`pct`/`per`, screen `:53-55`).

**The three denominators are three different numbers, and that is intentional.** `winPct` divides by
`rounds`; `cleanSheetPct` by `csRounds`; `assistsPerRound` by `asRounds`. Clean sheets have only been
recorded since 17.08 and assists since 21.06, both long after clubs started counting mini-games, so
for any veteran the three tiles in one grid genuinely cannot be reconciled by arithmetic. The
production archive proves it: מתן לוי has `rounds: 26, csRounds: 15, asRounds: 24`. His grid reads
12 שערים נקיים, 80% אחוז שער נקי (12/15, not 12/26 = 46%), 1 בישול, 0.04 בישולים למשחקון (1/24).
`partialCoverage` is true for **all seven players** of s1 — every one has `csRounds < rounds` — so the
explanatory note (`he.seasonPartialCoverageNote`) renders for the whole club.

Two honest criticisms of this design. First, `winPct = wins / rounds` counts ties in the
denominator, which is the weaker statistic; the code says so at `:327-335` and keeps it only because
the club's efficiency table has shipped for months computing the same thing under the same Hebrew
label. Second, `assistsPerRound` dividing by `asRounds` is the *fix* for
`assists-per-round-denominator-disagrees-with-club-efficiency-tab` (P2) — the shipped binary divides
by `rounds` (see the last sub-section), which gave four of the seven s1 players two different
"בישולים למשחקון" one tap apart. **There is no test for it.** `tests/logic/seasonPersonal.test.ts`
(411 lines, 30 cases) has a case for the clean-sheet denominator and not one mention of `asRounds`,
`assistsPerRound` or `partialCoverage`.

#### Worked example — מתן לוי, season 1, from the live archive bytes

```
row: { goals:2, assists:1, rounds:26, games:19, wins:11, losses:9, ties:6,
       cleanSheets:12, csRounds:15, asRounds:24, penTaken:1, penScored:0,
       penFaced:1, penSaved:1, penMissed:1, ownGoals:0 }
```

renders: שערים 2 · בישולים 1 · שערים+בישולים 3 · ערבי משחק 19 · משחקונים 26 · ניצחונות 11 ·
הפסדים 9 · תיקו 6 · אחוז ניצחון 42% · שערים נקיים 12 · אחוז שער נקי 80% · שערים למשחקון 0.08 ·
בישולים למשחקון 0.04 · פנדלים שהובקעו 0/1 · פנדלים שנעצרו 1/1. Note `11 + 9 + 6 = 26 = rounds`
exactly — the win/loss/tie triple does close over the mini-game count on all seven rows, which is
the one invariant here that demonstrably holds.

### The three ranks

`rankOf` (`:258-297`) answers **"what position does the club table put me in"**, not "how many are
ahead of me". Those differ whenever ties are shared, and the difference was user-reported
("המיקום שלי ... לא נכון").

```ts
const played = rows.filter((r) => (num(r.rounds) > 0 || num(r.games) > 0) && isReal(r.userId));
const order = [...played].sort((a, b) =>
    pick(b) - pick(a) ||
    num(b.wins) - num(a.wins) || num(b.goals) - num(a.goals) ||
    num(b.assists) - num(a.assists) || a.userId.localeCompare(b.userId));
const i = order.findIndex((r) => r.userId === me);
const anyValue = order.some((r) => pick(r) > 0);
return { rank: i < 0 || !anyValue ? null : i + 1, of: order.length };
```

Three things to read out of it. **`of` is "who turned up"** — `rounds > 0 || games > 0`, the same
test `hasData` makes, and `isReal` (`:152`) drops `guest:` identities, who are a different person
each week. That `|| games > 0` is the fix for `rank-denominator-of-excludes-attendees` (P1): the
shipped code filters on `rounds > 0` alone, so a timer-only club — which records **zero** mini-games,
ever — gives every player `of: 0` and dashes out seven of the thirteen tiles while the club table one
tap away lists everybody. 23 of the 93 `communityPlayerStats` rows in production have `games > 0` and
`rounds === 0`; those are exactly the players the shipped denominator erases.

**The `anyValue` guard** is the fix for a regression the widening itself caused: with `of` now
counting attendees, a column in which every player has 0 still produced a sort, which fell all the
way through to `userId.localeCompare` and handed three players a **gold medal** for "מקום 1 מתוך 15
בשערים" in a season with no goals in it. A null rank draws no medal (`rankTint`/`rankIcon`, screen
`:119-125`) and prints `—`. It fires only when the *whole* column is zero, though: a player with 0
assists in a column where somebody has 5 is still given an ordinal position rather than a blank.

**The tie-break mirrors the club table's comparator** — and this is where the open P0 lives.
`rankOf` breaks ties on wins → goals → assists → uid. `CommunityStatsTable`
(`src/components/community/CommunityStatsTable.tsx:153-156`) sorts on **one key with no tie-break at
all**:

```ts
return [...effPlayers]
  .sort((a, b) => Number(b[sortKey as keyof ChampionshipRow] ?? 0) -
                  Number(a[sortKey as keyof ChampionshipRow] ?? 0))
  .slice(0, limit);
```

V8's sort is stable, so ties keep the *incoming* order. For a sealed season that order is whatever
`parseSeasonTable` produced, and at HEAD that is `players.sort((a,b) => a.uid.localeCompare(b.uid))`
(`src/utils/seasonArchive.ts:114`) — a uid sort. So the two surfaces break ties on **different**
keys, and the production archive contains a case where they disagree. Assists in s1 are
`{Nofar 5, Lioz 3, Linoy 2, מתן 1, איציק 1, הלן 1, Eliran 0}`. `rankOf` breaks the three-way tie at
1 on wins first (הלן has 12, the other two 11) and reports **הלן 4th, מתן 5th, איציק 6th**. The club
table, sorting stably over a uid-ordered input (`1Idt…`, `JoLF…`, `also…`), lists **מתן 4th, איציק
5th, הלן 6th**. Same document, same season, two screens, two answers — and the summary's answer is
the one that decides whether a bronze medal is drawn and whether the share card prints a placing.

`sealed-season-rank-vs-club-table-nondeterministic` (P0) is worse than that in the **shipped**
binary, where `seasonArchive.ts` has no sort at all and the incoming order is Firestore's map
iteration order: two consecutive reads of the immutable s1 archive returned different key orders, so
the silver ring on the club table moves between refreshes. The HEAD uid sort makes the table
*deterministic*; it does not make it *agree*.

### The six peer rows

All six come from `communityPairStats`, which the round rollup has been filling per mini-game all
along and which the same rollover zeroes — so it is season-scoped for free, with no new counter.

Every read goes through **`orient()`** (`:181-201`), because a pair document is stored once under a
sorted key and which slot I occupy is an accident of my user id:

```ts
const meIsA = row.a === me;
...
myWins:        meIsA ? num(row.winsA)       : num(row.winsB),
theirWins:     meIsA ? num(row.winsB)       : num(row.winsA),
iAssistedThem: meIsA ? num(row.assistsAToB) : num(row.assistsBToA),
theyAssistedMe:meIsA ? num(row.assistsBToA) : num(row.assistsAToB),
```

Getting that backwards is invisible — the screen still renders, it just names the wrong person as
the one you beat all season. `orient` also returns `null` for a guest partner and for a malformed
self-pair, which would otherwise make every player their own best teammate. It was verified over all
21 production pairs and is sound.

**`best()`** (`:211-241`) picks the maximum by `pick`, **excluding zero** (`if (count <= 0) continue`),
tie-breaking on a per-row `tiebreak` and then on `o.other < winner.other` — a total order, so the
same season always names the same person. The six rows:

| Row | Hebrew label | `pick` | tie-break | detail line shows |
|---|---|---|---|---|
| `partner` | הכי הרבה יחד באותה קבוצה | `sameTeam` | `winsTogether` | `count` + `winsTogether` |
| `nemesis` | היריב הכי גדול | `against` | `theirWins` | `count`, `myWins` vs `theirWins` |
| `victim` | מי הובס הכי הרבה | `myWins` | `against` | `count` only |
| `tormentor` | מי ניצח הכי הרבה | `theirWins` | `against` | `count` only |
| `assistedMost` | למי הכי הרבה בישולים | `iAssistedThem` | `sameTeam` | `count` |
| `assistedBy` | ממי הכי הרבה בישולים | `theyAssistedMe` | `sameTeam` | `count` |

`partner`'s `winsTogether` tie-break is deliberate — of two people you played 10 mini-games beside,
the one you kept winning with is the better story. `nemesis` leans the other way, towards whoever
beat you more.

**De-duplication (`:402-423`).** The three rival rows were picked independently, and in a club of
regulars the person you face most is usually also the one you beat most and lose to most. On s1 that
produced the same name and the same face three times for **5 of the 7 players**, and one of them saw
the same person in all four rows he had (`nemesis-victim-tormentor-not-deduplicated`, P1). The fix
runs the three picks in order behind a `taken` set:

```ts
const peer = best(oriented.filter((o) => !taken.has(o.other)), pick, tiebreak)
          ?? best(oriented, pick, tiebreak);
if (peer) taken.add(peer.userId);
```

The fallback to the un-filtered `best` means a player with a single opponent still gets three true
rows rather than two blanks.

**⚠ The de-duplication makes two of the three labels false.** Rows 2 and 3 no longer name the
maximum — they name the best remaining candidate — while the Hebrew label still claims a superlative.
Production, Linoy Levi (`CEkRfDs20x…`), s1, HEAD code:

- `nemesis` → Lioz Madar, detail *"7 משחקונים זה מול זה — 3 ניצחונות מול 4"* (he beat her 4 times);
- `tormentor`, labelled **"מי ניצח הכי הרבה"** *(who beat me the most)* → מתן לוי, detail **"2 הפסדים"**.

Lioz beat her 4, מתן beat her 2, and both numbers are printed on the same card two rows apart. The
old bug produced a repetitive card; the new one produces a self-contradicting one. Neither the label
nor the detail line carries any hedge, and the test suite's two dedup cases (`:353`, `:368`) assert
only that the rows name different people, never that the row is still true.

**⚠ The assist rows describe half the season.** `assistsAToB + assistsBToA` summed over all 21
archived pairs is **7**. `totals.assists` on the same document is **13**, and the seven player rows
also sum to 13. So six of the season's thirteen assists are attributed to no pair at all
(`assist-peers-account-for-half-the-season-assists`, P2). The visible consequence: Nofar Tzabari won
כתר הבישולים with `value: 5`, and one card below, her "למי הכי הרבה בישולים" row reads **איציק לוי ·
2 בישולים**. Three of her five assists are not in the pair data. The legacy undirected `assists`
field on the same pair rows sums to 8 — a third number — which is why
`archive-duo-reader-has-no-floor` matters: the duo title reads the directional fields and the live
scope reads the legacy one.

When both `partner` and `nemesis` are null the card prints `he.seasonPeersEmpty` (screen `:658-662`),
whose copy now names the cause — *"who played with whom is counted only in evenings run from the
advanced live screen"* — rather than the old "it will fill itself up", which is a promise a
timer-only club can never keep (`peers-empty-promises-it-will-fill`, P2).

### Titles, champions, and the "did not play" case

`titlesFor` (`:195-210`) walks the nine `SEASON_TITLE_KEYS` and keeps the ones whose `winners` array
contains me, computing `sharedWith = holders.length - 1`. The duo title is keyed `a__b`, so
membership is tested against `w.split('__')`. `allTitlesOf` (`:219-243`) does the same for the whole
club, resolving each winner through the archive's **frozen** `displayName` map (`'—'` when absent),
and flags `mine`.

s1's awards, live: `topScorer` הלן צברי 10, `topAssister` Nofar 5, `topWinner` Lioz 13, `mostLoyal`
מתן 19, `cleanSheetKing` הלן 13, `penaltyKing` הלן 1.0, `penaltyKeeper` הלן 1.0, `deadlyDuo` **null**,
`mvp` **all seven players** at 6. So the champions card lists eight rows (the null duo is skipped at
`:228`) and every single player holds כתר העונה with `sharedWith: 6`.

The `hasData` split (screen `:463-512`) is the fix for `did-not-play-told-the-season-had-no-games`
(P2). One ternary used to gate both halves, so a player who missed the season got a single card
reading *"לא שיחקת בעונה הזאת"* **and lost the champions list with it** — the list that is identical
for every reader, is the reason the close push sends the whole club here, and was fetched and thrown
away on the way to the render. Now the personal cards stay behind `me.hasData` and the club's do not;
the empty line (`:491-499`) explains the gap and the champions render underneath it. The two strings
are distinct: `seasonSummaryNoRounds` (*"you haven't played this season yet, so there's nothing to
summarise"*) for a running season, `seasonSummaryNoRoundsClosed` (*"you didn't play this season, so
you have no summary from it"*) for a closed one.

**`completedRounds` is the season's EVENINGS**, and it is the note under the standing card:
`he.seasonClubRounds(22)` → *"22 מחזורים שוחקו במועדון בעונה הזאת. המיקום מחושב מול מי ששיחק בה."*
The archive has carried `completedRounds: 22` since the archive existed and it was **read by nothing**
(`archive-completedrounds-never-read-by-client`, P2); the shipped client substitutes `totals.rounds`,
the mini-game count, so the same sealed season reads **22** on the history screen and **37** here, and
a timer-only club reads *"0 משחקים שוחקו"* for a season it played every week of.

### `SeasonShareCard` — what leaves the app as a PNG

The card is rendered off-screen at a fixed `SHARE_CARD_WIDTH = 340` (`:30`) inside a positioned stage
(screen `:691-696`; positioned rather than hidden, because a `display:none` subtree has no layout and
captures blank), and `onShare` (screen `:330-362`) turns it into a PNG with `captureRef` and hands it
to `expo-sharing`. `allowFontScaling={false}` is set on every text node: the capture happens before
anyone can see it, so at Android "Largest" a `100%` used to grow out of its tile and a 30-character
name clipped mid-word.

Its contents, three tiles to a row (`PER_ROW = 3`):

```ts
const mini = me.rounds > 0;
const tiles = [
  { value: String(me.goals),    label: he.statGoals },           // שערים
  { value: String(me.assists),  label: he.statAssists },         // בישולים
  { value: String(me.evenings), label: he.seasonStatEvenings },  // ערבי משחק
  ...(mini ? [ rounds, winPct, cleanSheets, wins, losses, ties ] : []),
];
```

`evenings` first and never conditional; everything after it is a mini-game counter, printed only by a
club that has any. That is the fix for `share-card-is-all-zeros-for-a-timer-only-club` (P1): the
shipped card prints all eight mini-game numbers unconditionally and omits `evenings` entirely, so 23
of the 93 production stat rows produce a card of eight zeros and a dash to send to the group chat,
while the screen behind it says they turned up fourteen times. Even at HEAD a timer-only player's
card is `0 · 0 · N` — better, but two of the three headline numbers are still zero.

**The rank gate** (`:95-99`): `bestRank` is the numerically lowest of the three ranks, and

```ts
const worthShowing = !!bestRank && me.ranks.of > 1 &&
  ((bestRank.rank <= 3 && me.ranks.of >= MIN_CLUB_FOR_PODIUM) || bestRank.rank / me.ranks.of <= 0.34);
```

`MIN_CLUB_FOR_PODIUM = 8`. The shipped gate is `bestRank.rank <= 3 || rank/of <= 0.34` with no
club-size floor, which printed **"מקום 3 מתוך 3"** — last place — in bold on a card about to be sent
(`share-card-rank-gate-still-prints-last-place`, P2). One side-effect of the floor is worth naming:
on a 7-player club, the podium arm can never fire, so only ranks 1 and 2 (0.14 and 0.29) clear the
top-third arm. מתן לוי's best placing in s1 is **3rd in wins of 7** — 0.43 — so his card carries no
placing line at all.

**Titles on the card** print `{name} · {value}` plus, now, `· במשותף עם עוד N שחקנים`
(`:209-211`). `share-card-claims-a-shared-title-as-its-own` (P1) is that `sharedWith` was computed
all along and dropped here: in the shipped binary all seven holders of s1's כתר העונה send the same
exclusive-looking **"כתר העונה · ציון 6.0"** into the same group chat within a minute of each other.

**Two peer lines** — partner and nemesis only (`:220-235`), using `he.seasonSharePartner` /
`seasonShareNemesis`, which were rewritten to say **משחקונים** rather than משחקים (the card prints
"משחקונים" 40pt above, and calling the same unit two things is
`share-card-names-one-unit-two-ways`, P3) and to drop the parentheses, because bidi resolves a closing
paren after a Latin name to RTL and mirrors it — four of the seven frozen s1 names are Latin, and the
PNG that left the app read `"(6 משחקונים("`.

A complete HEAD card for מתן לוי, s1: brand row · `עונה 1` pill · his name · מועדון שכחת שושי ·
tiles `2 / 1 / 19` then `26 / 42% / 12` then `11 / 9 / 6` · no placing line · **כתר ההתמדה · 19
מחזורים** · **כתר העונה · ציון 6.0 · במשותף עם עוד 6 שחקנים** · *הכי הרבה יחד: Lioz Madar · 10
משחקונים* · *היריב הגדול: איציק לוי · 10 משחקונים*.

### ⚠ None of the fixes above is in a shipped binary

Both 1.1.9 store binaries (Android vc235, iOS build 103) were built from `4de80d0`. Every fix
described in this section landed after it and exists only in git. `git diff --stat 4de80d0 HEAD`:
`seasonPersonal.ts` +92/−10, `seasonSummaryService.ts` +88/−21, `SeasonShareCard.tsx` +97/−29. What
users are actually running today:

```ts
// 4de80d0:src/utils/seasonPersonal.ts
:246  const played = rows.filter((r) => num(r.rounds) > 0 && isReal(r.userId));  // no `|| games`
:331  assistsPerRound: rate(assists, rounds),                                    // not asRounds
:339  nemesis:   best(oriented, (o) => o.against,    (o) => o.theirWins),        // no dedup
:340  victim:    best(oriented, (o) => o.myWins,     (o) => o.against),
:341  tormentor: best(oriented, (o) => o.theirWins,  (o) => o.against),
// 4de80d0:src/services/seasonSummaryService.ts
:341  completedRounds: num(totals.rounds),        // 37, not the archive's 22
:461  completedRounds: num(clubSnap.data()?.rounds),  // an extra read of communityStats
```

Read against production s1 that means the live app tells מתן לוי his three rivals are all איציק לוי
— including **"מי ניצח הכי הרבה: איציק לוי"** about a man he beat 5–3 — divides his one assist by 26
instead of 24, and captions the club's season "37" where the hall of fame says "22". An expert
reading HEAD is reading a version no user has.
