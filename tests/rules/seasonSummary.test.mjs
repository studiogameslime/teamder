// Who may read a sealed season.
//
// The archive is club-scoped, so the bound is club membership — the same as
// the live table it replaces. Two read statements rather than one, because a
// `list` does not bind the path wildcard: reading `groupId` from the path in a
// query raises a Null value error and denies everything, which is exactly the
// bug that once made communityStats unreadable.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, deleteField, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(path.join(HERE, '..', '..', 'firestore.rules'), 'utf8');
const GID = 'club1', MEMBER = 'member', OUTSIDER = 'outsider', LEFT = 'departed';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rules-season-summary',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GID), {
      name: 'club', adminIds: ['admin'], creatorId: 'admin',
      playerIds: [MEMBER, 'admin'], pendingPlayerIds: [], createdAt: 1,
    });
    await setDoc(doc(db, 'seasonSummary', `${GID}__s1`), {
      groupId: GID, groupName: 'club', seasonId: 's1', no: 1, totals: {},
      // `departed` played the season and has since left the club.
      players: { [MEMBER]: { rounds: 10 }, [LEFT]: { rounds: 8 } },
    });
    // The compact list row the hall of fame actually reads.
    await setDoc(doc(db, 'seasonCards', `${GID}__s1`), {
      groupId: GID, seasonId: 's1', no: 1, startsAt: 1, endsAt: 2,
      completedRounds: 10, totals: { rounds: 40, goals: 100, assists: 50 },
      players: 12, winners: [{ key: 'topScorer', names: ['דני'], value: 31 }],
    });
    await setDoc(doc(db, 'users', MEMBER, 'seasonTitles', `${GID}__s1__topScorer`), {
      groupId: GID, groupName: 'club', seasonId: 's1', seasonNo: 1,
      titleKey: 'topScorer', value: 31, at: 1,
    });
  });
});
after(async () => { await env.cleanup(); });

const asMember = () => env.authenticatedContext(MEMBER).firestore();
const asOutsider = () => env.authenticatedContext(OUTSIDER).firestore();
const asDeparted = () => env.authenticatedContext(LEFT).firestore();

describe('a club member reads their own seasons', () => {
  test('one season by id', async () => {
    const s = await getDoc(doc(asMember(), 'seasonSummary', `${GID}__s1`));
    assert.equal(s.exists(), true);
  });

  test('and can list them — the wildcard trap', async () => {
    // Answered from the FIELD. If the rule read groupId off the path this
    // would deny with a Null value error.
    const q = query(collection(asMember(), 'seasonSummary'),
                    where('groupId', '==', GID));
    const snap = await getDocs(q);
    assert.equal(snap.size, 1);
  });
});

