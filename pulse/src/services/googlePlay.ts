// Google Play reviews + ratings.
//
// The Android Publisher reviews API only returns the last ~7 days and only
// reviews WITH text — useless for a full rating count. So the source of
// truth here is the Play Console **reviews reports** (monthly CSVs) in the
// GCS reports bucket, which carry the entire history INCLUDING star-only
// ratings. We merge the live API on top to cover the 1–2 day report lag
// (and to keep reviewer names for the freshest few). Downloads are NOT
// here — those come from the analytics events pipeline.

import { config } from '../config';
import { has } from '../secrets';
import type { RatingSummary, Review } from '../types';
import { googleAccessToken } from './auth';
import { summarize } from './appStoreConnect';

const PUB_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

// ── live API (last ~7 days, text-only, has reviewer names) ──
async function fetchPlayReviewsApi(limit = 50): Promise<Review[]> {
  const token = await googleAccessToken(PUB_SCOPE);
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${config.googlePlay.packageName}/reviews?maxResults=${limit}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Play reviews ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const out: Review[] = [];
  for (const d of (json.reviews ?? []) as any[]) {
    const uc = (d.comments ?? []).find((c: any) => c.userComment)?.userComment;
    if (!uc) continue;
    const seconds = Number(uc.lastModified?.seconds ?? 0);
    out.push({
      id: d.reviewId,
      source: 'googleplay',
      rating: uc.starRating ?? 0,
      body: uc.text ?? '',
      author: d.authorName ?? 'Anonymous',
      territory: uc.reviewerLanguage ?? undefined,
      version: uc.appVersionName ?? undefined,
      createdAt: seconds ? new Date(seconds * 1000).toISOString() : new Date().toISOString(),
    });
  }
  return out;
}

// ── Play Console reviews reports (full history, all ratings) ──
function decodeBytes(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  // Play report CSVs are UTF-16LE with a BOM. JS strings are UTF-16, so
  // emitting each little-endian code unit reconstructs text + surrogates.
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    let s = '';
    for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] | (b[i + 1] << 8));
    return s;
  }
  // Fallback: UTF-8.
  try {
    return new (globalThis as any).TextDecoder('utf-8').decode(b);
  } catch {
    let s = '';
    for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]);
    return s;
  }
}

// CSV parser that respects quoted fields with embedded commas / newlines /
// escaped quotes ("") — review text routinely contains all three.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i += 1; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c === '\r') { /* skip */ }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function listReportCsvs(token: string): Promise<string[]> {
  const bucket = config.googlePlay.statsBucket;
  const prefix = `reviews/reviews_${config.googlePlay.packageName}`;
  const out: string[] = [];
  let pageToken = '';
  do {
    const url =
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o` +
      `?prefix=${encodeURIComponent(prefix)}&maxResults=1000` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GCS list ${res.status}`);
    const j = await res.json();
    for (const it of (j.items ?? []) as any[]) {
      if (typeof it.name === 'string' && it.name.endsWith('.csv')) out.push(it.name);
    }
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

