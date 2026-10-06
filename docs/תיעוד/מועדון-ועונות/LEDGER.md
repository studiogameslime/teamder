# Seasons audit round 3 — running ledger
(one line per finding; full text lives in the agent transcripts under ../tasks/)

## From "archive reader vs writer"
- P1 awards-denominator-never-reaches-the-medal — `awardsDenominator` is written to
  seasonSummary, never to the card, and READ BY NOTHING (1 grep hit = the write).
  SeasonHistoryScreen grades mostLoyal against completedRounds(22) instead of the
  denominator the title was decided on (19), so 19/19 renders gold not platinum.
  Platinum on מלך ההתמדה is structurally unreachable. MY OWN CODE, today.
- P2 archive-completedrounds-never-read-by-client — seasonSummaryService substitutes
  totals.rounds (mini-games) for completedRounds. Same season reads 22 on one screen
  and 37 on another; reads "0 משחקים" for every timer-only club.
- P2 partialdata-only-on-the-sealnow-path — the "נתונים חלקיים" chip is written only by
  the sealNow branch. Production s1 IS partial (19/22 evenings pre-feature, assists
  only from 21.06, clean sheets from 17.08) and carries no flag.
- P3 closedby-write-only — closedBy/closedByName sealed on every manual close, read by
  nothing. Costs an extra /users read per close.
- P3 archive-duo-reader-has-no-floor — archive duo has no MIN_DUO_ASSISTS floor and
  reads directional fields while the live scope reads the legacy undirected field.
  Production: stats screen names a duo (2 assists) the season refused to crown; tie
  between two pairs broken by map order.
- P2 older-archive-degrades-into-plausible-zeros — every reader fallback is 0/'' so an
  older archive yields confident wrong numbers. Only csRounds/asRounds distinguish
  absent from zero.
- P3 archive-parity-test-is-a-comment — seasonArchiveTable.test.ts fixture is already
  out of date with the writer and asserts nothing about the key set.

## From "mid-season target changes"
- P1 target-history-erased-at-close — targetHistory reset to [] for the next season and
  never archived. Production proves the club's line went 22 -> 2 -> 24 and only the
  last move survives anywhere.
- P1 target-change-can-close-a-season-with-no-confirmation — changing a LIVE target is a
  bare one-tap save: no confirm sheet, no clubIsQuiet, no endedEarly stamp, while
  endSeasonNow (same outcome) has all three. played+1 is accepted.
- P2 target-history-never-shown-to-anyone — written, typed, deserialized, unit-tested,
  rendered by no screen and no Hebrew string exists for it.
- P2 reopen-inherits-the-successor-seasons-target-history — reopen omits targetHistory
  from its merge:true write. Production: the array season 2 holds today was created for
  season 3, 27s after the reopen.
- P2 settings-screen-validates-a-live-target-against-zero — SeasonsSettings pins
  history=0 for any live club, so historyExceedsTarget/historyFillsTarget are dead code
  on the target-change path. Admin learns the constraint only by failing.
- P2 date-retarget-restarts-the-clock — a date re-target rebases endsAt from NOW and
  stamps cadence.startsOn = today while seasons.startedAt keeps the real start; the
  preview labels today "תחילת העונה". months means "length" when enabling and
  "time remaining" when re-targeting.
- P2 archive-originaltarget-is-the-moved-target — originalTarget is the cadence at
  CLOSE, so a season closed by a moved finish line is archived/displayed/reopened
  identically to one that ran its course.
- P3 date-season-cannot-be-renewed-at-the-same-length — targetChanged compares only the
  months number, so the 48h grace "move the finish line" is unreachable for a date club
  wanting the same length again.
- P3 server-accepts-a-one-evening-target — updateSeasonTarget accepts targetRounds:1,
  below the documented MIN_SEASON_ROUNDS=2 floor.
- P3 target-history-entry-carries-no-season-identity — entry has at/by/byName/from/to
  and no seasonId, which is what lets reopen reattach it to another season.

## Verified clean (stated so it is not re-checked)
- Changing a CLOSED season's target is unreachable by any path (rules + no seasonId arg).
- The merge:true cadence trap IS closed in updateSeasonTarget and rebaseCadence — both
  branches null the unused half; production doc is internally consistent.
