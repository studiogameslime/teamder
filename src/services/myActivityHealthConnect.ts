import { assertSportsActivityEnabled } from '@/config/sportsActivity';
import { activityProvider } from '../utils/activityProviders';
import { Platform } from 'react-native';
import type { Permission, ReadRecordsOptions } from 'react-native-health-connect';
import { observeCaughtError } from '../utils/errorObservation';
import { activityMovement, type MovementSample } from '../utils/activityMovement';

type HealthConnect = typeof import('react-native-health-connect');
export type HealthMetric = 'distance' | 'steps' | 'active-calories' | 'total-calories' | 'speed-max' | 'speed-avg' | 'stationary-ms' | 'walking-ms' | 'running-ms' | 'sprint-ms' | 'sprints' | 'sampled-ms';
export interface HealthOrigin { id: string; label: string; detail: string; kind: 'health-connect' }
export interface HealthMetricSnapshot { recordType: HealthMetric; value: number | null; from: number; to: number }
export interface HealthWindow {
  metrics: HealthMetricSnapshot[];
  missingPermissions: HealthMetric[];
}
const TYPES = [
  ['Distance', 'distance'], ['Steps', 'steps'], ['ActiveCaloriesBurned', 'active-calories'],
  ['TotalCaloriesBurned', 'total-calories'],
] as const;
const SPEED_FIELDS = { maxSpeedKmh: 'speed-max', avgSpeedKmh: 'speed-avg', stationaryMs: 'stationary-ms',
  walkingMs: 'walking-ms', runningMs: 'running-ms', sprintMs: 'sprint-ms', sprints: 'sprints', sampledMs: 'sampled-ms' } as const;


export class ActivityHealthError extends Error {
  constructor(public readonly reason: 'unavailable' | 'permission' | 'incomplete' | 'invalid-range' | 'origin-mismatch') {
    super(reason); this.name = 'ActivityHealthError';
  }
}

/** No initialization failure is cached: installing/updating the provider can recover. */
async function nativeHealth(): Promise<HealthConnect> {
  assertSportsActivityEnabled();
  if (Platform.OS !== 'android') throw new ActivityHealthError('unavailable');
  let native: HealthConnect;
  try { native = require('react-native-health-connect') as HealthConnect; }
  catch {
    observeCaughtError(new Error('Activity health module unavailable'), {
      source: 'src/services/myActivityHealthConnect.ts', handler: 'nativeHealth', site: 'myActivity:health-module-unavailable',
    });
    throw new ActivityHealthError('unavailable');
  }
  if (await native.getSdkStatus() !== 3 || !await native.initialize()) throw new ActivityHealthError('unavailable');
  return native;
}
function grantedTypes(permissions: Awaited<ReturnType<HealthConnect['requestPermission']>>): Set<string> {
  return new Set(permissions.flatMap(p => 'recordType' in p && p.accessType === 'read' ? [p.recordType] : []));
}
function timeRange(from: number, to: number): ReadRecordsOptions['timeRangeFilter'] {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from ||
    to > 8640000000000000 || to - from > 31 * 86400000) {
    throw new ActivityHealthError('invalid-range');
  }
  return { operator: 'between', startTime: new Date(from).toISOString(), endTime: new Date(to).toISOString() };
}

