// Google Analytics (GA4) — totals + breakdowns via the Analytics Data API,
// using the user's OAuth token (same consent as AdMob).

import { config } from '../config';
import { has } from '../secrets';
import type { AnalyticsSummary, DailyPoint, NameCount } from '../types';
import { googleOAuthToken } from './auth';

function url() {
  return (
    `https://analyticsdata.googleapis.com/v1beta/properties/` +
    `${config.analytics.propertyId}:runReport`
  );
}

async function run(token: string, body: object): Promise<any> {
  const res = await fetch(url(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GA4 ${res.status}: ${await res.text()}`);
  return res.json();
}

async function dimReport(
  token: string,
  dimension: string,
  metric: string,
  days: number,
  limit: number,
): Promise<NameCount[]> {
  try {
    const json = await run(token, {
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: dimension }],
      metrics: [{ name: metric }],
      orderBys: [{ metric: { metricName: metric }, desc: true }],
      limit,
    });
    return (json.rows ?? []).map((r: any) => ({
      name: r.dimensionValues?.[0]?.value ?? '—',
      value: Number(r.metricValues?.[0]?.value ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function fetchAnalytics(): Promise<AnalyticsSummary | null> {
  if (!has.analytics()) return null;

  const token = await googleOAuthToken();

  // Totals (7d).
  const totals = await run(token, {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'newUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'engagementRate' },
    ],
  });
  const mv = totals.rows?.[0]?.metricValues ?? [];
  const num = (i: number) => Number(mv[i]?.value ?? 0);

  // Daily active users (28d).
  const daily = await run(token, {
    dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  }).catch(() => ({ rows: [] }));
  const activeUsersDaily: DailyPoint[] = (daily.rows ?? []).map((r: any) => {
    const ds: string = r.dimensionValues?.[0]?.value ?? '';
    return {
      date: `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`,
      value: Number(r.metricValues?.[0]?.value ?? 0),
    };
  });

  // Today's snapshot — active users + installs (first_open) by platform.
  let activeToday = 0;
  let installsTodayIos = 0;
  let installsTodayAndroid = 0;
  try {
    const todayUsers = await run(token, {
      dateRanges: [{ startDate: 'today', endDate: 'today' }],
      metrics: [{ name: 'activeUsers' }],
    });
    activeToday = Number(todayUsers.rows?.[0]?.metricValues?.[0]?.value ?? 0);
    const todayInst = await run(token, {
      dateRanges: [{ startDate: 'today', endDate: 'today' }],
      dimensions: [{ name: 'operatingSystem' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { value: 'first_open' } },
      },
    });
    (todayInst.rows ?? []).forEach((r: any) => {
      const os = (r.dimensionValues?.[0]?.value ?? '').toLowerCase();
      const v = Number(r.metricValues?.[0]?.value ?? 0);
      if (os.includes('ios')) installsTodayIos += v;
      else if (os.includes('android')) installsTodayAndroid += v;
    });
  } catch {
    /* leave zeros */
  }

  const [byCountry, byDevice, topScreens, topEvents] = await Promise.all([
    dimReport(token, 'country', 'activeUsers', 28, 8),
    dimReport(token, 'deviceCategory', 'activeUsers', 28, 5),
    dimReport(token, 'unifiedScreenName', 'screenPageViews', 28, 8),
    dimReport(token, 'eventName', 'eventCount', 28, 10),
  ]);

  // Installs / uninstalls (first_open / app_remove), last 30d.
  let installs30 = 0;
  let uninstalls30 = 0;
  try {
    const ev = await run(token, {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: { values: ['first_open', 'app_remove'] },
        },
      },
    });
    (ev.rows ?? []).forEach((r: any) => {
      const name = r.dimensionValues?.[0]?.value;
      const val = Number(r.metricValues?.[0]?.value ?? 0);
      if (name === 'first_open') installs30 = val;
      if (name === 'app_remove') uninstalls30 = val;
    });
  } catch {
    /* leave zero */
  }

  return {
    activeUsers7: num(0),
    newUsers7: num(1),
    sessions7: num(2),
    screenViews7: num(3),
    engagementRate7: num(4),
    installs30,
    uninstalls30,
    activeToday,
    installsTodayIos,
    installsTodayAndroid,
    activeUsersDaily,
    byCountry,
    byDevice,
    topScreens,
    topEvents,
  };
}