- Lowering below what has been played is refused, measured on the same number the card
  shows. The gap is at played+1, not at played.

## From my own emulator pass
- The "מותאם אישית" chip works (my earlier taps were in empty space — no bug).
- P1(ux) "סיים עונה עכשיו" and "בטל את סגירת העונה האחרונה" sit adjacent, same size and
  shape, differing only in colour. Right now the second would destroy season 1 — the
  club's only real season, nine titles, every player's summary — and the label names no
  season and states no consequence.

## From "club stats scope and lifetime"  ⚠️ contains the biggest one
- **P0 evenings-22-on-one-screen-0-on-the-next** — getCommunityStats takes an optional
  `season` and only ONE of its five callers passes it (CommunityStatsScreen:192).
  CommunityDetailsScreen, playerCompareService, assistantInsightsService and
  SeasonsSettings pass none. So the club screen renders "מפגשים שנערכו 22 / אחוז ארגון
  96%" and the stats screen renders "מחזורים 0 / 0%". THE USER'S ORIGINAL BUG, still
  live through a different door.
- P1 org-rate-donut-shows-0-percent — the donut is gated on the SCOPE not the value,
  unlike the four beside it. A club that never cancelled an evening is told 0% in green.
- P1 closed-season-tooltip-promises-lifetime-shows-season — the tooltip I wrote says the
  org rate and streaks are lifetime; both are season-scoped. The club's 22-night streak
  is unreachable anywhere in the app after a close.
- P1 activeThisYear-is-season-intersected — "0 שחקנים היו פעילים השנה" for a club whose
  whole roster played this month.
- P1 compare-card-divides-season-goals-by-lifetime-nights — playerCompare + assistant
  both mix a lifetime attendance scan with a season-zeroed stats rollup.
- P1 unstamped-season-1-rule-disagrees-with-the-server-by-19 — client counts unstamped
  into season 1, server's playedEveningsOfSeason does not. 22 vs 3.
- P2 undo-close-orphans-the-season-stamps — game stamped s3 on a club that knows only
  s1/s2; card+archive 404. Belongs to no scope; unrepairable (write-once trigger +
  finished games are client-read-only).
- P2 appearances-rollup-undercounts-the-scan-by-three — scan says מתן לוי attended 22,
  archive/rollup says 19, and mostLoyal was awarded on 19 while the card prints 22.
- P2 archived-goals-silently-zero — a failed seasonCards read leaves archivedGoals at 0,
  collapsing the club badges and level. Bug #4 through a different door.
- P3 goal-share-denominators-exclude-guest-goals — "37% מכל השערים" is 10/27; the club
  scored 31. The guest-goals fun fact is four rows below.
- P3 all-time-fun-fact-says-in-the-season; P3 limit-200-window-is-a-lifetime-label.

## From "seasons security rules"
- P1 seasonsummary-participant-rounds-only — rules authorise on `rounds` (mini-games).
  Both server sides were fixed to use `games` OR `rounds`; the rules were not mirrored.
  Emulator-proven: {rounds:0, games:18} DENIED. Every departed player of a timer-only
  club is pushed a season summary and denied when they open it.
- P2 games-seasonid-unpinned — rules never pin `seasonId`; a member can create a game
  pre-stamped with any season and the server never corrects it (write-once check).
  Emulator-proven, 4 writes succeeded.
- P2 seasonid-stamp-orphan-unrepairable — same orphan as above, from the rules side.
- P2 seasons-rules-tests-advanced-mode-only — every fixture sets rounds>0; no fixture
  carries `games` at all; no rules test touches seasonId on /games.
- P3 seasoncards-dead-get-statement.
- CLEAN: groups.seasons genuinely locked (re-tested against the real 26-field prod doc);
  clubRecords server-only; list/wildcard trap handled; .get() null trap does not bite.

## From "test coverage gaps"  ⚠️ two live defects found through the test lens
- **P0 awards-denominator-derivation-untested — AND IT FLIPPED A REAL TITLE.**
  seasonRollover:413 derives the denominator as `Math.max(...players.games)` = 19, not
  the season's 22. minPenaltyAttempts(19)=2 vs (22)=3. So מלך הפנדלים on the real club
  went to alsobLSA (2 of 2) instead of K5rSGB4J (2 of 3). Permanently, archive is
  write-once. Also means the "half the season" gate is really "half of whatever the best
  attendee managed" — which always admits the top attendee.