/** Discovery only. Unfiltered data is never displayed, summed or uploaded. */
export async function discoverActivityHealthOrigins(from: number, to: number): Promise<HealthOrigin[]> {
  const range = timeRange(from, to), native = await nativeHealth();
  const granted = grantedTypes(await native.getGrantedPermissions());
  if (![...TYPES.map(([type]) => type), 'Speed'].some(type => granted.has(type))) throw new ActivityHealthError('permission');
  const origins = new Set<string>();
  for (const recordType of [...TYPES.map(([type]) => type), 'Speed'] as const) {
    if (!granted.has(recordType)) continue;
    let pageToken: string | undefined;
    const seen = new Set<string>();
    let pages = 0;
    do {
      const result = await native.readRecords(recordType, { timeRangeFilter: range, pageSize: 1000, pageToken });
      for (const record of result.records) {
        const origin = record.metadata?.dataOrigin;
        if (origin && /^[A-Za-z0-9_.-]{1,255}$/.test(origin)) origins.add(origin);
      }
      pageToken = result.pageToken || undefined;
      if (pageToken && (seen.has(pageToken) || ++pages >= 100)) throw new ActivityHealthError('incomplete');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
  }
  return [...origins].sort().map(id => ({ id, kind: 'health-connect', label: activityProvider(id).label,
    detail: activityProvider(id).hint }));
}

/** Called only after the screen has displayed its prominent local/cloud disclosure. */
export async function requestActivityHealthPermissions(): Promise<void> {
  const native = await nativeHealth();
  // No background, history, location or heart-rate scopes are requested here.
  const requestedTypes = ['Distance', 'Steps', 'Speed', 'ActiveCaloriesBurned'] as const;
  const permissions: Permission[] = requestedTypes.map(recordType => ({ accessType: 'read', recordType }));
  const granted = grantedTypes(await native.requestPermission(permissions));
  if (!requestedTypes.some(type => granted.has(type))) throw new ActivityHealthError('permission');
}

/** Aggregate one explicit writer only. A later read replaces a snapshot, never adds to it. */
export async function readActivityHealthWindow(sourceId: string, from: number, to: number): Promise<HealthWindow> {
  const range = timeRange(from, to);
  if (!/^[A-Za-z0-9_.-]{1,255}$/.test(sourceId)) throw new ActivityHealthError('origin-mismatch');
  const native = await nativeHealth(), granted = grantedTypes(await native.getGrantedPermissions());
  const metrics: HealthMetricSnapshot[] = [], missingPermissions: HealthMetric[] = [];
  for (const [recordType, metric] of TYPES) {
    if (!granted.has(recordType)) { missingPermissions.push(metric); continue; }
    const aggregate = await native.aggregateRecord({ recordType, timeRangeFilter: range, dataOriginFilter: [sourceId] });
    if (aggregate.dataOrigins.some(origin => origin !== sourceId)) throw new ActivityHealthError('origin-mismatch');
    // The installed binding replaces missing native totals with zero. dataOrigins distinguishes no data.
    let value: number | null = null;
    if (aggregate.dataOrigins.includes(sourceId)) {
      const result = aggregate as unknown as Record<string, unknown>;
      const nested = (key: string, unit: string): unknown => {
        const item = result[key];
        return item && typeof item === 'object' ? (item as Record<string, unknown>)[unit] : undefined;
      };
      const raw = recordType === 'Steps' ? result.COUNT_TOTAL : recordType === 'Distance' ? nested('DISTANCE', 'inMeters')
        : recordType === 'ActiveCaloriesBurned' ? nested('ACTIVE_CALORIES_TOTAL', 'inKilocalories') : nested('ENERGY_TOTAL', 'inKilocalories');
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) throw new ActivityHealthError('incomplete');
      value = raw;
    }
    metrics.push({ recordType: metric, value, from, to });
  }
  if (granted.has('Speed')) {
    const samples: MovementSample[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    do {
      const page = await native.readRecords('Speed', { timeRangeFilter: range, dataOriginFilter: [sourceId], pageSize: 1000, pageToken });
      for (const record of page.records) {
        if (record.metadata?.dataOrigin !== sourceId) throw new ActivityHealthError('origin-mismatch');
        for (const sample of record.samples) {
          const at = Date.parse(sample.time);
          if (at >= from && at < to) samples.push({ at, mps: sample.speed.inMetersPerSecond, series: record.metadata?.id ?? `${record.startTime}:${record.endTime}` });
        }
      }
      pageToken = page.pageToken || undefined;
      if (pageToken && (seen.has(pageToken) || seen.size >= 99)) throw new ActivityHealthError('incomplete');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    const movement = activityMovement(samples);
    for (const [field, recordType] of Object.entries(SPEED_FIELDS) as Array<[keyof typeof SPEED_FIELDS, typeof SPEED_FIELDS[keyof typeof SPEED_FIELDS]]>)
      metrics.push({ recordType, value: movement[field], from, to });
  } else missingPermissions.push(...Object.values(SPEED_FIELDS));
  if (!metrics.length) throw new ActivityHealthError('permission');
  return { metrics, missingPermissions };
}
