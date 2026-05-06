#!/usr/bin/env node
// One-shot: write /appConfig/{android,ios} via the Firestore REST API
// using the local gcloud user's access token. No service-account key
// needed and no firebase-admin / ADC plumbing — just `gcloud auth login`
// once on the dev machine and you're set.
//
// Run from the functions/ directory:
//   node scripts/setAppConfig.js <latestVersion> [<minimumSupportedVersion>]
//
// `latestVersion` triggers the OPTIONAL update banner.
// `minimumSupportedVersion` (optional) triggers the FORCE update banner —
//   anything below this is blocked until the user updates.

const { execSync } = require('child_process');

const PROJECT = 'soccer-app-52b6b';
const PLATFORMS = ['android', 'ios'];

const latestVersion = process.argv[2];
const minimumSupportedVersion = process.argv[3];

if (!latestVersion) {
  console.error(
    'usage: node scripts/setAppConfig.js <latestVersion> [<minimumSupportedVersion>]',
  );
  process.exit(1);
}

const token = execSync('gcloud auth print-access-token', {
  encoding: 'utf8',
}).trim();

const now = Date.now();

const fields = {
  latestVersion: { stringValue: latestVersion },
  updatedAt: { integerValue: String(now) },
};
const updateMask = ['latestVersion', 'updatedAt'];
if (minimumSupportedVersion) {
  fields.minimumSupportedVersion = { stringValue: minimumSupportedVersion };
  updateMask.push('minimumSupportedVersion');
}

(async () => {
  for (const platform of PLATFORMS) {
    const params = updateMask
      .map((f) => `updateMask.fieldPaths=${f}`)
      .join('&');
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/appConfig/${platform}?${params}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      console.error(`✗ ${platform}: HTTP ${res.status}`, await res.text());
      process.exitCode = 1;
      continue;
    }
    console.log(`✓ /appConfig/${platform} updated → latestVersion=${latestVersion}`);
  }
})();