- **P1 mvp-awarded-to-everyone-on-the-scale-floor** — eveningScore floors at 6.0 and
  `leaders()` uses floor=0, so all seven players got שחקן העונה at exactly 6.0. Their
  eveningScoreCount is 2-3 against 17-19 games attended.
- **P0 reopen-season1-drops-the-19-unstamped-evenings** — MY FIX FROM TODAY. Pressing
  undo on season 1 right now writes playedRounds:3 while the card and the stats screen
  both say 22. Mirror image of the bug it fixed.
- P1 mirror-each-ignores-its-own-params — eveningPlayedMirror's describe.each declares
  five module pairs and the body hard-codes eveningPlayed. Four mirrors never compared
  (seasonParticipants, seasonSeed, seasonDates, seasonActivation).
- P1 inseason-tested-as-a-private-copy — seasonScopedStats.test.ts re-declares the rule
  instead of importing it. Deleting the real rule keeps the suite green.
- P0 no-test-reconciles-the-three-counters — all four server derivations unexported and
  untested; the only "coverage" is regex over index.ts as a string.
- P1 playedRounds-increment-not-scoped-to-the-stamped-season — verifying an old evening
  credits the CURRENT season.
- P1 groupHydrate-cannot-run since 17.09 (organiserSignals import, PRE-EXISTING) — and
  it is the repo's only test of "a failed refresh must not destroy what we had".
- P1 seasonhistory-error-sentinel-has-no-test; P1 closeSeason/reopenSeason have no
  functional test at all; P2 mirror tests check bytes not correctness; P2 seasonId stamp
  trigger untested; P2 source-grep guards scan one file and are indentation-sensitive;
  P2 rules suites (.mjs) are invisible to `npx jest`; P2 no fixture looks like the real
  club.

