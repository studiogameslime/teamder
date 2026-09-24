#!/usr/bin/env node
// Integrity audit: /users against /usersPublic.
//
//   node scripts/auditUsersPublic.mjs            # summary
//   node scripts/auditUsersPublic.mjs --verbose  # list every offending uid
//
// READ ONLY. Never writes. Run it before tightening the rules and again after,
// because the rules are what make a missing mirror user-visible: once /users is
// gated on a full account, a person with no mirror renders as a blank name on
// every public surface, and nothing logs it.
//
// Checks, in the order they matter:
//
//   • missing        — a user with no mirror. These are the ones that break.
//   • orphan         — a mirror whose user is gone. Harmless but means the
//                      delete path did not fire, which is worth knowing.
//   • extraFields    — a mirror carrying anything outside the allowlist. This
//                      is the one that would be a privacy finding.
//   • idMismatch     — `id` field disagreeing with the document id. Would make
//                      every lookup by id return somebody else's name.
//   • blankName      — a mirror that renders as nothing.
//   • avatarMismatch — mirror and source disagree on the avatar.
//
// Reports; never repairs. A legacy account with an odd name is a fact about the
// data, not a defect to invent a fix for.

import { execSync } from 'child_process';

const PROJECT = 'soccer-app-52b6b';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const VERBOSE = process.argv.includes('--verbose');
const PAGE = 300;

const ALLOWED = new Set(['id', 'name', 'avatarId', 'photoUrl']);

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function runQuery(body) {
  const r = await fetch(`${FS}:runQuery`, {
    method: 'POST', headers: H, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`runQuery ${r.status} ${await r.text()}`);
  return (await r.json()).filter((x) => x.document).map((x) => x.document);
}

const idOf = (d) => d.name.split('/').pop();
const str = (f, k) => f?.[k]?.stringValue ?? null;

/** Every document in a collection, by id order. */
async function scanAll(collectionId) {
  const out = new Map();
  let cursor = null;
  for (;;) {
    const page = await runQuery({
      structuredQuery: {
        from: [{ collectionId }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: PAGE,
        ...(cursor
          ? {
              startAt: {
                values: [{ referenceValue: `projects/${PROJECT}/databases/(default)/documents/${collectionId}/${cursor}` }],
                before: false,
              },
            }
          : {}),
      },
    });
    const docs = cursor ? page.filter((d) => idOf(d) !== cursor) : page;
    if (docs.length === 0) break;
    for (const d of docs) out.set(idOf(d), d.fields || {});
    if (page.length < PAGE) break;
    cursor = idOf(docs[docs.length - 1]);
  }
  return out;
}

function show(label, list) {
  const n = list.length;
  const flag = n === 0 ? '  ' : '⚠ ';
  console.log(`${flag}${label.padEnd(22)} ${String(n).padStart(4)}`);
  if (VERBOSE && n) for (const line of list) console.log(`      ${line}`);
  else if (n) for (const line of list.slice(0, 5)) console.log(`      ${line}`);
  if (!VERBOSE && n > 5) console.log(`      … ${n - 5} more (--verbose to list)`);
}

async function main() {
  console.log(`🔍 READ-ONLY audit · project ${PROJECT}\n`);

  const users = await scanAll('users');
  const mirrors = await scanAll('usersPublic');

  console.log(`  /users                 ${String(users.size).padStart(4)}`);
  console.log(`  /usersPublic           ${String(mirrors.size).padStart(4)}\n`);

  const missing = [];
  const orphan = [];
  const extraFields = [];
  const idMismatch = [];
  const blankName = [];
  const avatarMismatch = [];

  for (const [uid, uf] of users) {
    if (!mirrors.has(uid)) {
      missing.push(`${uid}  name="${str(uf, 'name') ?? ''}"`);
    }
  }
  for (const [uid, mf] of mirrors) {
    const uf = users.get(uid);
    if (!uf) {
      orphan.push(`${uid}  name="${str(mf, 'name') ?? ''}"`);
      continue;
    }
    const extra = Object.keys(mf).filter((k) => !ALLOWED.has(k));
    if (extra.length) extraFields.push(`${uid}  ${extra.join(',')}`);

    if (str(mf, 'id') !== uid) {
      idMismatch.push(`${uid}  id="${str(mf, 'id')}"`);
    }
    const mName = str(mf, 'name');
    if (!mName || !mName.trim()) blankName.push(`${uid}  source="${str(uf, 'name') ?? ''}"`);

    for (const k of ['avatarId', 'photoUrl']) {
      const want = str(uf, k) || null;
      const got = str(mf, k) || null;
      if (want !== got) avatarMismatch.push(`${uid}  ${k}: source="${want}" mirror="${got}"`);
    }
  }

  show('missing mirrors', missing);
  show('orphan mirrors', orphan);
  show('extra fields', extraFields);
  show('id != documentId', idMismatch);
  show('blank name', blankName);
  show('avatar mismatch', avatarMismatch);

  const bad =
    missing.length + orphan.length + extraFields.length +
    idMismatch.length + blankName.length + avatarMismatch.length;
  console.log(
    `\n${bad === 0 ? '✅ clean — every user has a correct mirror' : `⚠️  ${bad} finding(s)`}`,
  );
  // Non-zero exit on a finding, so this can gate a deploy step.
  if (bad > 0) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
