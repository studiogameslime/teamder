#!/usr/bin/env node
// Backfill /usersPublic for every existing account.
//
//   node scripts/backfillUsersPublic.mjs                  # DRY RUN — reports, writes nothing
//   node scripts/backfillUsersPublic.mjs --limit 50       # dry run over the first 50 only
//   node scripts/backfillUsersPublic.mjs --live           # writes
//   node scripts/backfillUsersPublic.mjs --live --limit 50    # canary: write 50, then stop
//   node scripts/backfillUsersPublic.mjs --live --after <uid> # resume after a document id
//
// The `syncUserPublic` trigger keeps the mirror fresh from the moment it
// deploys, but only for accounts that are WRITTEN after that. Everyone who
// never edits their profile again would have no public document at all, and
// every public surface would render them as a blank name. This fills that in
// once.
//
// PROPERTIES, each of which is load-bearing:
//
//   • DRY RUN BY DEFAULT. `--live` is the only thing that writes. Matches
//     scripts/backfillClubPairs.mjs, so the muscle memory is the same.
//   • IDEMPOTENT. A mirror that already matches is skipped, so a second run
//     reports +0 ~0 and costs only reads. That is also what makes it safe to
//     re-run after an interruption.
//   • ALLOWLIST ONLY. The four fields below and nothing else, built by the
//     same rule the trigger uses. A field added to /users cannot be published
//     by this script by accident.
//   • RESUME-SAFE. Pages by document id (`__name__`), so `--after <uid>` picks
//     up exactly where a previous run stopped. Ordering by id rather than by
//     createdAt matters: ids are stable and unique, createdAt is neither.
//   • Uses `:runQuery`, never the REST `list` endpoint — list serves a stale
//     view and has silently returned an out-of-date page before.
//
// Reads ~1 doc per user and writes at most 1. For ~600 users that is well
// inside a day's free quota.

import { execSync } from 'child_process';

const PROJECT = 'soccer-app-52b6b';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const LIVE = process.argv.includes('--live');
const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const LIMIT = Number(arg('--limit') || 0) || Infinity;
const AFTER = arg('--after');

/** Page size for the scan. Firestore caps a runQuery page well above this;
 *  300 keeps each response small enough to hold comfortably in memory. */
const PAGE = 300;
/** Firestore's hard cap on a single commit is 500 writes. */
const COMMIT_BATCH = 400;

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// ─── The allowlist ────────────────────────────────────────────────────────
//
// Identical to USERS_PUBLIC_FIELDS / buildUsersPublic in functions/src/index.ts.
// If you change one, change the other — a backfilled mirror and a live one
// must not be able to disagree.

function buildPublic(uid, f) {
  const out = { id: { stringValue: uid } };
  const name = f?.name?.stringValue;
  out.name = { stringValue: typeof name === 'string' ? name : '' };
  for (const k of ['avatarId', 'photoUrl']) {
    const v = f?.[k]?.stringValue;
    if (typeof v === 'string' && v !== '') out[k] = { stringValue: v };
  }
  return out;
}

/** Field-by-field equality on the allowlist. Cheaper and more honest than
 *  JSON.stringify: key order out of Firestore is not guaranteed. */
function samePublic(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k]?.stringValue ?? null) !== (b[k]?.stringValue ?? null)) return false;
  }
  return true;
}

// ─── REST helpers ─────────────────────────────────────────────────────────

