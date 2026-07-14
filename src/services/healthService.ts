// healthService — reads a player's OWN session metrics from the wearable data
// hub on the phone (Health Connect on Android / HealthKit on iOS). The phone is
// only the "mailbox": the measurement comes from the wrist device, never the
// phone's sensors.
//
// Android is wired to Health Connect (react-native-health-connect, added at
// build time via app.json + plugins/withHealth.js). iOS (HealthKit) is a
// deferred follow-up — nativeHealth() returns null there, so the physical panel
// simply doesn't render and nothing crashes.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logError } from '@/services/errorLog';
import { computeHrZones, computeEffort, type HrZoneMinutes } from '@/utils/physical';

export interface HealthSession {
  distanceM: number;
  steps: number;
  calories: number;
  avgHr: number;
  maxHr: number;
  topSpeedKmh: number;
  avgSpeedKmh: number;
  sprints: number;
  hrZones: HrZoneMinutes;
  /** 0..100 objective effort score. */
  effortScore: number;
  source: 'wear' | 'healthkit' | 'healthconnect';
}

interface RawSession {
  distanceM?: number;
  steps?: number;
  calories?: number;
  avgHr?: number;
  maxHr?: number;
  topSpeedKmh?: number;
  avgSpeedKmh?: number;
  sprints?: number;
  hrSamples?: Array<{ bpm: number; ms: number }>;
}

// The native binding's surface. Typed loosely (`any` at the read sites) so we
// don't fight the library's heavy generics — every field is guarded at runtime.
type HealthConnect = typeof import('react-native-health-connect');

// Health Connect READ scopes — must mirror plugins/withHealth.js
// (HC_READ_PERMISSIONS) so a granted permission maps to a manifest entry.
// NOTE: no ExerciseSession / ExerciseRoute — the GPS heatmap was dropped, and
// READ_EXERCISE_ROUTE is the permission Google reviews most strictly.
// HeartRate dropped 2026-07-14 — see plugins/withHealth.js: hardest to justify
// as "essential" for a game-organising app under Google's Jan-2026 health policy.
// Kept in sync with HC_READ_PERMISSIONS so a granted permission always maps to a
// requested record type.
const READ_PERMISSIONS = [
  { accessType: 'read', recordType: 'Distance' },
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'TotalCaloriesBurned' },
  { accessType: 'read', recordType: 'Speed' },
] as const;

const SDK_AVAILABLE = 3; // SdkAvailabilityStatus.SDK_AVAILABLE
// A speed sample at/above this (≈19 km/h) counts as a sprint.
const SPRINT_MPS = 5.3;
// Persist a "user declined Health Connect" flag so we prompt at most once
// automatically — a manual re-connect can pass forcePrompt to bypass it.
const DECLINED_KEY = 'health.hc.declined';

// ⚠️ HEALTH CONNECT IS GATED OFF. The react-native-health-connect PACKAGE is
// still bundled, but its config plugin (plugins/withHealth.js + the library's
// own plugin) was REMOVED from app.json to clear Google Play's health-
// declaration gate. That plugin is what registers the permission-delegate
// activity in the manifest, so calling the native module's requestPermission /
// initialize WITHOUT it throws an UNCATCHABLE native exception → the app closes.
// It took down the evening summary on open (EveningSummaryScreen →
// physicalSyncService.syncForGame → ensurePermissions → requestPermission).
// Keep this false until BOTH the config plugin is restored AND Google's health
// declaration is approved. Flipping it back to true re-enables everything.
const HEALTH_ENABLED = false;

// Resolve the native binding once. react-native-health-connect is Android-only;
// on iOS we return null (HealthKit not wired yet). A guarded require means a
// build WITHOUT the native module still runs (returns null) instead of crashing.
let hcModule: HealthConnect | null | undefined;
function nativeHealth(): HealthConnect | null {
  if (!HEALTH_ENABLED) return null;
  if (Platform.OS !== 'android') return null;
  if (hcModule !== undefined) return hcModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    hcModule = require('react-native-health-connect') as HealthConnect;
  } catch {
    hcModule = null;
  }
  return hcModule ?? null;
}

// getSdkStatus + initialize, memoized. false when Health Connect isn't
// installed / needs a provider update (the metrics simply won't show).
let initialized: boolean | null = null;
async function ensureReady(hc: HealthConnect): Promise<boolean> {
  if (initialized !== null) return initialized;
  try {
    const status = await hc.getSdkStatus();
    if (status !== SDK_AVAILABLE) {
      initialized = false;
      return false;
    }
    initialized = await hc.initialize();
  } catch (err) {
    logError('healthService.ensureReady', err);
    initialized = false;
  }
  return initialized;
}

