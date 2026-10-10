// Downloads / installs.
//   Apple  — App Store Connect Sales Reports API (daily, gzipped TSV).
//   Google — Play "statistics" reports from the Cloud Storage bucket
//            (UTF-16 CSV). Both best-effort; return null on no access.

import { gunzipSync, strFromU8 } from 'fflate';
import { config } from '../config';
import { has } from '../secrets';
import type { DailyPoint, NameCount, StoreDownloads } from '../types';
import { appStoreJwt, googleAccessToken } from './auth';

const DAY = 24 * 60 * 60 * 1000;
const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

function dayStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ── Apple ──────────────────────────────────────────────────────────
export async function fetchAppleDownloads(
  windowDays = 30,
): Promise<StoreDownloads | null> {
  if (!has.appleDownloads()) return null;
  const jwt = appStoreJwt();
  const vendor = config.appStore.vendorNumber;

  const dates = Array.from({ length: windowDays }, (_, i) =>
    dayStr(Date.now() - (i + 1) * DAY),
  );

  const perDay = await Promise.all(
    dates.map(async (date) => {
      const url =
        `https://api.appstoreconnect.apple.com/v1/salesReports?` +
        `filter[frequency]=DAILY&filter[reportType]=SALES&` +
        `filter[reportSubType]=SUMMARY&filter[vendorNumber]=${vendor}&` +
        `filter[reportDate]=${date}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
      if (res.status !== 200) return { date, units: 0, byCountry: {} as Record<string, number> };
      const buf = new Uint8Array(await res.arrayBuffer());
      let tsv: string;
      try {
        tsv = strFromU8(gunzipSync(buf));
      } catch {
        tsv = strFromU8(buf);
      }
      return parseAppleTsv(tsv, date);
    }),
  );

  const daily: DailyPoint[] = perDay
    .map((d) => ({ date: d.date, value: d.units }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = daily.reduce((s, d) => s + d.value, 0);
  const countryMap: Record<string, number> = {};
  perDay.forEach((d) =>
    Object.entries(d.byCountry).forEach(([c, n]) => {
      countryMap[c] = (countryMap[c] ?? 0) + n;
    }),
  );

  return { total, windowDays, daily, byCountry: topMap(countryMap, 8) };
}

function parseAppleTsv(tsv: string, date: string) {
  const lines = tsv.trim().split('\n');
  const header = lines[0].split('\t');
  const uIdx = header.indexOf('Units');
  const ptIdx = header.indexOf('Product Type Identifier');
  const cIdx = header.indexOf('Country Code');
  let units = 0;
  const byCountry: Record<string, number> = {};
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    const pt = cols[ptIdx] ?? '';
    // First-time downloads: product types starting with 1 or F (free).
    if (!/^1|^F/.test(pt)) continue;
    const u = Number(cols[uIdx] ?? 0);
    units += u;
    const c = cols[cIdx] ?? '—';
    byCountry[c] = (byCountry[c] ?? 0) + u;
  }
  return { date, units, byCountry };
}

// ── Google Play ────────────────────────────────────────────────────
export async function fetchPlayDownloads(): Promise<StoreDownloads | null> {
  if (!has.playDownloads()) return null;
  const token = await googleAccessToken(STORAGE_SCOPE);
  const bucket = config.googlePlay.statsBucket;
  const pkg = config.googlePlay.packageName;

  // List install report files for this package.
  const listUrl =
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o?` +
    `prefix=${encodeURIComponent(`stats/installs/installs_${pkg}_`)}`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) return null; // 403 = permission not granted yet
  const list = await listRes.json();
  const names: string[] = (list.items ?? []).map((i: any) => i.name);

  // Latest two monthly "overview" files (YYYYMM in the name).
  const overviews = names
    .filter((n) => n.endsWith('_overview.csv'))
    .sort()
    .slice(-2);
  const countries = names.filter((n) => n.endsWith('_country.csv')).sort().slice(-1);

  const daily: DailyPoint[] = [];
  for (const name of overviews) {
    const csv = await downloadCsv(bucket, name, token);
    daily.push(...parsePlayOverview(csv));
  }
  daily.sort((a, b) => (a.date < b.date ? -1 : 1));
  const recent = daily.slice(-30);
  const total = recent.reduce((s, d) => s + d.value, 0);

  let byCountry: NameCount[] = [];
  if (countries[0]) {
    const csv = await downloadCsv(bucket, countries[0], token);
    byCountry = parsePlayCountry(csv);
  }

  return { total, windowDays: 30, daily: recent, byCountry };
}

// ── Lifetime totals (since launch) ─────────────────────────────────
// Android (Google Play stats) gives all three cleanly: sum daily device
// installs / uninstalls across every monthly file, and read the latest
// "Active Device Installs" snapshot. Apple's Sales Reports only carry
// downloads — iOS deletions / active devices aren't exposed there — so the
// iOS side reports downloads only.
export interface LifetimeStats {
  android: { installs: number; uninstalls: number; active: number } | null;
  ios: { downloads: number } | null;
}

let lifetimeCache: { at: number; data: LifetimeStats } | null = null;
const LIFETIME_TTL = 30 * 60 * 1000; // 30 min — these move slowly

export async function fetchLifetimeStats(force = false): Promise<LifetimeStats> {
  if (!force && lifetimeCache && Date.now() - lifetimeCache.at < LIFETIME_TTL) {
    return lifetimeCache.data;
  }
  const [android, ios] = await Promise.all([
    fetchAndroidLifetime().catch(() => null),
    fetchIosLifetimeDownloads().catch(() => null),
  ]);
  const data: LifetimeStats = { android, ios };
  lifetimeCache = { at: Date.now(), data };
  return data;
}

async function fetchAndroidLifetime(): Promise<LifetimeStats['android']> {
  if (!has.playDownloads()) return null;
  const token = await googleAccessToken(STORAGE_SCOPE);
  const bucket = config.googlePlay.statsBucket;
  const pkg = config.googlePlay.packageName;
  const listUrl =
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o?` +
    `prefix=${encodeURIComponent(`stats/installs/installs_${pkg}_`)}`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!listRes.ok) return null;
  const list = await listRes.json();
  const overviews: string[] = ((list.items ?? []).map((i: any) => i.name) as string[])
    .filter((n) => n.endsWith('_overview.csv'))
    .sort(); // chronological — every month since launch
  if (!overviews.length) return null;

  let installs = 0;
  let uninstalls = 0;
  let active = 0;
  let activeDate = '';
  for (const name of overviews) {
    const rows = parseCsv(await downloadCsv(bucket, name, token));
    if (rows.length < 2) continue;
    const h = rows[0];
    const di = h.findIndex((c) => /daily.*device.*install/i.test(c));
    const du = h.findIndex((c) => /daily.*device.*uninstall/i.test(c));
    const ad = h.findIndex((c) => /active.*device.*install/i.test(c));
    const dt = h.findIndex((c) => /date/i.test(c));
    for (const r of rows.slice(1)) {
      if (di >= 0) installs += Number(r[di] || 0);
      if (du >= 0) uninstalls += Number(r[du] || 0);
      // newest dated "active devices" snapshot wins
      if (ad >= 0 && dt >= 0 && r[dt] && r[dt] >= activeDate) {
        active = Number(r[ad] || 0);
        activeDate = r[dt];
      }
    }
  }
  return { installs, uninstalls, active };
}

async function fetchIosLifetimeDownloads(): Promise<LifetimeStats['ios']> {
  if (!has.appleDownloads()) return null;
  const jwt = appStoreJwt();
  const vendor = config.appStore.vendorNumber;
  const now = new Date();

  const unitsFor = async (frequency: 'MONTHLY' | 'DAILY', reportDate: string): Promise<number> => {
    const url =
      `https://api.appstoreconnect.apple.com/v1/salesReports?` +
      `filter[frequency]=${frequency}&filter[reportType]=SALES&` +
      `filter[reportSubType]=SUMMARY&filter[vendorNumber]=${vendor}&` +
      `filter[reportDate]=${reportDate}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
    if (res.status !== 200) return 0;
    const buf = new Uint8Array(await res.arrayBuffer());
    let tsv: string;
    try {
      tsv = strFromU8(gunzipSync(buf));
    } catch {
      tsv = strFromU8(buf);
    }
    return parseAppleTsv(tsv, reportDate).units;
  };

  const reqs: Promise<number>[] = [];
  // Past 12 full months, monthly (covers the whole lifetime of a young app
  // with one cheap call each).
  for (let i = 1; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    reqs.push(unitsFor('MONTHLY', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`));
  }
  // Current month so far, daily (the monthly report isn't issued until the
  // month closes).
  for (let day = 1; day <= now.getDate(); day++) {
    const d = new Date(now.getFullYear(), now.getMonth(), day);
    reqs.push(unitsFor('DAILY', d.toISOString().slice(0, 10)));
  }
  const downloads = (await Promise.all(reqs)).reduce((a, b) => a + b, 0);
  return { downloads };
}

