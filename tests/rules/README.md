# Firestore rules tests

    npm run test:rules

## --test-concurrency=1 is not optional

Every file calls `initializeTestEnvironment`, which loads a ruleset into the
ONE emulator listening on 8080. Run the files in parallel and they overwrite
each other's ruleset mid-run: assertions are then evaluated against whichever
file loaded last.

The failure is not a crash. It is a scatter of plausible-looking failures —
18 of them on 22.09, including negative security assertions like "outsider
still cannot read a community-only game". Read literally, that says the rules
had been opened up. It was not true; the same suite run serially gave 3.

`npm run test:rules` pins the flag. Do not run `node --test *.test.mjs` by
hand without it.

## Current contracts and historical writes — 10.10.2026

### Approved local permissions and atomic creation regression

The owner subsequently approved the two focused DM/public-mirror fixes. Root
applied them to the complete active file; this does not itself mean deployment.
`preReleasePermissions.test.mjs` checks existing/new DM metadata, immutable
participants, id consistency, third-party history denial even with historical
forged metadata, friends-only gates on both open and direct-send, message,
receipt and typing queries, and the actual per-user `chatUnread` list query.
Global DM metadata enumeration is intentionally denied and is not an app query.

The initial mirror patch used pre-write `get/exists` via `isGroupAdminSafe`.
The new test proved that the exact same canonical+mirror payload succeeds as
two separate writes but fails in a single batch AND transaction. The approved
follow-up authorizes mirror creation with `getAfter` on the canonical source.
It supports atomic source+mirror creation without trusting `adminIds` supplied
in the mirror. Missing sources, wrong mirror ids, oversized initial counts and
escalating somebody else's canonical admins remain denied; a rejected batch
does not partially create its source. The current production app creates via
`createGroupCallable` (Admin SDK); this tests the retained client rules contract,
not a production callable execution or live test-club creation.

`permissions-contracts-before-getAfter-final.log` records 15/17 passing and
only the two legitimate atomic cases failing. After the focused rule fix,
`permissions-contracts-after-getAfter.log` records all 18 passing (including the
additional actual conversation-list query), with no skips. A first exploratory
run also found two fixture mistakes that used different Firestore instances
in one batch; those were fixed before the definitive before/after comparison.
No assertion was loosened. The full serial run is recorded separately in
`rules-approved-final.log`: **303/303 passed**, 33 suites, zero failures/skips,
using Java 21.0.12.1 and the complete active rules. Use these final totals, not
the historical totals below. Full evidence and scope:
`artifacts/pre-release-2026-10-10/permissions-approved-validation.md`.

### Historical baseline before the approved permission changes

Three historical positive expectations were replaced with explicit negative
AND positive checks; none was deleted, skipped, or made permissive by changing
the active rules:

- Direct self-add into `games.players` is denied. The current app writes its
  own `games/{id}/joinRequests/{uid}` with a server timestamp; that request is
  allowed and the server assigns the roster. `joinGameV2` has no current call
  site. Removing the expression cap must not reopen direct self-add.
- Creating a public mirror with `memberCount: 2` is denied. An initial mirror
  with count 1 for a one-member canonical club is the supported document shape
  and is allowed. Current club creation uses `createGroupCallable` with Admin
  SDK rather than a direct client dual-write.
- A canceller creating `pendingPromotion` for another player is denied. A
  self-only cancellation that preserves the waitlist and does not create an
  offer is allowed. `onGameRosterChanged` proposes the next seat on the server.

The old failures logged a 1000-expression overflow, but the active rules also
intentionally forbid the first and third write shapes. An overflow on a denied
write is not proof the supported flow fails, and making an assertion negative
does not establish support for old installed clients. Decide minimum-version
support separately. Do not relax anti-hijack checks to make old writes pass.

The public-mirror test formerly named "cannot create unless canonical exists"
uses a count of 999; it proves the count cap, not canonical ownership. A separate
local probe tests count 1 with no canonical club and with a non-admin member.
The full-rules proposal and evidence live in
`artifacts/pre-release-2026-10-10/public-mirror-*`. Those are proposals, not active
permission changes. `firestore.test.mjs` and `oldClientCompat.test.mjs` accept
`RULES_FILE` for running their exact assertions against a full proposed ruleset;
other files must be checked before assuming they honor that variable.

Verification: `rules-current-contracts.log` records 285/285 tests passing on
the full active rules, serially, with no skips. The separate full proposal
`firestore.chat-and-public-mirror.proposed.rules` denies both count-1 forgeries
and allows the canonical admin in `public-mirror-proposed.json`; the two
updated contract files pass 41/41 against that proposal. This does not claim
the other files loaded the proposal or that the proposal was deployed.

## Isolating a rule: use the real file

Do not reproduce a rule in a cut-down file to test it in isolation. A minimal
file needs a catch-all to let the seed data through, and a catch-all such as

    match /{doc=**} { allow read, write: if true; }

answers the read before your rule is ever consulted. Five probes "passed" that
way on 22.09 while testing nothing at all. Splice the expression under test
into a copy of the real `firestore.rules` and point `RULES_FILE` at that.

## LIST queries need their own test

A rule can be correct for `get` and refuse every `list`. `gameListRegression`
exists because a type check — `resource.data.get('participantIds', []) is
list` — on a field the query filters on makes Firestore deny the whole list:
it cannot prove the rule holds for every matching document, so it does not try.
The result is `false for 'list'`, never an error, and it reached production.

Any rule change on a collection the app queries needs a test that issues the
real query, not only a document read.
