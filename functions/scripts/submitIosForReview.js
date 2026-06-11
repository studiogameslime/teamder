#!/usr/bin/env node
// Submit the uploaded iOS build (1.0.13) for App Store REVIEW via the App
// Store Connect API — the step `eas submit` does NOT do (it only uploads the
// binary to TestFlight). Waits for Apple to finish processing the build,
// creates/reuses the 1.0.13 App Store version, attaches the build, and files
// a review submission.

const crypto = require('crypto');
const fs = require('fs');

const KEY_ID = 'SQBY46Q3DC';
const ISSUER_ID = '0938f882-34aa-42d5-af5d-cab509cac969';
const P8_PATH = '/Users/matan/Downloads/AuthKey_SQBY46Q3DC.p8';
const APP_ID = '6775178022';
const VERSION = '1.0.13';
const BUILD_NUMBER = '22';
const WHATS_NEW =
  'שיפורי עיצוב וחוויית משתמש, אנימציות חדשות, ותיקוני באגים.';

const BASE = 'https://api.appstoreconnect.apple.com/v1';
const privateKey = fs.readFileSync(P8_PATH, 'utf8');

function jwt() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER_ID,
    iat: now,
    exp: now + 1100,
    aud: 'appstoreconnect-v1',
  };
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${sig.toString('base64url')}`;
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${jwt()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-json */
  }
  return { ok: res.ok, status: res.status, json, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) Find the build (1.0.13 / build 22) and wait until it's VALID.
  let buildId = null;
  for (let i = 0; i < 40; i++) {
    const r = await api(
      'GET',
      `/builds?filter[app]=${APP_ID}&filter[version]=${BUILD_NUMBER}&limit=5`,
    );
    const b = (r.json?.data || [])[0];
    if (b) {
      const state = b.attributes?.processingState;
      buildId = b.id;
      console.log(`build ${BUILD_NUMBER}: ${state}`);
      if (state === 'VALID') break;
      if (state === 'FAILED' || state === 'INVALID') {
        console.error('✗ build processing failed:', state);
        process.exit(1);
      }
    } else {
      console.log('build not visible yet…');
    }
    await sleep(30000);
  }
  if (!buildId) {
    console.error('✗ build never became visible/VALID');
    process.exit(1);
  }

  // 2) Find or create the 1.0.13 App Store version (editable).
  let versionId = null;
  const vr = await api(
    'GET',
    `/apps/${APP_ID}/appStoreVersions?filter[versionString]=${VERSION}&filter[platform]=IOS&limit=1`,
  );
  const existing = (vr.json?.data || [])[0];
  const EDITABLE = [
    'PREPARE_FOR_SUBMISSION',
    'DEVELOPER_REJECTED',
    'REJECTED',
    'METADATA_REJECTED',
    'INVALID_BINARY',
  ];
  if (existing && EDITABLE.includes(existing.attributes?.appStoreState)) {
    versionId = existing.id;
    console.log(`reusing version ${VERSION} (${existing.attributes.appStoreState})`);
  } else if (existing) {
    console.log(
      `version ${VERSION} exists in state ${existing.attributes?.appStoreState} — using it`,
    );
    versionId = existing.id;
  } else {
    const cr = await api('POST', '/appStoreVersions', {
      data: {
        type: 'appStoreVersions',
        attributes: { platform: 'IOS', versionString: VERSION },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    });
    if (!cr.ok) {
      console.error('✗ create version failed', cr.status, cr.text);
      process.exit(1);
    }
    versionId = cr.json.data.id;
    console.log(`created version ${VERSION}`);
  }

  // 2b) Best-effort "What's New" (localization) — non-fatal.
  const loc = await api(
    'GET',
    `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=20`,
  );
  for (const l of loc.json?.data || []) {
    await api('PATCH', `/appStoreVersionLocalizations/${l.id}`, {
      data: {
        type: 'appStoreVersionLocalizations',
        id: l.id,
        attributes: { whatsNew: WHATS_NEW },
      },
    });
  }

  // 3) Attach the build to the version.
  const setBuild = await api(
    'PATCH',
    `/appStoreVersions/${versionId}/relationships/build`,
    { data: { type: 'builds', id: buildId } },
  );
  if (!setBuild.ok) {
    console.error('✗ attach build failed', setBuild.status, setBuild.text);
    process.exit(1);
  }
  console.log('attached build to version');

  // 4) Create a review submission, add the version as an item, submit.
  // Reuse an in-progress submission if one exists.
  let subId = null;
  const subs = await api(
    'GET',
    `/reviewSubmissions?filter[app]=${APP_ID}&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW&limit=1`,
  );
  if ((subs.json?.data || [])[0]) {
    subId = subs.json.data[0].id;
    console.log('reusing existing review submission');
  } else {
    const cs = await api('POST', '/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    });
    if (!cs.ok) {
      console.error('✗ create reviewSubmission failed', cs.status, cs.text);
      process.exit(1);
    }
    subId = cs.json.data.id;
    console.log('created review submission');
  }

  const item = await api('POST', '/reviewSubmissionItems', {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: subId } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    },
  });
  if (!item.ok && item.status !== 409) {
    console.error('⚠ add submission item:', item.status, item.text);
  } else {
    console.log('added version to review submission');
  }

  const submit = await api('PATCH', `/reviewSubmissions/${subId}`, {
    data: {
      type: 'reviewSubmissions',
      id: subId,
      attributes: { submitted: true },
    },
  });
  if (!submit.ok) {
    console.error('✗ submit for review failed', submit.status, submit.text);
    process.exit(1);
  }
  console.log('✅ Submitted 1.0.13 for App Store review!');
}

main().catch((e) => {
  console.error('error', e);
  process.exit(1);
});
