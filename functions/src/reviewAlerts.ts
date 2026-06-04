// Near-real-time review/rating alerts. Apple & Google don't push review
// events, so we poll their APIs server-side (from cronEvery15Min) and FCM a
// "new review" push to the founder's Pulse device(s) — works even with the
// app closed. ~minutes latency (the best possible for store reviews).

import * as admin from 'firebase-admin';
import { KEYUTIL, KJUR } from 'jsrsasign';
import { pushToAdmins } from './adminPush';

// Non-secret config.
const APP_STORE_APP_ID = '6775178022';
const PLAY_PACKAGE = 'com.studiogameslime.soccerapp';
const ASC_KEY_ID = 'SQBY46Q3DC';
const ASC_ISSUER_ID = '0938f882-34aa-42d5-af5d-cab509cac969';
const SEEN_CAP = 300;

interface NewReview {
  store: 'appstore' | 'googleplay';
  id: string;
  rating: number;
  title?: string;
  body: string;
  author: string;
}

function ascJwt(p8: string): string {
  const now = Math.floor(Date.now() / 1000);
  const key = KEYUTIL.getKey(p8);
  return KJUR.jws.JWS.sign(
    'ES256',
    JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }),
    JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }),
    key as unknown as string,
  );
}

async function playToken(saJson: string): Promise<string> {
  const sa = JSON.parse(saJson);
  const now = Math.floor(Date.now() / 1000);
  const key = KEYUTIL.getKey(sa.private_key);
  const assertion = KJUR.jws.JWS.sign(
    'RS256',
    JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
    key as unknown as string,
  );
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
      encodeURIComponent(assertion),
  });
  return ((await r.json()) as { access_token: string }).access_token;
}

async function fetchAppleReviews(p8: string): Promise<NewReview[]> {
  const r = await fetch(
    `https://api.appstoreconnect.apple.com/v1/apps/${APP_STORE_APP_ID}/customerReviews?sort=-createdDate&limit=50`,
    { headers: { Authorization: 'Bearer ' + ascJwt(p8) } },
  );
  if (!r.ok) return [];
  const j = (await r.json()) as { data?: any[] };
  return (j.data ?? []).map((d) => ({
    store: 'appstore' as const,
    id: d.id,
    rating: d.attributes?.rating ?? 0,
    title: d.attributes?.title ?? undefined,
    body: d.attributes?.body ?? '',
    author: d.attributes?.reviewerNickname ?? 'Anonymous',
  }));
}

async function fetchPlayReviews(saJson: string): Promise<NewReview[]> {
  const token = await playToken(saJson);
  const r = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}/reviews?maxResults=50`,
    { headers: { Authorization: 'Bearer ' + token } },
  );
  if (!r.ok) return [];
  const j = (await r.json()) as { reviews?: any[] };
  return (j.reviews ?? []).map((d) => {
    const uc = (d.comments ?? []).find((c: any) => c.userComment)?.userComment;
    return {
      store: 'googleplay' as const,
      id: d.reviewId,
      rating: uc?.starRating ?? 0,
      body: uc?.text ?? '',
      author: d.authorName ?? 'Anonymous',
    };
  });
}

export async function runReviewAlerts(ascP8: string, playSa: string): Promise<void> {
  if (!ascP8 && !playSa) return;
  // Lazy: admin.initializeApp() runs in index.ts AFTER this module is imported,
  // so resolve at call time (the cron fires post-init), never at load.
  const db = admin.firestore();

  let all: NewReview[] = [];
  if (ascP8) {
    try {
      all = all.concat(await fetchAppleReviews(ascP8));
    } catch (e) {
      console.warn('[reviewAlerts] apple failed', e);
    }
  }
  if (playSa) {
    try {
      all = all.concat(await fetchPlayReviews(playSa));
    } catch (e) {
      console.warn('[reviewAlerts] play failed', e);
    }
  }
  if (!all.length) return;

  const ref = db.collection('adminConfig').doc('reviewState');
  const snap = await ref.get();
  const firstRun = !snap.exists;
  const seenIds: string[] = (snap.data()?.seenIds as string[] | undefined) ?? [];
  const seenSet = new Set(seenIds);

  const fresh = all.filter((r) => !seenSet.has(r.id));
  const nextSeen = [...all.map((r) => r.id), ...seenIds]
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, SEEN_CAP);
  await ref.set(
    { seenIds: nextSeen, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );

  // First ever run: seed the baseline, don't dump every existing review.
  if (firstRun || !fresh.length) return;

  for (const rev of fresh.slice(0, 5)) {
    const n = Math.max(1, Math.min(5, Math.round(rev.rating)));
    const stars = '★'.repeat(n) + '☆'.repeat(5 - n);
    const store = rev.store === 'appstore' ? 'App Store' : 'Google Play';
    const body =
      (rev.title ? rev.title + ' — ' : '') + (rev.body || '').slice(0, 140) ||
      `דירוג חדש מ-${rev.author}`;
    await pushToAdmins('review', `${stars}  ${store}`, body, {
      store: rev.store,
      reviewId: rev.id,
    });
  }
  console.log(`[reviewAlerts] ${fresh.length} new review(s); pushed ${Math.min(5, fresh.length)}`);
}
