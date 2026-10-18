// Preparation only. This executable is deliberately restricted to a demo
// emulator. Production migration requires a separately approved procedure.
const admin = require('../functions/node_modules/firebase-admin');
const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || '';
if (!/^127\.0\.0\.1:\d+$/.test(host || '') || !projectId.startsWith('demo-')) {
  throw new Error('Only an isolated local demo emulator is allowed');
}
admin.initializeApp({projectId});
const apply = process.argv.includes('--apply');
const db = admin.firestore();
(async () => {
  let cursor, inspected = 0, migrated = 0;
  for (;;) {
    let query = db.collection('groups').orderBy('__name__').limit(200);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      inspected++;
      if (!Object.hasOwn(doc.data(), 'adminRatings')) continue;
      if (apply) await db.runTransaction(async tx => {
        const privateRef = doc.ref.collection('private').doc('adminRatings');
        const [current, privateDoc] = await Promise.all([tx.get(doc.ref), tx.get(privateRef)]);
        if (!current.exists || !Object.hasOwn(current.data(), 'adminRatings')) return;
        if (!privateDoc.exists) {
          const members = new Set(current.data().playerIds ?? []);
          const ratings = Object.fromEntries(Object.entries(current.data().adminRatings ?? {}).filter(([uid,n]) => members.has(uid) && typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 5));
          tx.set(privateRef, {ratings, updatedAt: Date.now()});
        }
        tx.update(doc.ref, {adminRatings: admin.firestore.FieldValue.delete()});
      });
      migrated++;
    }
    cursor = page.docs.at(-1);
  }
  console.log(JSON.stringify({apply, inspected, candidates: migrated}));
  await admin.app().delete();
})().catch(error => { console.error(error.message); process.exitCode=1; });
