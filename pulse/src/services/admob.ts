// AdMob — estimated earnings + breakdowns via the networkReport. OAuth
// user token. Runs a few targeted reports: daily totals, per-ad-unit
// ("most profitable ad"), and per-country.

import { config } from '../config';
import { has } from '../secrets';
import type { AdUnitStat, DailyPoint, NameCount, RevenueSummary } from '../types';
import { googleOAuthToken } from './auth';

const BASE = 'https://admob.googleapis.com/v1';

function ymd(d: Date) {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}
function dateKey(y: number, m: number, d: number) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}

async function resolveAccount(
  token: string,
): Promise<{ name: string; currency: string }> {
  if (config.admob.publisherId) {
    return { name: `accounts/${config.admob.publisherId}`, currency: 'USD' };
  }
  const res = await fetch(`${BASE}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`AdMob accounts ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const acc = (json.account ?? [])[0];
  if (!acc) throw new Error('AdMob: no account on this login');
  return { name: acc.name, currency: acc.currencyCode ?? 'USD' };
}

interface ReportRow {
  dims: Record<string, { value?: string; displayLabel?: string }>;
  earnings: number; // major units
  impressions: number;
  clicks: number;
}

async function runReport(
  token: string,
  account: string,
  dimensions: string[],
  metrics: string[],
  days: number,
): Promise<ReportRow[]> {
  const end = new Date();
  const start = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  const res = await fetch(`${BASE}/${account}/networkReport:generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportSpec: {
        dateRange: { startDate: ymd(start), endDate: ymd(end) },
        dimensions,
        metrics,
      },
    }),
  });
  if (!res.ok) throw new Error(`AdMob report ${res.status}: ${await res.text()}`);
  const arr: any[] = await res.json();
  const rows: ReportRow[] = [];
  for (const item of arr) {
    const row = item.row;
    if (!row) continue;
    rows.push({
      dims: row.dimensionValues ?? {},
      earnings: Number(row.metricValues?.ESTIMATED_EARNINGS?.microsValue ?? 0) / 1e6,
      impressions: Number(row.metricValues?.IMPRESSIONS?.integerValue ?? 0),
      clicks: Number(row.metricValues?.CLICKS?.integerValue ?? 0),
    });
  }
  return rows;
}

export async function fetchRevenue(): Promise<RevenueSummary | null> {
  if (!has.admob()) return null;

  const token = await googleOAuthToken();
  const { name, currency } = await resolveAccount(token);

  // Daily totals (28d) — earnings, impressions, clicks.
  const daily28 = await runReport(
    token, name, ['DATE'], ['ESTIMATED_EARNINGS', 'IMPRESSIONS', 'CLICKS'], 28,
  );
  const daily: DailyPoint[] = daily28.map((r) => {
    const ds = r.dims.DATE?.value ?? '';
    return {
      date: dateKey(+ds.slice(0, 4), +ds.slice(4, 6), +ds.slice(6, 8)),
      value: Number(r.earnings.toFixed(2)),
    };
  });
  const earn = daily.map((d) => d.value);
  const last = (n: number, a: number[]) => a.slice(-n).reduce((s, v) => s + v, 0);
  const impr7 = daily28.slice(-7).reduce((s, r) => s + r.impressions, 0);
  const clicks7 = daily28.slice(-7).reduce((s, r) => s + r.clicks, 0);
  const last7 = Number(last(7, earn).toFixed(2));

  // All-time total — a single no-breakdown report from the app's launch
  // year (2026-01-01) to today. The app shipped in 2026, so this IS its
  // all-time, and starting at launch avoids querying empty prior years.
  // Best-effort: on failure fall back to last28 so it's never under-reported.
  let allTime = Number(last(28, earn).toFixed(2));
  try {
    const res = await fetch(`${BASE}/${name}/networkReport:generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportSpec: {
          dateRange: {
            startDate: { year: 2026, month: 1, day: 1 },
            endDate: ymd(new Date()),
          },
          metrics: ['ESTIMATED_EARNINGS'],
        },
      }),
    });
    if (res.ok) {
      const arr: any[] = await res.json();
      const totalMicros = arr.reduce(
        (s, item) =>
          s +
          Number(item.row?.metricValues?.ESTIMATED_EARNINGS?.microsValue ?? 0),
        0,
      );
      allTime = Number((totalMicros / 1e6).toFixed(2));
    }
  } catch {
    /* keep the last28 fallback */
  }

  // Per-ad-unit (28d) — best-effort.
  let adUnits: AdUnitStat[] = [];
  try {
    const rows = await runReport(
      token, name, ['AD_UNIT'], ['ESTIMATED_EARNINGS', 'IMPRESSIONS'], 28,
    );
    adUnits = rows
      .map((r) => ({
        name: r.dims.AD_UNIT?.displayLabel ?? r.dims.AD_UNIT?.value ?? 'Ad unit',
        earnings: Number(r.earnings.toFixed(2)),
        impressions: r.impressions,
        ecpm: r.impressions
          ? Number(((r.earnings / r.impressions) * 1000).toFixed(2))
          : 0,
      }))
      .sort((a, b) => b.earnings - a.earnings);
  } catch {
    /* leave empty */
  }

  // Per-country (28d) — best-effort.
  let byCountry: NameCount[] = [];
  try {
    const rows = await runReport(
      token, name, ['COUNTRY'], ['ESTIMATED_EARNINGS'], 28,
    );
    byCountry = rows
      .map((r) => ({
        name: r.dims.COUNTRY?.value ?? '—',
        value: Number(r.earnings.toFixed(2)),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  } catch {
    /* leave empty */
  }

  return {
    currency,
    today: daily.length ? daily[daily.length - 1].value : 0,
    last7,
    last28: Number(last(28, earn).toFixed(2)),
    allTime,
    impressions7: impr7,
    ecpm7: impr7 ? Number(((last7 / impr7) * 1000).toFixed(2)) : 0,
    clicks7,
    ctr7: impr7 ? Number((clicks7 / impr7).toFixed(4)) : 0,
    daily,
    adUnits,
    byCountry,
  };
}
