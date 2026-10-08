// App Store Connect — customer reviews + a rating summary derived from
// them. Falls back to mock data until credentials exist.

import { config } from '../config';
import { has } from '../secrets';
import type { RatingSummary, Review } from '../types';
import { appStoreJwt } from './auth';

const BASE = 'https://api.appstoreconnect.apple.com/v1';

export async function fetchAppStoreReviews(limit = 50): Promise<Review[]> {
  if (!has.appStore()) return [];
  const jwt = appStoreJwt();
  const url =
    `${BASE}/apps/${config.appStore.appId}/customerReviews` +
    `?sort=-createdDate&limit=${limit}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    throw new Error(`ASC reviews ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const data: any[] = json.data ?? [];
  return data.map((d) => {
    const a = d.attributes ?? {};
    return {
      id: d.id,
      source: 'appstore' as const,
      rating: a.rating ?? 0,
      title: a.title ?? undefined,
      body: a.body ?? '',
      author: a.reviewerNickname ?? 'Anonymous',
      territory: a.territory ?? undefined,
      createdAt: a.createdDate ?? new Date().toISOString(),
    };
  });
}

export async function fetchAppStoreRating(): Promise<RatingSummary | null> {
  if (!has.appStore()) return null;
  // ASC has no single "overall stars" endpoint, so we approximate from a
  // large recent-reviews sample. Good enough for a personal dashboard;
  // the trend is what matters.
  const reviews = await fetchAppStoreReviews(200);
  return summarize('appstore', reviews);
}

// ── store version states (for the "גרסאות" screen) ──
export interface StoreVersion {
  version: string; // e.g. "1.0.5"
  state: string; // raw appStoreState
  createdAt?: string; // ISO — when the version row was created
}

// Live version states from App Store Connect, newest first.
export async function fetchAppleVersions(limit = 6): Promise<StoreVersion[]> {
  if (!has.appStore()) return [];
  const jwt = appStoreJwt();
  const url =
    `${BASE}/apps/${config.appStore.appId}/appStoreVersions` +
    `?limit=${limit}&fields[appStoreVersions]=versionString,appStoreState,createdDate`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!res.ok) throw new Error(`ASC versions ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return ((json.data ?? []) as any[]).map((d) => ({
    version: d.attributes?.versionString ?? '',
    state: d.attributes?.appStoreState ?? '',
    createdAt: d.attributes?.createdDate ?? undefined,
  }));
}

export function summarize(
  source: 'appstore' | 'googleplay',
  reviews: Review[],
): RatingSummary {
  const histogram: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const r of reviews) {
    const s = Math.min(5, Math.max(1, Math.round(r.rating)));
    histogram[s - 1] += 1;
    sum += s;
  }
  const total = reviews.length;
  return {
    source,
    average: total ? Number((sum / total).toFixed(2)) : 0,
    total,
    histogram,
    approximate: true,
  };
}
