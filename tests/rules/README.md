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

## The three that fail

`games: self can join an open community game`, `groupsPublic: admin of
canonical group can create the public mirror`, and `OLD-CLIENT manual-offer
cancel` fail, and they fail identically against older rulesets — check before
assuming a change caused them:

    git show <older-commit>:firestore.rules > /tmp/old.rules
    RULES_FILE=/tmp/old.rules npm run test:rules

The first and third are the 1000-expression cap on the `/games` update chain:
the organiser/admin branch sits last and is never reached.

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