describe('and so does somebody who PLAYED it and has since left', () => {
  // They are pushed a summary of this very season the day it closes. Denying
  // them would deep-link a real notification into a permission error — and
  // half the point of sealing a season is that leaving does not erase what you
  // did in it.
  test('by id', async () => {
    const s = await getDoc(doc(asDeparted(), 'seasonSummary', `${GID}__s1`));
    assert.equal(s.exists(), true);
    assert.equal(s.data().groupName, 'club');
  });

  test('but a LIST is still members-only — the wildcard trap, again', async () => {
    // A participant clause on the list path would be evaluated per document
    // and deny the whole query the moment it met a season this caller sat
    // out. So listing stays bound to membership; only the single-document
    // read widens.
    await assert.rejects(() => getDocs(query(
      collection(asDeparted(), 'seasonSummary'), where('groupId', '==', GID))));
  });

  test('and a member listing their club still gets every season', async () => {
    const snap = await getDocs(query(
      collection(asMember(), 'seasonSummary'), where('groupId', '==', GID)));
    assert.ok(snap.size >= 1);
  });

  // A KEY in the map is not proof of playing. Stat rows are never deleted when
  // somebody leaves a club, so before this an ex-member's zeroed row was
  // archived into every later season and let them open seasons they were never
  // part of. Fixed in two places: the close no longer archives an empty row,
  // and the rule no longer trusts mere presence. (Found by the QA sweep, which
  // wrote this case against the old behaviour.)
  test('and not a later season their dead stat row still appears in', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'seasonSummary', `${GID}__s7`), {
        groupId: GID, seasonId: 's7', no: 7, totals: { rounds: 44 },
        players: {
          [MEMBER]: { rounds: 22, goals: 31, displayName: 'דני' },
          // Removed from the club long before season 7 opened.
          [LEFT]: { rounds: 0, goals: 0, displayName: 'מודח' },
        },
        awards: { topScorer: { winners: [MEMBER], value: 31 } },
      });
    });
    await assert.rejects(() =>
      getDoc(doc(asDeparted(), 'seasonSummary', `${GID}__s7`)));
  });

  test('but not a season they never played', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'seasonSummary', `${GID}__s0`), {
        groupId: GID, seasonId: 's0', no: 0, players: { someoneElse: { rounds: 4 } },
        totals: {},
      });
    });
    await assert.rejects(() =>
      getDoc(doc(asDeparted(), 'seasonSummary', `${GID}__s0`)));
  });
});

describe('somebody else cannot', () => {
  test('not by id', async () => {
    await assert.rejects(() =>
      getDoc(doc(asOutsider(), 'seasonSummary', `${GID}__s1`)));
  });

  test('not by query', async () => {
    await assert.rejects(() => getDocs(query(
      collection(asOutsider(), 'seasonSummary'), where('groupId', '==', GID))));
  });
});

describe('nobody writes', () => {
  test('not a member', async () => {
    await assert.rejects(() =>
      setDoc(doc(asMember(), 'seasonSummary', `${GID}__s9`), { groupId: GID }));
  });

  test('not even to their own club season', async () => {
    await assert.rejects(() => setDoc(
      doc(env.authenticatedContext('admin').firestore(), 'seasonSummary', `${GID}__s1`),
      { groupId: GID, tampered: true }));
  });
});

// ── The titles themselves ────────────────────────────────────────────────
//
// Deliberately wider than the season document they came from. A title is a
// boast worn on a public profile: it says a club name, a number and a season,
// and it hangs on a screen that is already open to every signed-in user.
// Binding it to club membership instead would mean a player could not show a
// title to anyone outside the club that gave it — which is the opposite of
// what a title is for.
//
// Writing is a different matter entirely.
describe('a season title is public, like the profile it hangs on', () => {
  test('a club member reads it', async () => {
    const t = await getDoc(doc(asMember(), 'users', MEMBER, 'seasonTitles', `${GID}__s1__topScorer`));
    assert.equal(t.exists(), true);
    assert.equal(t.data().value, 31);
  });

  test('and so does someone outside the club', async () => {
    const t = await getDoc(doc(asOutsider(), 'users', MEMBER, 'seasonTitles', `${GID}__s1__topScorer`));
    assert.equal(t.exists(), true);
  });

  test('a player can list their own titles', async () => {
    const snap = await getDocs(collection(asMember(), 'users', MEMBER, 'seasonTitles'));
    assert.equal(snap.size, 1);
  });

  test('and list somebody else\'s, which is the point of a boast', async () => {
    const snap = await getDocs(collection(asOutsider(), 'users', MEMBER, 'seasonTitles'));
    assert.equal(snap.size, 1);
  });
});