// Concrete Health Connect record reads for [from, to]. Every record type is
// read independently so a missing single permission degrades that metric
// instead of losing the whole session. Returns null when nothing meaningful
// was recorded (so we never upload an all-zero "session").
async function readRawSession(
  native: unknown,
  from: number,
  to: number,
): Promise<RawSession | null> {
  const hc = native as HealthConnect;
  const timeRangeFilter = {
    operator: 'between',
    startTime: new Date(from).toISOString(),
    endTime: new Date(to).toISOString(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const read = async (recordType: string): Promise<any[]> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (hc.readRecords as any)(recordType, {
        timeRangeFilter,
      });
      return res?.records ?? [];
    } catch {
      return [];
    }
  };

  const [dist, steps, active, speed] = await Promise.all([
    read('Distance'),
    read('Steps'),
    read('ActiveCaloriesBurned'),
    read('Speed'),
  ]);

  const distanceM = dist.reduce((s, r) => s + (r.distance?.inMeters ?? 0), 0);
  const stepCount = steps.reduce((s, r) => s + (r.count ?? 0), 0);
  const calories = active.reduce(
    (s, r) => s + (r.energy?.inKilocalories ?? 0),
    0,
  );

  // Heart-rate dropped (see READ_PERMISSIONS) — kept as 0 for type/display compat.
  const avgHr = 0;
  const maxHr = 0;

  const speeds: number[] = [];
  for (const r of speed) {
    for (const smp of r.samples ?? []) {
      const mps = smp.speed?.inMetersPerSecond;
      if (typeof mps === 'number' && mps >= 0) speeds.push(mps);
    }
  }
  const topSpeedKmh = speeds.length
    ? Math.round(Math.max(...speeds) * 3.6 * 10) / 10
    : 0;
  const avgSpeedKmh = speeds.length
    ? Math.round((speeds.reduce((s, x) => s + x, 0) / speeds.length) * 3.6 * 10) /
      10
    : 0;
  const sprints = speeds.filter((mps) => mps >= SPRINT_MPS).length;

  // Nothing worth showing → treat as "no session" so the caller doesn't upload
  // a hollow all-zeros doc.
  if (!distanceM && !stepCount && !calories && speeds.length === 0) {
    return null;
  }

  return {
    distanceM,
    steps: stepCount,
    calories,
    avgHr,
    maxHr,
    topSpeedKmh,
    avgSpeedKmh,
    sprints,
    // hrSamples omitted — heart-rate dropped; hrZones/effort resolve to empty
    // until the effort score is re-based on movement metrics when Health is
    // re-enabled (currently gated off pending the Google health declaration).
  };
}

export const healthService = {
  /** True when the native Health Connect binding is present (Android build). */
  isAvailable(): boolean {
    return !!nativeHealth();
  },

  /**
   * Ensure the SDK is ready and the READ permissions are granted, prompting the
   * Health Connect permission sheet if needed. Returns true when we can read.
   *
   * Auto-prompts at most once: if the user previously declined we skip the
   * prompt (unless `forcePrompt`, e.g. a manual "connect watch" tap) so we never
   * nag on every summary open.
   */
  async ensurePermissions(forcePrompt = false): Promise<boolean> {
    const hc = nativeHealth();
    if (!hc) return false;
    try {
      if (!(await ensureReady(hc))) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const granted: any[] = await hc.getGrantedPermissions();
      if (granted.some((g) => g?.accessType === 'read')) return true;

      if (!forcePrompt) {
        const declined = await AsyncStorage.getItem(DECLINED_KEY).catch(
          () => null,
        );
        if (declined === '1') return false;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any[] = await hc.requestPermission(READ_PERMISSIONS as any);
      const ok = res.some((g) => g?.accessType === 'read');
      if (!ok) await AsyncStorage.setItem(DECLINED_KEY, '1').catch(() => {});
      return ok;
    } catch (err) {
      logError('healthService.ensurePermissions', err);
      return false;
    }
  },

  /** Read + derive one session's metrics for [from, to]. null when no device. */
  async readSession(from: number, to: number): Promise<HealthSession | null> {
    const native = nativeHealth();
    if (!native) return null;
    try {
      if (!(await ensureReady(native))) return null;
      const raw = await readRawSession(native, from, to);
      if (!raw) return null;
      const maxHr = raw.maxHr ?? 0;
      const hrZones = computeHrZones(raw.hrSamples ?? [], maxHr);
      const effortScore = computeEffort(raw.avgHr ?? 0, maxHr, hrZones);
      return {
        distanceM: raw.distanceM ?? 0,
        steps: raw.steps ?? 0,
        calories: raw.calories ?? 0,
        avgHr: raw.avgHr ?? 0,
        maxHr,
        topSpeedKmh: raw.topSpeedKmh ?? 0,
        avgSpeedKmh: raw.avgSpeedKmh ?? 0,
        sprints: raw.sprints ?? 0,
        hrZones,
        effortScore,
        source: Platform.OS === 'ios' ? 'healthkit' : 'healthconnect',
      };
    } catch (err) {
      logError('healthService.readSession', err, { from, to });
      return null;
    }
  },
};