## From "awards and the half-season gate" — INDEPENDENTLY CONFIRMS the test agent
- P1 mvp-title-held-by-the-entire-club — awards.mvp has 7 winners of 7 at value 6.
  Confirmed from a third source: a collection-group query over users/*/seasonTitles
  returns 14 docs for this club and SEVEN are `__s1__mvp` value 6. The real
  eveningStandings (16 evenings) DO have a unique leader: alsobLSA 6.931.
- P1 mvp-can-be-won-on-the-no-data-sentinel — eveningScoreCore returns 6.0 both as the
  scale floor AND as "played no mini-games". 6 of the club's 16 evenings are flat 6.0
  for everyone, including all three before the close.
- P1 eligibility-denominator-is-max-attendance — PROVEN by reproduction: recomputing the
  stored awards with 19 reproduces them EXACTLY; with 22 penaltyKing differs. The gate
  was 10 of 22 = 45% while the copy promises half. Self-referential: mostLoyal defines
  the threshold and can never fail it.
- P1 repaired-completedrounds-silently-contradicts-the-sealed-titles — MY REPAIR TODAY.
  minPenaltyAttempts(19)=2, (22)=3. penaltyKing alsobLSA(הלן, 2 of 2) only reachable at
  <=20. At 22 it is K5rSGB4J (Nofar, 2 of 3). Nothing recomputes; awardsDenominator was
  never written; a reopen+re-close would derive 19 again, so 22 can never reach the gate.
- P2 penalty-titles-crowned-on-two-kicks — seasonAwards ranks penalties on a raw rate
  behind a floor of 2, while penaltyStats.ts (same Hebrew name, club card) uses a Wilson
  lower bound written specifically to stop a one-shot 100% winning.
- P2 partialdata-flag-never-set-on-a-target-close (second independent confirmation).
- P2 awards-ignore-the-caller-s-season-length-when-any-row-exists — rows with rounds>0
  and games==0 give seasonEvenings=0 -> all nine titles null, and the copy blames the
  players.
- P3 cleansheetking-ranks-on-count-while-the-club-table-ranks-on-rate — title holder is
  2nd on rate (76.5% vs 80.0%).
- P3 deadlyduo-together-is-collected-and-never-read — the partnership volume gate the
  type promises is not enforced.

## From "personal season summary"
- **P0 sealed-season-rank-vs-club-table-nondeterministic** — parseSeasonTable returns
  players UNRANKED and CommunityStatsTable sorts on one key with no tie-break, so the
  order comes from Firestore map iteration. TWO CONSECUTIVE READS of the immutable s1
  archive returned different key orders. The silver medal ring swaps between reads, and
  the summary's rankOf (deterministic) agrees with neither. The wrong rank leaves the
  app on the share card.
- P1 rank-denominator-of-excludes-attendees — ranks.of counts rounds>0 only, so a
  timer-only club gets of:0 and 7 of 13 tiles dash out. hasData was already fixed for
  this; rankOf was not fixed with it.
- P1 nemesis-victim-tormentor-not-deduplicated — 5 of 7 real players see the SAME person
  in all three rival rows; Eliran sees the same person in ALL FOUR rows he has. And
  "מי ניצח הכי הרבה" names someone מתן beat 5-3.
- P2 assists-per-round-denominator-disagrees-with-club-efficiency-tab — summary divides
  by rounds, efficiency tab by asRounds. asRounds is plumbed all the way in and never
  used. 4 of 7 players see two different numbers.
- P2 assist-peers-account-for-half-the-season-assists — pair counters attribute 7 of 13
  archived assists. The season's top assister (5) is told "2 בישולים" one row below.
- P2 did-not-play-told-the-season-had-no-games — one ternary hides all five cards, and
  the copy says "לא היו משחקים בעונה הזאת" about a 22-evening season with 9 titles.
- P3 peer-rows-always-show-the-generic-auto-avatar (the user doc IS fetched and the
  avatar discarded); P3 clean-sheet-pct-partial-coverage-unflagged (the club table has
  the note, this screen does not); P3 standing-note-third-word-for-mini-games.
- CLEAN: winPct/goalsPerRound/cleanSheetPct denominators match; orient() verified over
  all 21 pairs; best() is a total order; the departed-player read path is sound.

## From "season activation paths"
- **P0 end-season-now-ignores-playedrounds** — index.ts:16060 calls
  `completedRoundsOf(groupId, seasons.roundsAtStart)` with TWO args; every other close
  passes three (…, seasons.playedRounds). So it falls back to eveningsSealed −
  roundsAtStart = 10 − 7 = 3. Pressing "סיים עונה עכשיו" on שכחת שושי right now would
  archive 3 for a season the card says holds 22. Irreversible (summaryRef.create()).
- P1 enable-sealnow-archives-counter-not-games — the sealNow branch archives
  eveningsSealed, while the confirm sheet shows the games scan. At the real activation
  instant the sheet would have said 20 and the archive would have stored 7.
- P1 disable-reenable-zeroes-running-season — the disable dialog promises
  "הספירה תמשיך מהמקום שבו עצרה"; for any club with count>0 the re-enable seeds
  playedRounds:0. Nine evenings of progress gone, startedAt reset too.
- P1 season-id-reissued-with-live-stamps — count advances only on a CLOSE, so
  disable+enable re-issues the same id while old games still carry that stamp. Card says
  0, stats screen still counts the old ones.
- P2 season-plan-refusals-unmapped — all six `season-plan:*` errors reach the admin as
  "משהו השתבש". Same failure mode as the 1.1.7 incident the code comment records.
- P2 reenable-inherits-stale-reopenedat — the 'continue' branch is the only opener that
  does not zero reopenedAt, so a new season can inherit up to 48h of immunity from
  closing. The club carries reopenedAt = today right now.
- P2 rounds-clamp-uses-a-different-history — the clamp uses eveningsSealed, the plan used
  the games scan. Admin approves one length and gets another.
- P3 endson-endsat-one-day-apart (endsAt is the NEXT season's start date);
  P3 seasonevenings-reads-one-after-a-seeded-activation (rank-movement events dropped on
  the first evening after switching seasons on);
  P3 reenable-wipes-targethistory.
- CLEAN: client history and server playedEveningsFromGames agree exactly (both 22 on the
  real data); the calendar maths is DST-safe and clamps month ends; a season NUMBER
  cannot collide with an existing archive.

## From "season close push"  ⚠️ NEW P0 nobody else was looking at
- **P0 season-push-type-not-implemented-in-prod** — the DEPLOYED onNotificationCreated
  predates the seasons feature: `grep -c seasonSummary` in its live bundle = 0. All 7
  notification docs from the 17.09 close read `skipped:'type-not-implemented'`. The
  season-summary push has NEVER been delivered to anybody. 6 of 7 players had live FCM
  tokens. Writer redeployed twice today, reader not since 07.09.
- P1 season-push-unreplayable — the 7 docs are stamped delivered:true and the dedupe id
  is bucketed to the week (__b2959 = 17.09-24.09), so a re-announce is a silent no-op
  until 24.09.
- P1 season-archive-rule-gates-on-minigames (3rd independent confirmation).
- P2 season-fanout-failure-accounting-dead — createNotificationOnce never rejects, so
  `failed` is structurally always 0. A close that reached nobody logs a clean success.
- P2 season-reopen-leaves-notifications-behind.
- P2 season-push-body-promises-three-things-a-timer-club-has-none-of.
- CLEAN: the deep link IS registered in all three stacks; recipient selection is correct
  on the real club; no guests are pushed; the dormant gate correctly exempts it.

## From "season close and archive writer"
- P0 endseasonnow-archives-wrong-length (independent confirmation, same line).
- **P1 stale-pair-woundback-stamp-skips-next-wipe** — the close stamps seasonWoundBack on
  EVERY pair row, the reopen clears it only on pairs it restores. All 314 pair rows on
  the live club now carry `seasonWoundBack:"s2"` = the CURRENTLY OPEN season. The next
  close of s2 will archive the chemistry and skip the wipe entirely; a later undo then
  ADDS the archive on top and the chemistry doubles. ARMED TODAY.
- P1 archive-games-undercounts-every-player — all 7 archived `games` are short by exactly
  their attendance at three evenings that have no finishCredited marker (06.07, 16.07,
  04.08 — the three with no timer and no rotation). מתן 22 vs 19.
- P1 club-totals-zeroed-not-subtracted — the module states "SUBTRACT, do not write
  zeroes"; player and pair rows obey, the club document is set to absolute 0.
- P1 mvp-title-crowns-the-entire-club (3rd confirmation, incl. the 7 seasonTitles docs).
- P1 reopen-playedrounds-from-stamps-only (2nd confirmation of my own bug).
- P2 resume-subtracts-recomputed-row — on resume the wind-back subtracts a freshly
  recomputed row, not the archived one, so an evening played between crash and retry is
  erased instead of carried forward.
- P2 season1-startsat-is-the-enable-moment — "ספט׳ 2026 – ספט׳ 2026" above "22 מחזורים".
- P2 partialdata-never-set-on-a-rollover-close (3rd confirmation).
- P2 close-rewrites-group-block-even-when-not-archived — concurrent seal-close and sweep
  can reset the NEW season's playedRounds to 0 and re-stamp startedAt.
- P3 awardsdenominator-is-write-only-and-absent (3rd confirmation).

## FIXED IN THIS PASS (deploying)
- endSeasonNow now passes seasons.playedRounds (was 2 args -> would have sealed 3).
- playedEveningsOfSeason now applies the unstamped->season-1 rule (was 3, now 22).
- onNotificationCreated redeployed so the seasonSummary push case actually exists.

## From "seasons settings UI"  ⚠️ NEW P0 IN THE SHIPPED BUILD
- **P0 live-club-cannot-use-date-cadence** — planActivation requires season1EndsOn, and
  the only control that sets it renders under `firstTime` (= count===0 && !live). So for
  ANY club already running seasons, or any club with count>0 re-enabling, the date
  cadence is permanently unreachable: the button is dead and the red line says
  "בחרו תאריך סיום לעונה 1" to a club in season 2, with no date control on screen. The
  SERVER was fixed for this (it derives the date itself, with a comment about 1.1.7);
  the client half was not. IN THE 1.1.9 BUILD.
- P1 undo-splits-the-season-count-3-vs-22 (independent confirmation of my own bug).
- P1 reopen-confirm-asserts-a-false-fact — "העונה כבר הגיעה ליעד" is unconditional prose;
  false for a season ended early, which is the case undo exists for. Names no season,
  no round count, and does not say nine titles are deleted.
- P1 card-promises-an-evening-of-grace-that-is-an-hour — "תיסגר בסיום הערב הבא" but the
  hourly sweep closes it with no evening required.
- P1 plan-refusals-render-as-try-again — six written Hebrew explanations are unreachable;
  reopenLastSeason's not-found bails before the substring test so "אין עונה סגורה" is
  dead code. The admin is told a permanent refusal is transient and invited to keep
  pressing a destructive button.
- P2 failed-history-read-empties-the-confirmation-sheet — history 0 hides every line
  about the club's history from the sheet, while the server recomputes 22 and seals it.
- P2 approved-rounds-target-is-not-the-one-written; P2 save-target-restarts-a-date-season
  with no confirmation; P2 end-season-confirm-names-nothing-and-is-not-idempotent (the
  server's own comment claims the client shows the titles first — it does not).
- P3 rounds-stepper-lattice (5,7,9,11 unreachable; 6 and 10 only via a trip to 2);
  P3 season1-end-chips-label-dates-only (dates verified correct over 3 years, zero
  collisions; custom chip opens on the same date as the "3" chip).

## From "share card and summary screen"
- P1 share-card-claims-a-shared-title-as-its-own — sharedWith is computed and dropped.
  All seven holders send the same exclusive-looking "שחקן העונה · ציון 6.0".
- P1 share-card-is-all-zeros-for-a-timer-only-club — all eight card numbers are mini-game
  counters; `evenings`, the one counter every club records, is not on the card. 23 of 87
  prod stat rows have games>0 and no rounds at all.
- P2 share-card-rank-gate-still-prints-last-place — the `rank<=3` arm has no club-size
  floor, so "מקום 3 מתוך 3" prints in bold.
- P2 share-card-breaks-under-os-font-scale — 340pt fixed, allowFontScaling never
  disabled; at Android "Largest" a 100% overflows its tile and a 30-char name truncates.
- P3 share-stage-read-aloud-by-screen-readers; P3 share-button-silent-no-op-on-a-missing
  -ref (no toast, no logError — invisible in the errors collection); P3 UUID filename;
  P3 share-card-names-one-unit-two-ways ("משחקונים 26" then "10 משחקים" 40pt below).
- CLEAN: winPct denominator is correct now (verified on all 7 rows, wins+losses+ties ===
  rounds); two real players verified field by field; a title can never print 0.

## From "adversarial on the new screen" (my own code, today)
- P1 season1-range-prints-a-31-hour-lie — "ספט׳ 2026 – ספט׳ 2026" for a season spanning
  28.06 → 17.09. The startsAt===0 guard is dead because startsAt is the enable moment.
- P1 void-window-satisfied-by-a-real-season — endsAt−startsAt on the real season is 31.6h
  ≤ the 48h VOID_SPAN. Only `players !== 0` keeps the club's whole hall of fame from
  collapsing into one grey dashed line.
- P1 shared-title-slot-names-nobody — `names.length > 2` renders ONLY the suffix
  "במשותף עם עוד 6 שחקנים", naming zero of the seven winners.
- P1 hero-fallback-prints-the-whole-club-at-35pt — no name cap on the winners[0] fallback,
  which is the DEFAULT poster for a timer-only club.
- P1 mvp-medal-can-never-leave-bronze — MVP_STEPS starts silver at 6.5, eveningScore is
  clamped to [6,10]. The headline title always wears the weakest metal while a 2-of-2
  penalty record takes platinum.
- P1 variant-tests-pass-against-the-exact-regression-the-file-warns-about — all 5 tests
  pass against an implementation keyed on totals.rounds. The discriminating case is
  absent.
- P1 cabinet-unvirtualised — 12 seasons = 228 Svg, 336 LinearGradient, 1584 SVG nodes,
  108 elevation layers, 36 concurrent rAF counters, in a plain ScrollView.
- P2 no-titles-copy-blames-players-who-never-existed (branches on winners.length, not on
  the variant); P2 titlestreak-breaks-on-a-rename (names frozen per-season, and the
  join(' ') separator collides); P2 zero accessibility props, tier is colour-only,
  TIER_NAME exported and never rendered, allowFontScaling off down to 9pt.
- P3 gradient locations [0,0.46,1.25] out of the documented 0-1 contract; P3 crest mixes
  a sum and a max; P3 VoidRibbon string-replaces its own i18n prefix back out;
  P3 SeasonHistoryViewed fires on every refresh.
- CLEAN: RTL verified (no left/right/row-reverse anywhere); titleStreak cannot loop;
  medalTier divide-by-zero guarded; shade() correct; the error/refresh state machine is
  genuinely fixed; confetti/sweep do not re-fire.

## From "rollover cron"  ⚠️ THE BIGGEST ONE IN THE WHOLE AUDIT
- **P1(really P0) quiet-legacy-evening-blocks-club-forever** — clubIsQuiet blocks when one
  of the 3 newest finished games has no roundSummaries doc AND didEveningHappen says it
  happened. A legacy close (no `endedBy`) IS 'happened', and roundSummaries only began
  on 26.08.2026. The agent ported both functions and ran them over ALL 91 finished games
  in production: **24 of 30 clubs return {ok:false, blocker:'unsealedGame'} PERMANENTLY.**
  Those clubs can never enable seasons with "seal now", never end a season (button OR
  sweep), and never undo a close. The Hebrew tells the admin to wait for something that
  will never happen. The window only advances when the club plays a NEW evening, and
  those games are terminal.
- P1 perform-close-writes-next-season-even-when-nothing-was-archived — the archived:false
  latch guards only the archive; the lifecycle write runs anyway. A concurrent seal-close
  and sweep resets the OPEN season: startedAt moves, playedRounds zeroed, targetHistory
  erased, count incremented past reality (which then points the undo button at the wrong
  season).
- P1 sweep-closes-a-club-that-turned-seasons-off — one snapshot at the top of the run, no
  re-read, and the close write does not carry `enabled`. A club that disables mid-run
  gets its table wiped, titles awarded, everyone pushed, and is left with seasons off and
  an archive no screen can reach.
- P2 guest-pairs-make-every-close-read-15x-what-it-archives — 314 pair docs for a
  7-player club, 293 of them guest pairs (93%). Production log: "kept 0, dropped 293
  guest, 21 empty" — one close read 314 and archived ZERO. Nothing ever deletes a guest
  pair. ~45 pair-docs per player → a 60-player club is ~2,700 docs per close, and the
  sweep is LAST in cronEvery60Min's shared 540s budget with no per-club limit.
- P2 sweep-scan-fetches-the-whole-group-document — no .select(), no .limit(), no cursor.
  2,259 bytes where 666 are needed. At 1,000 enabled clubs that is 24,000 reads/day.
- P2 due-but-blocked-is-invisible-forever — console.log only, while a THROW reports to the
  error inbox. So the permanent failure is the silent one. Zero seasons entries in the
  production errors collection.
- P2 group-doc-read-three-times-per-sealed-evening — and for the 191 clubs with seasons
  OFF the stamp block re-reads the group doc on EVERY write to an active/finished game,
  forever, because the stamp is never written so `!after.seasonId` stays true.
- P2 end-season-now-archives-a-different-number-than-the-sweep (4th confirmation).
- P2 nothing-tests-the-sweep — zero tests for runSeasonRollovers, clubIsQuiet,
  performSeasonClose, closeSeasonIfRoundsTargetMet. The names appear in tests only inside
  comments.
- P3 except-game-id-is-unreachable (afterSeal filters 'active', the sealed game is
  'finished'); P3 cron-is-an-interval-not-a-clock (timeZone inert on interval schedules;
  logs show :12 drifting); P3 cadence-with-no-finish-line-never-closes-and-never-says-so;
  P3 duplicate completedRoundsOf read + dead endsAt guard + the date branch can only
  EXTEND a running season.

## From "Hebrew copy audit"
- P1 season-titles-none-claims-whole-season — "לא נלקח תואר בעונה הזאת" renders on a
  condition about ME, one card above the list of the season's eight champions.
- P1 season-summary-no-rounds-blames-the-season — "לא היו משחקים בעונה הזאת" to a
  non-participant, about a season with 22 evenings and 27 goals.
- P1 season-club-rounds-says-mishakim-for-mini-games — "37 משחקים" where the hall of fame
  says "37 משחקונים"; "0 משחקים שוחקו" for every timer-only club.
- P1 seasons-reopen-body-states-two-false-facts; P1 confirm-sheet-hardcoded-season-1-and-2
  (the parameterised fix exists and is unreachable — it lives inside the firstTime block);
  P1 err-season1-end-blocks-re-enable-with-a-false-string.
- P2 melech-for-a-female-champion — 7 of 9 titles are "מלך". הלן צברי holds FOUR of them
  on the only sealed season. No gender field exists anywhere, so only neutral naming can
  fix it. Also 'מהפנדלים שבעט'/'שעצר' on the poster.
- P2 season-share-card-paren-mirrors-on-latin-name — bidi resolves the closing paren to
  RTL and mirrors it: "הכי הרבה יחד: Nofar Tzabari (6 משחקים(" — in the PNG that leaves
  the app. 4 of the 7 frozen names are Latin.
- P2 seasonPeerDetail "1 משחקים", "1 ניצחונות מול 1" (the neighbouring strings all have
  the 1-form); P2 card-remaining-promises-a-next-evening; P2 shared-with-renders-with-
  nobody-named; P2 peers-empty-promises-it-will-fill (impossible for a timer-only club);
  P2 nine-titles-promised-eight-awarded; P2 no-titles-blames-attendance-for-a-zero-round
  season; P2 one-day-season-prints-the-same-month-twice.
- P3 peer-detail "מולו" under a woman's name and avatar; P3 goals-per-round labelled
  "למשחק" two tiles from "משחקונים"; P3 seasonVoidLine calls an evening a משחק and its
  correct twin seasonVoidDetail is dead code; P3 "2 העונות שנסגרו" (numeral before a
  definite noun); P3 ended-toast claims a fan-out that may have reached nobody;
  P3 crest players is a MAX labelled as a total; P3 two imperative registers (masculine
  singular in every server refusal, plural everywhere else).

## From "undo close"
- P0 reopen-playedrounds-ignores-unstamped-games (3rd confirmation, and the agent diffed
  the two deployed zips to prove the 11:40 deploy changed exactly that block).
- **P0 pair-wipe-skipped-on-next-close-after-reopen** — ALL 314 pair docs read
  {seasonWoundBack:'s2'} while s2 IS the running season. s2's next close archives the
  chemistry AND skips the wipe for all 314. Season 3 starts holding season 2's chemistry,
  double-counted. Generic after ANY reopen: guest pairs are never in the archive, so they
  are always skipped forever.
- P1 reopen-never-restores-guest-pair-chemistry — the close zeroes guest pairs, keeps them
  out of the archive, the restore only restores archived pairs, then deletes the archive.
  293 of 314 rows lost with no way back. The module's own comment states this rule.
- P1 orphan-season-stamp-absorbed-by-the-next-season-of-the-same-id — the 17.09 game
  stamped s3 will be inside the NEXT season 3 on day one.
- P2 reopen-extends-a-date-season-by-a-full-length (rebaseCadence is the function for
  opening the NEXT season); P2 chemistry-since-not-restored (chemistrySince is stamped to
  the close moment and never restored — already wrong on the live club); P2 undo-leaves-
  dangling-season-summary-pushes (7 unread pushes point at an archive the undo deletes;
  the loader silently serves the RUNNING season instead of saying it is gone);
  P2 reclose-after-undo-notifies-nobody (same 7-day dedupe bucket);
  P2 undo-chains-backwards-with-no-limit (no time bound, no already-undone guard — press
  it twice and you walk back two seasons); P2 club-seasons-block-written-only-after-the-
  restore-succeeds (a timeout between leaves a permanent double-count with the archive
  already deleted and the retry refused).
- P3 target-history wiped by close, not restored by undo; P3 coverage denominators
  absent->0 (blanks two efficiency columns permanently for the longest-standing members);
  P3 reopenedAt survives a disable/enable.
- CLEAN: the seasonReopened player-row latch IS genuinely fixed (deployed bundle diffed
  byte-for-byte); pair doc ids match between wipe and restore; clubRecords correctly
  untouched; title write/delete symmetry incl. the duo key and the guest skip.
