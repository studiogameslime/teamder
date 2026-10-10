import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import * as fs from 'fs';
import * as path from 'path';
import { readTrackedAdLink, renderTrackedAdLink, shortCodeFromPath } from './shortAdLinkPage';
let template: string | undefined;
function landingTemplate(): string {
  return template ?? (template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'invite.html'), 'utf8'));
}
export const serveAdLink = onRequest({ region: 'us-central1', memory: '256MiB' }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'text/html; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).send('Method not allowed'); return; }
  const code = shortCodeFromPath(req.path);
  if (!code) { res.status(404).send('הקישור אינו זמין'); return; }
  try {
    const snap = await admin.firestore().collection('adLinks').doc(code).get();
    const link = readTrackedAdLink(snap.exists ? snap.data() : undefined, code);
    if (!link) { res.status(404).send('הקישור אינו זמין'); return; }
    // Only the existing browser beacon counts clicks. Crawlers/HEAD never add clicks here.
    res.status(200).send(renderTrackedAdLink(landingTemplate(), link));
  } catch (err) {
    console.error('[serveAdLink] failed', err);
    res.status(503).send('לא הצלחנו לפתוח את הקישור כרגע. נסה שוב בקרוב');
  }
});