async function downloadCsv(
  bucket: string,
  name: string,
  token: string,
): Promise<string> {
  const url =
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/` +
    `${encodeURIComponent(name)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const buf = new Uint8Array(await res.arrayBuffer());
  return decodeUtf16le(buf);
}

// Play reports are UTF-16LE with a BOM.
function decodeUtf16le(bytes: Uint8Array): string {
  let start = 0;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) start = 2;
  let out = '';
  for (let i = start; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  }
  return out;
}

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(',').map((c) => c.replace(/^"|"$/g, '').trim()));
}

function parsePlayOverview(csv: string): DailyPoint[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0];
  const dateIdx = header.findIndex((h) => /date/i.test(h));
  const instIdx = header.findIndex((h) => /daily.*device.*install/i.test(h));
  const idx = instIdx >= 0 ? instIdx : header.findIndex((h) => /install/i.test(h));
  if (dateIdx < 0 || idx < 0) return [];
  return rows
    .slice(1)
    .filter((r) => r[dateIdx])
    .map((r) => ({ date: r[dateIdx], value: Number(r[idx] || 0) }));
}

function parsePlayCountry(csv: string): NameCount[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0];
  const cIdx = header.findIndex((h) => /country/i.test(h));
  const iIdx = header.findIndex((h) => /install/i.test(h));
  if (cIdx < 0 || iIdx < 0) return [];
  const map: Record<string, number> = {};
  rows.slice(1).forEach((r) => {
    const c = r[cIdx];
    if (c) map[c] = (map[c] ?? 0) + Number(r[iIdx] || 0);
  });
  return topMap(map, 8);
}

function topMap(map: Record<string, number>, limit: number): NameCount[] {
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}
