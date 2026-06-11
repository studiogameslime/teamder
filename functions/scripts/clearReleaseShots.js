#!/usr/bin/env node
// Release-time cleanup: once items have shipped (version flipped from 'next'
// to a real '1.0.x'), delete their proof screenshots from `releaseShots` and
// strip the `shotId` field — so the shots collection only ever holds images
// for the UPCOMING release. Run this right after flipping the version.
//
//   node scripts/clearReleaseShots.js          # clean all shipped items
//   node scripts/clearReleaseShots.js --all     # also clean 'next' (full reset)

const { execSync } = require('child_process');

const PROJECT = 'soccer-app-52b6b';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const alsoNext = process.argv.includes('--all');

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();

async function main() {
  const getRes = await fetch(`${BASE}/appConfig/releaseLog`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const doc = await getRes.json();
  const items = doc.fields?.items?.arrayValue?.values || [];

  let cleaned = 0;
  for (const it of items) {
    const f = it.mapValue.fields;
    const shotId = f.shotId?.stringValue;
    if (!shotId) continue;
    const isNext = f.version?.stringValue === 'next';
    if (isNext && !alsoNext) continue; // keep upcoming shots
    // Delete the image doc (ignore 404).
    await fetch(`${BASE}/releaseShots/${shotId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    delete f.shotId;
    cleaned += 1;
  }

  if (cleaned === 0) {
    console.log('nothing to clean.');
    return;
  }
  const patchRes = await fetch(`${BASE}/appConfig/releaseLog?updateMask.fieldPaths=items`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { items: { arrayValue: { values: items } } } }),
  });
  if (!patchRes.ok) {
    console.error(`✗ patch failed: ${patchRes.status}`, await patchRes.text());
    process.exit(1);
  }
  console.log(`✓ cleared ${cleaned} shot(s)${alsoNext ? ' (incl. next)' : ''}.`);
}

main();
