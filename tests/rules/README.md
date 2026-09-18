# Firestore Rules tests

Self-contained emulator suite that asserts the production rules
deny the attack patterns the security audit surfaced.

## Prerequisites

Firebase Emulator Suite requires **JDK 21 or higher**. If you see
*"firebase-tools no longer supports Java version before 21"*:

```sh
brew install openjdk@21
echo 'export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
java -version  # verify
```

## Run

```sh
# Terminal 1 — start the emulator
firebase emulators:start --only firestore --project demo-soccer

# Terminal 2 — install deps + run tests
cd tests/rules
npm install
npm test
```

The suite uses Node's built-in `node:test` runner (no Jest). Each
test boots a clean Firestore environment, seeds the docs the
scenario needs, then asserts allow / deny.

`npm test` runs **every** `*.test.mjs` in this directory. It used to
name `firestore.test.mjs` and nothing else, so the seven suites added
after it — antiHijack, clubIsolation, joinRequest, oldClientCompat,
publishTeams, roundHistoryAccess, seasonSummary — were never executed
by anything: 38 of 146 assertions ran, and the other 108 were text.
The seasonSummary pair covering the timer-only club (`rounds` absent,
`games` set) was written against a rules change and had never once
been run when it landed.

`--test-concurrency=1` is load-bearing, not tidiness. Five of the
eight suites share `projectId: 'demo-soccer'` and each calls
`clearFirestore()` in its setup, so run in parallel — the runner's
default is one process per core — they wipe each other's fixtures
mid-flight. Measured on the same commit: 4 failures serially, 19 in
parallel, the extra 15 being pure cross-talk. If you ever split the
suites by projectId you can drop the flag; until then a parallel run
reports failures that aren't real and hides the ones that are.

## What it covers

| Collection | Scenarios |
|---|---|
| `/users` | cross-user achievement / discipline write blocked, self update OK, stats blocked, name-length cap |
| `/games` self-join | proxy join blocked, waitlist smuggling blocked, status flip blocked, past-start blocked |
| `/games` admin | createdBy immutable, groupId immutable, community-only read gated |
| `/groups` | non-creator admin can't rotate adminIds, creator can't self-demote, outsiders can't promote themselves |
| `/groupsPublic` | can't create without canonical /groups, admin of canonical can |
| `/notifications` | server-only types blocked, client-allowed types succeed, recipient-only read |
| `/groups/{}/ratings/{}/votes` | self-rate blocked, range enforced, non-member blocked, voter privacy |
| `/playerStats` | client write blocked |
| `/gameUpdateLatches` | client read+write blocked |

## What this DOESN'T cover

These tests assert the **rules layer**. They do not cover the
behavior of callable Cloud Functions (e.g. `sendGameInvite`). Those
require the Functions emulator and a separate test surface.

The CF-side checks that aren't covered here include:

- valid invite succeeds when sender is a community member
- invite blocked when sender is not a community member
- invite blocked when recipient is already in the game roster
- invite blocked when game is `finished` / `cancelled`
- self-invite blocked at the `invalid-argument` layer
- server-side rate limit (30/hour) returns `resource-exhausted`
- payload `inviterName` and `gameTitle` come from canonical state,
  not from the caller's input

These are checked manually during the deploy smoke test (login as
two test users, send invite, observe notification doc fields). A
follow-up should add a functions-emulator test suite covering them.

## Adding tests

Each test is independent — `beforeEach` clears Firestore. Use:
- `db(uid)` — authenticated context (use this for the action under test)
- `seed(fn)` — bypasses rules (use this for fixtures only)
- `assertSucceeds(promise)` / `assertFails(promise)` — the assertions

When extending the rules, add a paired test here so a future
loosen-the-rule mistake breaks CI immediately.
