#!/usr/bin/env node
// Attach a proof screenshot to a releaseLog item. Stores the image as a raw
// base64 JPEG in `releaseShots/{id}` (mirrors pulseFeatures — no Storage
// bucket needed) and sets `shotId` on the target item in appConfig/releaseLog.
//
//   node scripts/attachReleaseShot.js <itemIndex> <jpegPath>
//
// itemIndex is the 0-based position in the releaseLog `items` array (the
// same index printed by the audit). Only meant for 'next' items — they're
// cleared on release by clearReleaseShots.js.

const { execSync } = require('child_process');
const fs = require('fs');

const PROJECT = 'soccer-app-52b6b';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const idx = parseInt(process.argv[2], 10);
const jpegPath = process.argv[3];
if (Number.isNaN(idx) || !jpegPath) {
  console.error('usage: node scripts/attachReleaseShot.js <itemIndex> <jpegPath>');
  process.exit(1);
}
if (!fs.existsSync(jpegPath)) {
  console.error('✗ file not found:', jpegPath);
  process.exit(1);
}

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const b64 = fs.readFileSync(jpegPath).toString('base64');
const shotId = `shot-${idx}-${Date.now()}`;

async function main() {
  // 1) Store the image bytes.
  const shotRes = await fetch(`${BASE}/releaseShots/${shotId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        b64: { stringValue: b64 },
        createdAt: { integerValue: String(Date.now()) },
      },
    }),
  });
  if (!shotRes.ok) {
    console.error(`✗ write releaseShots failed: ${shotRes.status}`, await shotRes.text());
    process.exit(1);
  }

  // 2) Read releaseLog, set shotId on the target item, write items back.
  const getRes = await fetch(`${BASE}/appConfig/releaseLog`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const doc = await getRes.json();
  const items = doc.fields?.items?.arrayValue?.values || [];
  if (idx < 0 || idx >= items.length) {
    console.error(`✗ index ${idx} out of range (0..${items.length - 1})`);
    process.exit(1);
  }
  const fields = items[idx].mapValue.fields;
  if (fields.version?.stringValue !== 'next') {
    console.error(`✗ item ${idx} is not 'next' (version=${fields.version?.stringValue}); refusing.`);
    process.exit(1);
  }
  fields.shotId = { stringValue: shotId };
  const title = (fields.title?.stringValue || '').slice(0, 60);

  const patchRes = await fetch(`${BASE}/appConfig/releaseLog?updateMask.fieldPaths=items`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { items: { arrayValue: { values: items } } } }),
  });
  if (!patchRes.ok) {
    console.error(`✗ patch releaseLog failed: ${patchRes.status}`, await patchRes.text());
    process.exit(1);
  }
  const kb = Math.round(b64.length / 1024);
  console.log(`✓ [${idx}] shot=${shotId} (${kb}KB) → "${title}"`);
}

main();
