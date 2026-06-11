#!/usr/bin/env node
// One-shot: append an item to /appConfig/releaseLog via the Firestore REST
// API using the local gcloud user's access token. Reads the current items
// array, appends a new {title, kind, version, area}, and patches it back.
//
//   node scripts/appendReleaseLog.js "<title>" <fix|feature> [version] [area]
//
// version defaults to 'next' (done, not yet shipped).

const { execSync } = require('child_process');

const PROJECT = 'soccer-app-52b6b';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/appConfig/releaseLog`;

const title = process.argv[2];
const kind = process.argv[3] === 'feature' ? 'feature' : 'fix';
const version = process.argv[4] || 'next';
const area = process.argv[5] || 'כללי';

if (!title) {
  console.error('usage: node scripts/appendReleaseLog.js "<title>" <fix|feature> [version] [area]');
  process.exit(1);
}

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();

function itemToValue(it) {
  return {
    mapValue: {
      fields: {
        title: { stringValue: it.title },
        kind: { stringValue: it.kind },
        version: { stringValue: it.version },
        ...(it.area ? { area: { stringValue: it.area } } : {}),
      },
    },
  };
}

(async () => {
  const getRes = await fetch(BASE, { headers: { Authorization: `Bearer ${token}` } });
  let existing = [];
  if (getRes.ok) {
    const doc = await getRes.json();
    const arr = doc.fields?.items?.arrayValue?.values || [];
    existing = arr; // keep raw REST values as-is
  } else if (getRes.status !== 404) {
    console.error(`✗ read failed: HTTP ${getRes.status}`, await getRes.text());
    process.exit(1);
  }

  const next = [...existing, itemToValue({ title, kind, version, area })];

  const url = `${BASE}?updateMask.fieldPaths=items`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { items: { arrayValue: { values: next } } } }),
  });
  if (!res.ok) {
    console.error(`✗ write failed: HTTP ${res.status}`, await res.text());
    process.exit(1);
  }
  console.log(`✓ releaseLog += [${kind}] "${title}" (${version}, ${area}) — now ${next.length} items`);
})();
