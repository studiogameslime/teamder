import { randomUUID } from 'node:crypto';
import { getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from './observedFunctions';
import { parseCrashEntry, importCrash, deliverCrashAlerts } from './crashlyticsIngest';

export async function scanCrashlytics(): Promise<void> {
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (project !== 'soccer-app-52b6b') throw new Error('Unexpected Crashlytics project');
  const db = getFirestore(), health = db.doc('adminConfig/crashlyticsBridge');
  const owner = randomUUID(), started = Date.now();
  const previous = await db.runTransaction(async tx => {
    const state = (await tx.get(health)).data() ?? {};
    if (Number(state.leaseUntil ?? 0) > started) return null;
    tx.set(health, { leaseOwner: owner, leaseUntil: started + 600_000, lastAttemptAt: started }, { merge: true });
    return state;
  });
  if (!previous) return;
  let imported = 0, pages = 0;
  try {
    const continuing = previous.scanVersion === 2 && typeof previous.scanPageToken === 'string' && previous.scanPageToken.length > 0;
    const from = continuing ? Number(previous.scanFrom) : Math.max(Number(previous.lastScanAt ?? started) - 86400000, started - 29 * 86400000);
    const until = continuing ? Number(previous.scanUntil) : started - 30_000;
    let pageToken: string | undefined = continuing ? previous.scanPageToken : undefined;
    do {
      const credential = getApp().options.credential;
      if (!credential) throw new Error('Missing server credential');
      const token = await credential.getAccessToken();
      const response = await fetch('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceNames: [`projects/${project}`],
          filter: `logName="projects/${project}/logs/firebasecrashlytics.googleapis.com%2Fevents" AND jsonPayload.bundleOrPackage="com.studiogameslime.soccerapp" AND (jsonPayload.issue.errorType="FATAL" OR jsonPayload.issue.errorType="ANR") AND timestamp>="${new Date(until - 30 * 86400000).toISOString()}" AND receiveTimestamp>="${new Date(from).toISOString()}" AND receiveTimestamp<="${new Date(until).toISOString()}"`,
          orderBy: 'timestamp desc', pageSize: 500, ...(pageToken ? { pageToken } : {}),
        }), signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Crashlytics log read failed: HTTP ${response.status}`);
      const result = await response.json() as { entries?: Record<string, any>[]; nextPageToken?: string };
      for (const entry of result.entries ?? []) {
        const event = parseCrashEntry(entry, project);
        if (event && await importCrash(event, db)) ++imported;
      }
      pageToken = result.nextPageToken;
      ++pages;
      // Logging can return an empty partial-search page with a continuation
      // token. Persist the exact fixed window/token; do not restart that search
      // forever, and never claim the whole window was scanned prematurely.
      await health.set({ scanVersion: 2, scanPageToken: pageToken ?? null, scanFrom: from, scanUntil: until, lastProgressAt: Date.now() }, { merge: true });
      if (pages >= 20 && pageToken) break;
    } while (pageToken);
    const delivery = await deliverCrashAlerts(db);
    await health.set({ ...(!pageToken ? { lastScanAt: until, lastSuccessAt: Date.now() } : {}), imported, pages, lastDelivery: delivery }, { merge: true });
    console.info('crashlytics-pulse-sync', { imported, pages, continuing: !!pageToken, ...delivery });
  } finally {
    await db.runTransaction(async tx => {
      const state = (await tx.get(health)).data();
      if (state?.leaseOwner === owner) tx.update(health, { leaseUntil: 0 });
    });
  }
}

export const syncCrashlyticsToPulse = onSchedule({
  schedule: 'every 5 minutes', timeZone: 'UTC', region: 'us-central1',
  timeoutSeconds: 300, memory: '256MiB', maxInstances: 1, concurrency: 1,
  retryCount: 3, maxRetrySeconds: 600,
}, scanCrashlytics);