describe('but nobody awards themselves a title', () => {
  test('not on their own profile', async () => {
    await assert.rejects(() => setDoc(
      doc(asMember(), 'users', MEMBER, 'seasonTitles', `${GID}__s2__topScorer`),
      { groupId: GID, titleKey: 'topScorer', value: 99 }));
  });

  test('not on anybody else\'s', async () => {
    await assert.rejects(() => setDoc(
      doc(asOutsider(), 'users', MEMBER, 'seasonTitles', `${GID}__s2__mvp`),
      { groupId: GID, titleKey: 'mvp', value: 10 }));
  });

  test('and not by overwriting one they really did win', async () => {
    await assert.rejects(() => setDoc(
      doc(asMember(), 'users', MEMBER, 'seasonTitles', `${GID}__s1__topScorer`),
      { groupId: GID, titleKey: 'topScorer', value: 999 }));
  });
});

// ── The club's own seasons block ─────────────────────────────────────────
//
// Four callables exist because this decision does not belong to a document
// write: enabling can seal a club's whole history, ending a season archives
// and zeroes every stat row and hands out nine permanent titles. An admin who
// could write the field directly could skip every one of those guards.
describe('nobody edits groups.seasons from a client', () => {
  const asAdmin = () => env.authenticatedContext('admin').firestore();

  test('not an admin adding it', async () => {
    await assert.rejects(() => updateDoc(doc(asAdmin(), 'groups', GID), {
      seasons: { enabled: true, currentNo: 1, currentId: 's1', count: 0 },
    }));
  });

  test('not an admin rewinding one that exists', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'groups', GID), {
        seasons: { enabled: true, currentNo: 4, currentId: 's4', count: 3, startedAt: 1 },
      });
    });
    // Moving currentId back would let the same season be closed twice.
    await assert.rejects(() => updateDoc(doc(asAdmin(), 'groups', GID), {
      seasons: { enabled: true, currentNo: 3, currentId: 's3', count: 2, startedAt: 1 },
    }));
  });

  test('and an ordinary member certainly does not', async () => {
    await assert.rejects(() => updateDoc(doc(asMember(), 'groups', GID), {
      seasons: { enabled: false },
    }));
  });

  test('but an admin can still edit the rest of the club', async () => {
    await assert.doesNotReject(() =>
      updateDoc(doc(asAdmin(), 'groups', GID), { description: 'עדיין אפשר לערוך' }));
  });
});


// ── /seasonCards — the row the hall of fame reads ────────────────────────
//
// A card names people, so it is club-scoped like the archive it is written
// beside. Unlike the archive there is NO participant clause: a card is a club
// screen, never a deep link, and widening it would widen the list too.
describe('the season CARD is club-scoped', () => {
  test('a member reads one by id', async () => {
    const s = await getDoc(doc(asMember(), 'seasonCards', `${GID}__s1`));
    assert.equal(s.exists(), true);
    assert.equal(s.data().players, 12);
  });

  test('and lists them — the screen\'s real query, answered from the FIELD', async () => {
    const snap = await getDocs(query(
      collection(asMember(), 'seasonCards'), where('groupId', '==', GID)));
    assert.equal(snap.size, 1);
  });

  test('an outsider gets nothing, by id or by query', async () => {
    await assert.rejects(() => getDoc(doc(asOutsider(), 'seasonCards', `${GID}__s1`)));
    await assert.rejects(() => getDocs(query(
      collection(asOutsider(), 'seasonCards'), where('groupId', '==', GID))));
  });

  test('and neither does somebody who only PLAYED the season', async () => {
    // Deliberate: the card is the club\'s hall of fame, not a personal record.
    // The departed player\'s own summary is the ARCHIVE, which they can read.
    await assert.rejects(() => getDocs(query(
      collection(asDeparted(), 'seasonCards'), where('groupId', '==', GID))));
  });

  test('nobody writes a card, not even the club admin', async () => {
    const asAdmin = env.authenticatedContext('admin').firestore();
    await assert.rejects(() =>
      setDoc(doc(asAdmin, 'seasonCards', `${GID}__s2`), { groupId: GID }));
  });
});

