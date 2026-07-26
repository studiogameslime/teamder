#!/usr/bin/env node
// One-shot: flip specific /appConfig/releaseLog items from version 'next'
// (or any) to a target version, matched by a unique substring of the title.
// Only touches items whose title CONTAINS one of the given needles AND whose
// current version is 'next' (so we never re-stamp already-shipped items).
//
//   node scripts/flipReleaseLogVersion.js <targetVersion>
//
// The needle list is inlined below — edit it per ship.

const { execSync } = require('child_process');

const PROJECT = 'soccer-app-52b6b';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/appConfig/releaseLog`;

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/flipReleaseLogVersion.js <targetVersion>');
  process.exit(1);
}

// Unique title substrings of the items shipping in THIS build (1.0.78, phone
// client). NOTE: backend-only items (e.g. the recurring-clone cleanup gate)
// stay 'next' until firebase deploy; watch/widget items ship on the wear track.
const NEEDLES = [
  "במסך צר הקבוצות נערמו אנכית",
  "המרה מגרירה ללחיצה",
  "'משחק פתוח לכולם' פעיל כברירת מחדל",
  "פיד הגילוי מציג את המועדונים הפעילים",
];

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();

(async () => {
  const getRes = await fetch(BASE, { headers: { Authorization: `Bearer ${token}` } });
  if (!getRes.ok) {
    console.error(`✗ read failed: HTTP ${getRes.status}`, await getRes.text());
    process.exit(1);
  }
  const doc = await getRes.json();
  const items = doc.fields?.items?.arrayValue?.values || [];

  let flipped = 0;
  for (const it of items) {
    const f = it.mapValue.fields;
    const title = f.title?.stringValue || '';
    const ver = f.version?.stringValue || '';
    if (ver === 'next' && NEEDLES.some((n) => title.includes(n))) {
      f.version = { stringValue: target };
      flipped++;
      console.log(`  → ${title.slice(0, 55)}`);
    }
  }

  if (!flipped) {
    console.log('nothing matched — already flipped?');
    return;
  }

  const url = `${BASE}?updateMask.fieldPaths=items`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { items: { arrayValue: { values: items } } } }),
  });
  if (!res.ok) {
    console.error(`✗ write failed: HTTP ${res.status}`, await res.text());
    process.exit(1);
  }
  console.log(`✓ flipped ${flipped} item(s) → ${target}`);
})();