export async function fetchPlayReviewsFromReports(): Promise<Review[]> {
  const bucket = config.googlePlay.statsBucket;
  if (!has.play() || !bucket) return [];
  const token = await googleAccessToken(STORAGE_SCOPE);
  const files = await listReportCsvs(token);
  const out: Review[] = [];
  for (const name of files) {
    const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;
    const rows = parseCsv(decodeBytes(await res.arrayBuffer()));
    if (rows.length < 2) continue;
    const h = rows[0].map((x) => x.trim());
    const idx = (label: string) => h.indexOf(label);
    const iRating = idx('Star Rating');
    const iTitle = idx('Review Title');
    const iText = idx('Review Text');
    const iLang = idx('Reviewer Language');
    const iVer = idx('App Version Name');
    const iMillis = idx('Review Last Update Millis Since Epoch');
    const iSubMillis = idx('Review Submit Millis Since Epoch');
    const iLink = idx('Review Link');
    for (const r of rows.slice(1)) {
      const rating = Number(r[iRating] || 0);
      if (!(rating >= 1 && rating <= 5)) continue;
      const ms = Number(r[iMillis] || r[iSubMillis] || 0);
      out.push({
        id: (iLink >= 0 && r[iLink]) ? r[iLink] : `gp_${ms}_${rating}`,
        source: 'googleplay',
        rating,
        title: iTitle >= 0 ? (r[iTitle] || undefined) : undefined,
        body: iText >= 0 ? (r[iText] || '') : '',
        author: 'Anonymous', // Play reports are anonymized
        territory: iLang >= 0 ? (r[iLang] || undefined) : undefined,
        version: iVer >= 0 ? (r[iVer] || undefined) : undefined,
        createdAt: ms ? new Date(ms).toISOString() : new Date().toISOString(),
      });
    }
  }
  return out;
}

// Public: full-history reviews. Reports are the base; live-API reviews that
// are newer than the newest report row are appended to cover report lag.
export async function fetchPlayReviews(limit = 50): Promise<Review[]> {
  if (!has.play()) return [];
  const [reports, api] = await Promise.all([
    fetchPlayReviewsFromReports().catch(() => [] as Review[]),
    fetchPlayReviewsApi(limit).catch(() => [] as Review[]),
  ]);
  if (!reports.length) return api;
  const newest = reports.reduce((m, r) => Math.max(m, Date.parse(r.createdAt) || 0), 0);
  const fresh = api.filter((r) => (Date.parse(r.createdAt) || 0) > newest);
  return [...fresh, ...reports].sort(
    (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
  );
}

// ── production track state (for the "גרסאות" screen) ──
export interface PlayRelease {
  name: string; // version name, e.g. "1.0.5"
  versionCode: number;
  status: string; // completed | inProgress | halted | draft
}

// The live production release on Google Play. Reads the production track via
// a throwaway edit (which we abandon — no changes committed). Returns null if
// the account can't read tracks; the screen then falls back to the DB.
export async function fetchPlayProductionRelease(): Promise<PlayRelease | null> {
  if (!has.play()) return null;
  const token = await googleAccessToken(PUB_SCOPE);
  const pkg = config.googlePlay.packageName;
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}`;
  const auth = { Authorization: `Bearer ${token}` };
  // open a transient edit
  const eRes = await fetch(`${base}/edits`, { method: 'POST', headers: auth });
  if (!eRes.ok) return null;
  const editId = (await eRes.json()).id as string;
  try {
    const tRes = await fetch(`${base}/edits/${editId}/tracks/production`, { headers: auth });
    if (!tRes.ok) return null;
    const track = await tRes.json();
    const releases: any[] = track.releases ?? [];
    // Prefer a live (completed/inProgress) release; newest versionCode wins.
    const ranked = releases
      .filter((r) => Array.isArray(r.versionCodes) && r.versionCodes.length)
      .map((r) => ({
        name: String(r.name ?? ''),
        versionCode: Math.max(...r.versionCodes.map((c: string) => Number(c))),
        status: String(r.status ?? ''),
      }))
      .sort((a, b) => b.versionCode - a.versionCode);
    const live = ranked.find((r) => r.status === 'completed' || r.status === 'inProgress');
    return live ?? ranked[0] ?? null;
  } finally {
    // abandon the edit so nothing is committed
    await fetch(`${base}/edits/${editId}`, { method: 'DELETE', headers: auth }).catch(() => {});
  }
}

export async function fetchPlayRating(): Promise<RatingSummary | null> {
  if (!has.play()) return null;
  const reviews = await fetchPlayReviews(200);
  const sum = summarize('googleplay', reviews);
  // Reports give the COMPLETE rating set, so the average is exact, not a
  // 7-day sample. Flag it accordingly.
  return { ...sum, approximate: reviews.length === 0 };
}
