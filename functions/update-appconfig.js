// Update /appConfig/android with the freshly-built version so existing
// installs see the optional-update prompt on next cold start.
//
// Mode:
//   - latestVersion         → triggers an OPTIONAL update modal (user can dismiss)
//   - minimumSupportedVersion → triggers FORCE if current < this (user can't dismiss)
//
// We bump latestVersion only — friendlier on launch day. If you decide
// the new version is critical, re-run with the same body but also
// minimumSupportedVersion: '0.2.5'.

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'soccer-app-52b6b' });
const db = admin.firestore();

(async () => {
  await db.collection('appConfig').doc('android').set(
    {
      latestVersion: '0.2.5',
      minimumSupportedVersion: '0.2.0',
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  const after = await db.collection('appConfig').doc('android').get();
  console.log('appConfig/android →', after.data());
})().catch((e) => { console.error(e); process.exit(1); });