async function runQuery(body) {
  const r = await fetch(`${FS}:runQuery`, {
    method: 'POST', headers: H, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`runQuery ${r.status} ${await r.text()}`);
  return (await r.json()).filter((x) => x.document).map((x) => x.document);
}

async function commit(writes) {
  const r = await fetch(`${FS.replace(/\/documents$/, '')}/documents:commit`, {
    method: 'POST', headers: H, body: JSON.stringify({ writes }),
  });
  if (!r.ok) throw new Error(`commit ${r.status} ${await r.text()}`);
  return r.json();
}

/** One page of /users, ordered by document id so the cursor is stable. */
async function usersPage(afterId) {
  const q = {
    structuredQuery: {
      from: [{ collectionId: 'users' }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: PAGE,
      ...(afterId
        ? {
            startAt: {
              values: [{ referenceValue: `projects/${PROJECT}/databases/(default)/documents/users/${afterId}` }],
              before: false,
            },
          }
        : {}),
    },
  };
  return runQuery(q);
}

/** The existing mirrors for a page, in one round trip. */
async function existingMirrors(uids) {
  if (uids.length === 0) return new Map();
  const names = uids.map(
    (u) => `projects/${PROJECT}/databases/(default)/documents/usersPublic/${u}`,
  );
  const out = new Map();
  // batchGet caps at 1000 names; a page is 300.
  const r = await fetch(`${FS.replace(/\/documents$/, '')}/documents:batchGet`, {
    method: 'POST', headers: H, body: JSON.stringify({ documents: names }),
  });
  if (!r.ok) throw new Error(`batchGet ${r.status} ${await r.text()}`);
  for (const row of await r.json()) {
    if (row.found) {
      out.set(row.found.name.split('/').pop(), row.found.fields || {});
    }
  }
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────

const idOf = (d) => d.name.split('/').pop();

async function main() {
  console.log(
    `${LIVE ? '🔴 LIVE' : '🔵 DRY RUN'} · project ${PROJECT}` +
      `${AFTER ? ` · resuming after ${AFTER}` : ''}` +
      `${LIMIT !== Infinity ? ` · limit ${LIMIT}` : ''}\n`,
  );

  let cursor = AFTER;
  let scanned = 0;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let extraFieldDocs = [];
  let lastId = null;
  const pendingWrites = [];

  const flush = async () => {
    if (!LIVE || pendingWrites.length === 0) return;
    while (pendingWrites.length) {
      await commit(pendingWrites.splice(0, COMMIT_BATCH));
    }
  };

  for (;;) {
    const page = await usersPage(cursor);
    // A resumed page re-reads the cursor document itself; drop it.
    const docs = cursor ? page.filter((d) => idOf(d) !== cursor) : page;
    if (docs.length === 0) break;

    const uids = docs.map(idOf);
    const mirrors = await existingMirrors(uids);

    for (const d of docs) {
      if (scanned >= LIMIT) break;
      const uid = idOf(d);
      scanned++;
      lastId = uid;

      const want = buildPublic(uid, d.fields || {});
      const have = mirrors.get(uid);

      if (!have) {
        created++;
      } else if (samePublic(want, have)) {
        unchanged++;
        continue;
      } else {
        updated++;
        // A mirror carrying a field outside the allowlist is worth knowing
        // about — it means something wrote here that should not have.
        const extra = Object.keys(have).filter((k) => !(k in want));
        if (extra.length) extraFieldDocs.push(`${uid}: ${extra.join(',')}`);
      }

      pendingWrites.push({
        // No updateMask → the document is REPLACED by the allowlist, which is
        // what makes a re-run converge instead of accumulating stale fields.
        update: {
          name: `projects/${PROJECT}/databases/(default)/documents/usersPublic/${uid}`,
          fields: want,
        },
      });
      if (pendingWrites.length >= COMMIT_BATCH) await flush();
    }

    if (scanned >= LIMIT) break;
    if (page.length < PAGE) break;
    cursor = uids[uids.length - 1];
  }

  await flush();

  console.log(`scanned    ${scanned}`);
  console.log(`created    +${created}`);
  console.log(`updated    ~${updated}`);
  console.log(`unchanged  ${unchanged}`);
  if (extraFieldDocs.length) {
    console.log(`\n⚠️  mirrors carrying fields outside the allowlist (replaced):`);
    for (const line of extraFieldDocs.slice(0, 20)) console.log(`   ${line}`);
    if (extraFieldDocs.length > 20) console.log(`   … ${extraFieldDocs.length - 20} more`);
  }
  if (!LIVE) {
    console.log(`\nnothing was written. re-run with --live to apply.`);
  }
  if (lastId) {
    console.log(`\nlast document: ${lastId}`);
    console.log(`resume with:   --after ${lastId}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