// ── Deleting is a write ──────────────────────────────────────────────────
//
// `allow write: if false` covers delete as well as create and update, and a
// sealed season that an admin could delete is not sealed. Asserted rather than
// assumed: only reopenLastSeason (Admin SDK) may remove one.
describe('a sealed season cannot be deleted from a client', () => {
  test('not the archive', async () => {
    await assert.rejects(() => deleteDoc(
      doc(env.authenticatedContext('admin').firestore(),
          'seasonSummary', `${GID}__s1`)));
  });

  test('not the card', async () => {
    await assert.rejects(() => deleteDoc(
      doc(env.authenticatedContext('admin').firestore(),
          'seasonCards', `${GID}__s1`)));
  });

  test('and a player cannot delete a title they lost interest in', async () => {
    await assert.rejects(() => deleteDoc(
      doc(asMember(), 'users', MEMBER, 'seasonTitles', `${GID}__s1__topScorer`)));
  });
});

// ── Signed OUT ───────────────────────────────────────────────────────────
describe('none of it is public to the internet', () => {
  const anon = () => env.unauthenticatedContext().firestore();

  test('no archive', async () => {
    await assert.rejects(() => getDoc(doc(anon(), 'seasonSummary', `${GID}__s1`)));
  });

  test('no card', async () => {
    await assert.rejects(() => getDoc(doc(anon(), 'seasonCards', `${GID}__s1`)));
  });

  test('no title — public means every signed-in USER, not everybody', async () => {
    await assert.rejects(() => getDoc(
      doc(anon(), 'users', MEMBER, 'seasonTitles', `${GID}__s1__topScorer`)));
  });
});

// ── The other doors into groups.seasons ──────────────────────────────────
//
// The immutability clause lives in the ADMIN branch of the group update rule.
// Every other branch is a self-service one gated by affectedKeys().hasOnly(),
// so none of them can carry `seasons` — proven here rather than read off the
// rule, because a later hasOnly() gaining a key would silently open the field.
describe('no side door into groups.seasons', () => {
  test('not deleting the field', async () => {
    await assert.rejects(() => updateDoc(
      doc(env.authenticatedContext('admin').firestore(), 'groups', GID),
      { seasons: deleteField() }));
  });

  test('not one nested number', async () => {
    // `seasons.currentNo` alone would be enough to close the same season twice.
    await assert.rejects(() => updateDoc(
      doc(env.authenticatedContext('admin').firestore(), 'groups', GID),
      { 'seasons.currentNo': 1 }));
  });

  test('not riding along on a self-leave', async () => {
    await assert.rejects(() => updateDoc(doc(asMember(), 'groups', GID), {
      playerIds: ['admin'], updatedAt: 2, seasons: { enabled: false },
    }));
  });

  test('not riding along on a join request', async () => {
    await assert.rejects(() => updateDoc(doc(asOutsider(), 'groups', GID), {
      pendingPlayerIds: [OUTSIDER], updatedAt: 2, seasons: { enabled: false },
    }));
  });
});

// ── The one door that is still open: CREATE ──────────────────────────────
//
// `allow update` makes `seasons` server-owned. `allow create` does not mention
// it, so anybody can be born holding one: create a club with
// seasons.enabled = true and the hourly rollover adopts it without
// enableClubSeasons ever having run, and with a `count` nobody validated —
// which seasonChoices() turns into a loop of that length on every member's
// phone.
//
// FAILS until the create rule carries `!('seasons' in request.resource.data)`.
describe('and a club cannot be BORN with a seasons block', () => {
  test('planting one at create is refused', async () => {
    await assert.rejects(() => setDoc(
      doc(env.authenticatedContext('planter').firestore(), 'groups', 'planted'),
      {
        name: 'מועדון', adminIds: ['planter'], playerIds: ['planter'],
        pendingPlayerIds: [], createdAt: 1,
        seasons: {
          enabled: true, currentNo: 99, currentId: 's99',
          count: 1000000000, startedAt: 0,
          cadence: { type: 'date', months: 6, endsAt: 1 },
        },
      }));
  });
});
